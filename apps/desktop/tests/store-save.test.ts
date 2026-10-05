import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../src/infra/store.js'
import { commitChanges } from '../src/app/commit.js'
import { emptyDb, fakeCtx, task } from './helpers.js'
import { createHandlers } from '../src/app/handlers.js'
import { receive } from '../src/app/receive.js'
import { restoreOpenSession } from '../src/app/lifecycle.js'
import { createSession } from '../src/domain/session-ops.js'
import { focusMs } from '@white-box/core/engine'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

let directory: string
let store: Store

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-store-save-'))
  store = new Store(directory)
  store.data.tasks = [task({ id: 'saved', progress: 70 })]
  store.save()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('atomic Store.save sharing-conflict recovery', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'].flatMap((code) => [1, 2].map((failures) => ({ code, failures }))))('recovers from $failures transient $code failures using the real file replacement', ({ code, failures }) => {
    const nativeRename = fs.renameSync
    let attempts = 0
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (++attempts <= failures) throw Object.assign(new Error('sharing conflict'), { code })
      nativeRename(source, destination)
    })
    store.data.tasks[0] = { ...store.data.tasks[0]!, blocked: true, blockReason: '確認待ち' }
    store.save()
    expect(rename).toHaveBeenCalledTimes(failures + 1)
    expect(JSON.parse(fs.readFileSync(store.dbPath, 'utf8')).tasks).toEqual(store.data.tasks)
    expect(fs.existsSync(`${store.dbPath}.tmp`)).toBe(false)
  })

  it.each(['EPERM', 'EBUSY', 'EACCES'])('bounds persistent %s retries, preserves the old file and rolls back the transaction', (code) => {
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    const originalData = structuredClone(store.data)
    const error = Object.assign(new Error('persistent sharing conflict'), { code })
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw error })
    const wait = vi.spyOn(Atomics, 'wait')
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.publish = () => store.save()
    expect(() => commitChanges(ctx, { tasks: [task({ id: 'new' })] })).toThrow(error)
    expect(rename).toHaveBeenCalledTimes(4)
    expect(wait.mock.calls.reduce((budget, call) => budget + (call[3] ?? 0), 0)).toBeLessThanOrEqual(100)
    expect(store.data).toEqual(originalData)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
  })

  it('throws non-retry I/O errors immediately without changing the original file', () => {
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    const error = Object.assign(new Error('I/O failure'), { code: 'EIO' })
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw error })
    const wait = vi.spyOn(Atomics, 'wait')
    expect(() => store.save()).toThrow(error)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
  })

  it('retains the previous database and file when an import replacement cannot be saved', () => {
    const originalData = structuredClone(store.data)
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    const error = Object.assign(new Error('persistent sharing conflict'), { code: 'EPERM' })
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw error })
    expect(() => store.replace({ ...store.data, tasks: [task({ id: 'imported' })] })).toThrow(error)
    expect(store.data).toEqual(originalData)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
  })

  it('persists the memory safety stop after failed import recovery and restores it without accumulating work', async () => {
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.publish = (persist = true) => { if (persist) store.save() }
    const imported = emptyDb()
    imported.projects = [{ id: 'archived', name: 'Archive', hue: 18, archived: true, order: 0, createdAt: 0, updatedAt: 0 }]
    imported.tasks = [task({ id: 'target', status: 'doing', projectId: 'archived' })]
    imported.sessions = [createSession({ taskId: 'target', taskTitle: 'target', plannedMs: 60_000, now: ctx.now() - 1000 })]
    ctx.dataIO.importData = async () => { store.replace(imported); return 'isolated-import.json' }
    const nativeRename = fs.renameSync
    let attempts = 0
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (++attempts > 1) throw Object.assign(new Error('persistent sharing conflict'), { code: 'EPERM' })
      nativeRename(source, destination)
    })
    expect((await receive(createHandlers(ctx), 'data:import', {})).ok).toBe(false)
    expect(JSON.parse(fs.readFileSync(store.dbPath, 'utf8')).sessions[0].state).toBe('running')
    expect(store.data.sessions[0]!.state).toBe('paused')
    rename.mockRestore()
    store.save()
    const reopened = new Store(directory)
    const restarted = fakeCtx(reopened.data)
    restarted.store = reopened
    restarted.publish = (persist = true) => { if (persist) reopened.save() }
    restoreOpenSession(restarted)
    const measured = focusMs(reopened.data.sessions[0]!, restarted.now())
    const handlers = createHandlers(restarted)
    expect((await receive(handlers, 'state:get', {}))).toMatchObject({ ok: true, data: { live: { state: 'paused' } } })
    restarted.advance(1000)
    expect(focusMs(reopened.data.sessions[0]!, restarted.now())).toBe(measured)
    expect((await receive(handlers, 'session:resume', {})).ok).toBe(false)
  })
})

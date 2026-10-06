import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../src/infra/store.js'
import { commitChanges } from '../src/app/commit.js'
import { emptyDb, fakeCtx, task } from './helpers.js'
import { createHandlers } from '../src/app/handlers.js'
import { receive } from '../src/app/receive.js'
import { prepareQuit, restoreOpenSession } from '../src/app/lifecycle.js'
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

describe('write-once recovery snapshots', () => {
  it('preserves the first import snapshot and current database when a timestamp collides', () => {
    const at = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(at)
    const original = structuredClone(store.data)
    const first = { ...emptyDb(), tasks: [task({ id: 'first-import' })] }
    const second = { ...emptyDb(), tasks: [task({ id: 'second-import' })] }
    first.settings.onboardedAt = second.settings.onboardedAt = at
    store.replace(first)
    const firstSaved = structuredClone(store.data)
    const snapshot = path.join(directory, 'backups', `before-import-${at}.json`)
    const originalSnapshot = fs.readFileSync(snapshot, 'utf8')
    const current = fs.readFileSync(store.dbPath, 'utf8')
    expect(JSON.parse(originalSnapshot)).toEqual(original)
    expect(() => store.replace(second)).toThrow(/EEXIST/)
    expect(fs.readFileSync(snapshot, 'utf8')).toBe(originalSnapshot)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(current)
    expect(store.data).toEqual(firstSaved)
    clock.mockReturnValue(at + 1)
    store.replace(second)
    expect(JSON.parse(fs.readFileSync(path.join(directory, 'backups', `before-import-${at + 1}.json`), 'utf8'))).toEqual(firstSaved)
    expect(new Store(directory).data).toEqual(store.data)
    expect(store.data.tasks[0]?.id).toBe('second-import')
  })

  it('preserves an earlier quarantined original when failed loads share a timestamp', () => {
    const at = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(at)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fs.writeFileSync(store.dbPath, '{ first malformed original }', 'utf8')
    expect(() => new Store(directory)).toThrow('読み込めません')
    const snapshot = path.join(directory, `data.corrupt-${at}.json`)
    expect(fs.readFileSync(snapshot, 'utf8')).toBe('{ first malformed original }')
    fs.writeFileSync(store.dbPath, '{ second malformed original }', 'utf8')
    expect(() => new Store(directory)).toThrow('読み込めません')
    expect(fs.readFileSync(snapshot, 'utf8')).toBe('{ first malformed original }')
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe('{ second malformed original }')
  })
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

describe('atomic heartbeat recovery', () => {
  const startedAt = Date.UTC(2026, 9, 6, 0)
  const goodAt = startedAt + 30 * 60_000

  it.each(['write', 'rename'])('cancels actual quit after heartbeat %s failure and preserves recovery on retry', async (operation) => {
    store.data.tasks[0] = { ...store.data.tasks[0]!, status: 'doing' }
    store.data.sessions = [createSession({ taskId: 'saved', taskTitle: 'saved', mode: 'stopwatch', plannedMs: 50 * 60_000, now: startedAt })]
    store.save()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(goodAt)
    store.markAlive()
    const beforeMarker = fs.readFileSync(store.runtimePath, 'utf8')
    const beforeDatabase = fs.readFileSync(store.dbPath, 'utf8')
    const quitAt = goodAt + 5 * 60_000
    clock.mockReturnValue(quitAt)
    const error = Object.assign(new Error('heartbeat is unavailable'), { code: 'EIO' })
    const nativeWrite = fs.writeFileSync
    const nativeRename = fs.renameSync
    const fault = operation === 'write'
      ? vi.spyOn(fs, 'writeFileSync').mockImplementation((destination, data, options) => {
        if (String(destination) === `${store.runtimePath}.tmp`) throw error
        nativeWrite(destination, data, options)
      })
      : vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
        if (String(destination) === store.runtimePath) throw error
        nativeRename(source, destination)
      })
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.now = () => quitAt
    ctx.system.quit = () => { prepareQuit(ctx); ctx.calls.push('quit') }
    const handlers = createHandlers(ctx)
    expect((await receive(handlers, 'app:quit', {}))).toMatchObject({ ok: false, error: String(error) })
    expect(ctx.runtime.quitting).toBe(false)
    expect(ctx.runtime.preparingQuit).toBe(false)
    expect(ctx.calls).not.toContain('ticker:stop')
    expect(ctx.calls).not.toContain('quit')
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(beforeDatabase)
    expect(fs.readFileSync(store.runtimePath, 'utf8')).toBe(beforeMarker)
    fault.mockRestore()

    expect((await receive(handlers, 'app:quit', {})).ok).toBe(true)
    expect(ctx.calls).toContain('ticker:stop')
    expect(ctx.calls).toContain('quit')
    expect(store.readLastAlive()).toBe(quitAt)
    const reopened = new Store(directory)
    const restarted = fakeCtx(reopened.data)
    restarted.store = reopened
    restarted.now = () => quitAt + 10 * 60_000
    restarted.publish = () => reopened.save()
    restoreOpenSession(restarted)
    expect(restarted.runtime.recovery?.lastKnownAt).toBe(quitAt)
    expect(focusMs(reopened.data.sessions[0]!, restarted.now())).toBe(35 * 60_000)
  })

  it('keeps the previous heartbeat after a partial write and recovers its known work', async () => {
    store.data.tasks[0] = { ...store.data.tasks[0]!, status: 'doing' }
    store.data.sessions = [createSession({ taskId: 'saved', taskTitle: 'saved', mode: 'stopwatch', plannedMs: 50 * 60_000, now: startedAt })]
    store.save()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(goodAt)
    store.markAlive()
    const originalBytes = fs.readFileSync(store.runtimePath, 'utf8')
    clock.mockReturnValue(goodAt + 1000)
    const nativeWrite = fs.writeFileSync
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((destination, data, options) => {
      if (String(destination) === store.runtimePath || String(destination) === `${store.runtimePath}.tmp`) {
        nativeWrite(destination, '{"lastTickAt":', 'utf8')
        throw Object.assign(new Error('partial heartbeat write'), { code: 'ENOSPC' })
      }
      nativeWrite(destination, data, options)
    })
    expect(() => store.markAlive()).not.toThrow()
    expect(fs.readFileSync(store.runtimePath, 'utf8')).toBe(originalBytes)
    expect(store.readLastAlive()).toBe(goodAt)
    write.mockRestore()

    const reopened = new Store(directory)
    expect(reopened.readLastAlive()).toBe(goodAt)
    const restarted = fakeCtx(reopened.data)
    restarted.store = reopened
    restarted.now = () => startedAt + 60 * 60_000
    restarted.publish = () => reopened.save()
    restoreOpenSession(restarted)
    expect(restarted.runtime.recovery?.lastKnownAt).toBe(goodAt)
    expect((await receive(createHandlers(restarted), 'recovery:close', {})).ok).toBe(true)
    expect(focusMs(reopened.data.sessions[0]!, restarted.now())).toBe(30 * 60_000)
    expect(new Store(directory).data.sessions[0]!.endedAt).toBe(goodAt)

    clock.mockReturnValue(goodAt + 2000)
    reopened.markAlive()
    expect(new Store(directory).readLastAlive()).toBe(goodAt + 2000)
    expect(fs.existsSync(`${store.runtimePath}.tmp`)).toBe(false)
  })

  it('retries a transient heartbeat replacement conflict and commits the next marker', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(goodAt)
    store.markAlive()
    clock.mockReturnValue(goodAt + 1000)
    const nativeRename = fs.renameSync
    let attempts = 0
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (++attempts <= 2) throw Object.assign(new Error('sharing conflict'), { code: 'EPERM' })
      nativeRename(source, destination)
    })
    store.markAlive()
    expect(rename).toHaveBeenCalledTimes(3)
    expect(new Store(directory).readLastAlive()).toBe(goodAt + 1000)
    expect(fs.existsSync(`${store.runtimePath}.tmp`)).toBe(false)
  })

  it.each(['EPERM', 'EBUSY', 'EACCES'])('bounds persistent heartbeat %s failures and keeps the previous marker without throwing', (code) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(goodAt)
    store.markAlive()
    const originalBytes = fs.readFileSync(store.runtimePath, 'utf8')
    clock.mockReturnValue(goodAt + 1000)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('persistent sharing conflict'), { code }) })
    const wait = vi.spyOn(Atomics, 'wait')
    expect(() => store.markAlive()).not.toThrow()
    expect(rename).toHaveBeenCalledTimes(4)
    expect(wait).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.reduce((budget, call) => budget + (call[3] ?? 0), 0)).toBeLessThanOrEqual(100)
    expect(fs.readFileSync(store.runtimePath, 'utf8')).toBe(originalBytes)
    expect(new Store(directory).readLastAlive()).toBe(goodAt)
  })

  it('keeps the heartbeat after a non-retry I/O error without adding waits', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(goodAt)
    store.markAlive()
    const originalBytes = fs.readFileSync(store.runtimePath, 'utf8')
    clock.mockReturnValue(goodAt + 1000)
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }) })
    const wait = vi.spyOn(Atomics, 'wait')
    expect(() => store.markAlive()).not.toThrow()
    expect(rename).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
    expect(fs.readFileSync(store.runtimePath, 'utf8')).toBe(originalBytes)
    expect(store.readLastAlive()).toBe(goodAt)
  })
})

describe('daily backup retention ownership', () => {
  it('preserves unrelated files and directory lookalikes when daily retention runs', () => {
    const retained = new Store(path.join(directory, 'retention-with-unrelated'))
    const backups = path.join(retained.dir, 'backups')
    const unrelated = ['data--manual.txt', 'data-important.json', 'data-2026-02-30.json']
    for (const name of unrelated) fs.writeFileSync(path.join(backups, name), 'Unrelated synthetic file', 'utf8')
    fs.mkdirSync(path.join(backups, 'data-1900-01-01.json'))
    vi.useFakeTimers()
    try {
      for (let day = 1; day <= 31; day++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 0, day, 12)))
        retained.save()
      }
    } finally { vi.useRealTimers() }
    for (const name of unrelated) {
      expect(fs.existsSync(path.join(backups, name))).toBe(true)
      expect(fs.readFileSync(path.join(backups, name), 'utf8')).toBe('Unrelated synthetic file')
    }
    expect(fs.statSync(path.join(backups, 'data-1900-01-01.json')).isDirectory()).toBe(true)
  })

  it('keeps the newest thirty regular backups produced by public daily saves', () => {
    const retained = new Store(path.join(directory, 'retention-generated-only'))
    const generated = []
    vi.useFakeTimers()
    try {
      for (let day = 1; day <= 31; day++) {
        const now = new Date(Date.UTC(2026, 0, day, 12))
        vi.setSystemTime(now)
        retained.save()
        generated.push(`data-${now.toISOString().slice(0, 10)}.json`)
      }
    } finally { vi.useRealTimers() }
    expect(fs.readdirSync(path.join(retained.dir, 'backups')).sort()).toEqual(generated.slice(1))
  })
})

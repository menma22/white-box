import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { focusMs, managementMs } from '@white-box/core/engine'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { checkExpire, restoreOpenSession, setCurrentWorkOpen } from '../src/app/lifecycle.js'
import { createSession, endSession, pauseSession, startBreak } from '../src/domain/session-ops.js'
import { Store } from '../src/infra/store.js'
import { validateStoredDatabase } from '../src/infra/database-validation.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function storedCtx() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-session-boundary-'))
  directories.push(directory)
  const store = new Store(directory)
  const ctx = fakeCtx(store.data)
  ctx.store = store
  ctx.publish = (persist = true) => { if (persist) store.save() }
  store.data.tasks = [task({ id: 'active', status: 'doing' }), task({ id: 'next' })]
  store.data.sessions = [createSession({ taskId: 'active', taskTitle: 'Active', mode: 'stopwatch', plannedMs: 60_000, now: ctx.now() })]
  store.save()
  return { ctx, store }
}

describe('app-written sessions remain readable', () => {
  it('rejects a future live start without changing memory, disk or runtime', async () => {
    const { ctx, store } = storedCtx()
    const before = structuredClone(store.data)
    const runtime = structuredClone(ctx.runtime)
    const file = fs.readFileSync(store.dbPath, 'utf8')
    await expect(dispatch(createHandlers(ctx), 'session:update', {
      id: store.data.sessions[0]!.id, patch: { startedAt: ctx.now() + 86_400_000 },
    })).rejects.toThrow('未来')
    expect(store.data).toEqual(before)
    expect(ctx.runtime).toEqual(runtime)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(file)
    expect(new Store(store.dir).data.sessions).toEqual(before.sessions)
  })

  it('closes at the latest observed time after clock rollback without reversing open spans', async () => {
    const { ctx, store } = storedCtx()
    const handlers = createHandlers(ctx)
    ctx.advance(10_000)
    await dispatch(handlers, 'session:pause', {})
    await dispatch(handlers, 'session:switchTask', { taskId: 'next' })
    const observedAt = ctx.now()
    const original = structuredClone(store.data.sessions[0]!)
    ctx.advance(-100_000)
    await dispatch(handlers, 'session:end', {})
    const ended = store.data.sessions[0]!
    expect(ended.endedAt).toBe(observedAt)
    expect(ended.events.at(-1)!.at).toBe(observedAt)
    expect(ended.events.slice(0, -1)).toEqual(original.events)
    expect(ended.segments.every((segment) => segment.endedAt !== null && segment.endedAt >= segment.startedAt)).toBe(true)
    expect(ended.pauses.every((pause) => pause.endedAt !== null && pause.endedAt >= pause.startedAt)).toBe(true)
    expect(() => validateStoredDatabase(store.data)).not.toThrow()
    expect(new Store(store.dir).data.sessions).toEqual(store.data.sessions)
  })

  it('does not rewrite a previously ended session whose end timestamp is zero', () => {
    const session = createSession({ taskId: 't', taskTitle: 'T', mode: 'stopwatch', plannedMs: 60_000, now: -1000 })
    const ended = endSession(session, 0)
    expect(endSession(ended, 1000)).toBe(ended)
  })

  it('keeps Date-valid historical future corrections available', async () => {
    const { ctx, store } = storedCtx()
    const handlers = createHandlers(ctx)
    await dispatch(handlers, 'session:end', {})
    await dispatch(handlers, 'session:update', { id: store.data.sessions[0]!.id,
      patch: { startedAt: ctx.now() + 86_400_000, endedAt: ctx.now() + 86_460_000 } })
    expect(() => validateStoredDatabase(store.data)).not.toThrow()
    expect(new Store(store.dir).data.sessions).toEqual(store.data.sessions)
  })
})

describe('import respects the currently open task-management window', () => {
  it.each(['running', 'manual', 'break', 'recovery'] as const)('keeps imported %s work stopped and preserves the other pause/recovery', async (kind) => {
    const { ctx, store } = storedCtx()
    ctx.runtime.currentWorkOpen = true
    const imported = emptyDb()
    imported.tasks = [task({ id: 'imported', status: 'doing' })]
    const startedAt = ctx.now() - (kind === 'recovery' ? 3_600_000 : 0)
    let session = createSession({ taskId: 'imported', taskTitle: 'Imported', mode: kind === 'break' ? 'pomodoro' : 'stopwatch',
      pomodoroAutoResume: true, plannedMs: 60_000, now: startedAt })
    if (kind === 'manual') session = pauseSession(session, ctx.now(), 'manual')
    if (kind === 'break') session = startBreak(session, 1, ctx.now())
    imported.sessions = [session]
    ctx.dataIO.importData = async () => { store.replace(imported); return 'isolated-snapshot.json' }
    await dispatch(createHandlers(ctx), 'data:import', {})
    const restored = store.data.sessions[0]!
    expect(restored.state).toBe('paused')
    expect(restored.pauses.some((pause) => pause.reason === 'task-management' && pause.endedAt === null)).toBe(true)
    if (kind === 'manual' || kind === 'break') expect(restored.pauses.some((pause) => pause.reason === kind && pause.endedAt === null)).toBe(true)
    if (kind === 'recovery') expect(ctx.runtime.recovery).toEqual({ sessionId: session.id, lastKnownAt: startedAt })
    const measured = focusMs(restored, ctx.now())
    ctx.advance(60_000)
    checkExpire(ctx)
    expect(focusMs(store.data.sessions[0]!, ctx.now())).toBe(measured)
    expect(managementMs(store.data.sessions[0]!, ctx.now())).toBe(60_000)
    expect(() => validateStoredDatabase(store.data)).not.toThrow()
    expect(new Store(store.dir).data.sessions).toEqual(store.data.sessions)
    const reopened = new Store(store.dir)
    const startup = fakeCtx(reopened.data)
    startup.store = reopened
    startup.publish = (persist = true) => { if (persist) reopened.save() }
    restoreOpenSession(startup)
    const beforeResume = focusMs(reopened.data.sessions[0]!, startup.now())
    startup.advance(60_000)
    expect(focusMs(reopened.data.sessions[0]!, startup.now())).toBe(beforeResume)
    setCurrentWorkOpen(ctx, false)
    if (kind === 'manual' || kind === 'recovery') expect(store.data.sessions[0]!.state).toBe('paused')
  })

  it('retains the physical management pause in memory if its post-import save fails', async () => {
    const { ctx, store } = storedCtx()
    ctx.runtime.currentWorkOpen = true
    const imported = emptyDb()
    imported.tasks = [task({ id: 'imported', status: 'doing' })]
    imported.sessions = [createSession({ taskId: 'imported', taskTitle: 'Imported', mode: 'stopwatch', plannedMs: 60_000, now: ctx.now() })]
    ctx.dataIO.importData = async () => { store.replace(imported); return 'isolated-snapshot.json' }
    const rename = fs.renameSync
    let writes = 0
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (++writes > 1) throw Object.assign(new Error('I/O failure'), { code: 'EIO' })
      rename(source, destination)
    })
    await expect(dispatch(createHandlers(ctx), 'data:import', {})).rejects.toThrow('I/O failure')
    const measured = focusMs(store.data.sessions[0]!, ctx.now())
    ctx.advance(60_000)
    expect(focusMs(store.data.sessions[0]!, ctx.now())).toBe(measured)
    expect(store.data.sessions[0]!.state).toBe('paused')
    fault.mockRestore()
    store.save()
    expect(new Store(store.dir).data.sessions).toEqual(store.data.sessions)
  })
})

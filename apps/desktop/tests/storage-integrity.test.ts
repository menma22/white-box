import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ArgsOf, CommandName } from '@white-box/contracts'
import type { Database } from '@white-box/core/types'
import { Store } from '../src/infra/store.js'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { createSession, endSession } from '../src/domain/session-ops.js'
import { restoreOpenSession } from '../src/app/lifecycle.js'
import { focusMs } from '@white-box/core/engine'
import { createGoal, createIssue, hideGoal } from '../src/domain/goal-ops.js'
import { emptyDb, fakeCtx, task, type FakeCtx } from './helpers.js'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function savedStore(): Store {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-integrity-'))
  directories.push(directory)
  const store = new Store(directory)
  store.data.tasks = [task({ id: 'preserved', title: 'Existing record' })]
  store.save()
  return store
}

describe('stored database boundary', () => {
  it.each([
    {},
    { ...emptyDb(), projects: {} },
    { ...emptyDb(), tasks: [{ id: 'broken' }] },
    { ...emptyDb(), sessions: [{ id: 'broken', state: 'running' }] },
    { ...emptyDb(), settings: { displayName: 123 } },
    { ...emptyDb(), dayNotes: { '2026-10-06': 123 } },
    { ...emptyDb(), tasks: [task({ id: 'duplicate' }), task({ id: 'duplicate' })] },
    { ...emptyDb(), version: 2 },
    { ...emptyDb(), futureRecords: [{ id: 'record' }] },
  ])('rejects malformed or unsupported imports before writing %j', (input) => {
    const store = savedStore()
    const before = structuredClone(store.data)
    const file = fs.readFileSync(store.dbPath, 'utf8')
    const backups = fs.readdirSync(path.join(store.dir, 'backups'))
    expect(() => store.replace(input as Database)).toThrow()
    expect(store.data).toEqual(before)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(file)
    expect(fs.readdirSync(path.join(store.dir, 'backups'))).toEqual(backups)
    expect(new Store(store.dir).data.tasks).toEqual(before.tasks)
  })

  it.each(['{broken', JSON.stringify({ ...emptyDb(), tasks: [{ id: 'broken' }] }), JSON.stringify({ ...emptyDb(), version: 2 })])('fails closed on an unreadable saved database', (raw) => {
    const store = savedStore()
    fs.writeFileSync(store.dbPath, raw)
    expect(() => new Store(store.dir)).toThrow('元のデータは変更していません')
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(raw)
    const copy = fs.readdirSync(store.dir).find((file) => file.startsWith('data.corrupt-'))!
    expect(fs.readFileSync(path.join(store.dir, copy), 'utf8')).toBe(raw)
  })

  it('preserves legacy optional fields, removed references, and all existing records', () => {
    const store = savedStore()
    const db = emptyDb()
    db.tasks = [task({ id: 'legacy', progress: 70, hardDependencies: ['deleted'] })]
    db.sessions = [endSession(createSession({ taskId: 'deleted', taskTitle: 'Removed task', plannedMs: 60_000, now: 1000 }), 2000)]
    const legacy: Record<string, unknown> = { ...db, settings: { ...db.settings } }
    delete legacy.goalMap
    const settings = legacy.settings as Record<string, unknown>
    delete settings.showSessionCard
    delete settings.onboardedAt
    store.replace(legacy as unknown as Database)
    const reopened = new Store(store.dir)
    expect(reopened.data.tasks).toEqual(db.tasks)
    expect(reopened.data.sessions).toEqual(db.sessions)
    expect(reopened.data.settings.showSessionCard).toBe(true)
    expect(reopened.data.tasks[0]).not.toHaveProperty('blocked')
  })

  it('preserves a recognized v1 envelope without legacy settings and supplies defaults', () => {
    const store = savedStore()
    const legacy = { version: 1, projects: [], tasks: [], sessions: [], dayNotes: { '2026-09-24': 'retained' } }
    store.replace(legacy)
    expect(store.data.settings.dayStartHour).toBe(4)
    expect(store.data.dayNotes).toEqual(legacy.dayNotes)
    expect(new Store(store.dir).data).toEqual({ ...store.data, settings: { ...store.data.settings, onboardedAt: expect.any(Number) } })
    expect(() => store.replace({ ...legacy, settings: null })).toThrow()
  })

  it('rejects ambiguous duplicate project/session/segment identities and multiple live sessions', () => {
    const store = savedStore()
    const session = createSession({ taskId: 'preserved', taskTitle: 'Task', plannedMs: 60_000, now: 1000 })
    const project = { id: 'p', name: 'P', hue: 1, archived: false, order: 0, createdAt: 0, updatedAt: 0 }
    for (const input of [
      { ...emptyDb(), projects: [project, project] },
      { ...emptyDb(), sessions: [session, session] },
      { ...emptyDb(), sessions: [session, { ...session, id: 'another' }] },
      { ...emptyDb(), sessions: [{ ...session, segments: [session.segments[0]!, session.segments[0]!] }] },
    ]) expect(() => store.replace(input)).toThrow()
  })

  it('rejects inconsistent closure and invalid dates throughout a session before replacement', () => {
    const store = savedStore()
    const session = createSession({ taskId: 'preserved', taskTitle: 'Task', plannedMs: 60_000, now: 1000 })
    const ended = endSession(session, 2000)
    for (const invalid of [
      { ...session, state: 'ended' as const },
      { ...session, endedAt: 2000 },
      { ...session, state: 'paused' as const },
      { ...session, startedAt: 1e20 },
      { ...session, createdAt: 1e20 },
      { ...session, segments: [{ ...session.segments[0]!, startedAt: 1e20 }] },
      { ...session, events: [{ ...session.events[0]!, at: 1e20 }] },
      { ...ended, pauses: [{ startedAt: 1e20, endedAt: 1e20, reason: 'manual' as const }] },
      { ...ended, pauses: [{ startedAt: 1000, endedAt: null, reason: 'manual' as const }] },
    ]) expect(() => store.replace({ ...emptyDb(), sessions: [invalid] })).toThrow()
  })

  it('rejects a saved parent cycle without modifying the source file', () => {
    const store = savedStore()
    const input = { ...emptyDb(), tasks: [task({ id: 'a', parentId: 'b' }), task({ id: 'b', parentId: 'a' })] }
    const before = fs.readFileSync(store.dbPath, 'utf8')
    expect(() => store.replace(input)).toThrow('循環')
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(before)
  })

  it('ignores the previous database heartbeat when importing an old open stopwatch', async () => {
    const store = savedStore()
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.publish = () => store.save()
    seedSession(ctx)
    store.save()
    fs.writeFileSync(store.runtimePath, JSON.stringify({ lastTickAt: ctx.now() }))
    const imported = emptyDb()
    imported.tasks = [task({ id: 'imported', status: 'doing' })]
    const startedAt = ctx.now() - 3_600_000
    imported.sessions = [createSession({ taskId: 'imported', taskTitle: 'Imported', mode: 'stopwatch', plannedMs: 60_000, now: startedAt })]
    ctx.dataIO.importData = async () => { store.replace(imported); return 'old-snapshot.json' }
    await dispatch(createHandlers(ctx), 'data:import', {})
    expect(store.data.sessions[0]!.state).toBe('paused')
    expect(ctx.runtime.recovery?.lastKnownAt).toBe(startedAt)
    const measured = focusMs(store.data.sessions[0]!, ctx.now())
    ctx.advance(3_600_000)
    expect(focusMs(store.data.sessions[0]!, ctx.now())).toBe(measured)
    expect(new Store(store.dir).data.sessions).toEqual(store.data.sessions)
  })

  it('continues to use the same database heartbeat during startup recovery', () => {
    const ctx = fakeCtx()
    seedSession(ctx)
    ctx.setLastAlive(ctx.now())
    ctx.advance(30_000)
    restoreOpenSession(ctx)
    expect(ctx.runtime.recovery).toBeNull()
    expect(ctx.store.data.sessions[0]!.state).toBe('running')
  })

  it.each([1e20, '1000', { at: 1000 }])('ignores an invalid runtime heartbeat %j', (lastTickAt) => {
    const store = savedStore()
    fs.writeFileSync(store.runtimePath, JSON.stringify({ lastTickAt }))
    expect(store.readLastAlive()).toBeNull()
  })
})

function seedGoal(ctx: FakeCtx): string {
  const result = createGoal(ctx.store.data, { goal: 'Saved goal' })
  ctx.store.data.goalMap = result.goalMap
  return result.goal.id
}

function seedSession(ctx: FakeCtx, ended = false): string {
  ctx.store.data.tasks = [task({ id: 'active', status: 'doing' })]
  const session = createSession({ taskId: 'active', taskTitle: 'Active', plannedMs: 60_000, now: ctx.now() - 1000 })
  ctx.store.data.sessions = [ended ? endSession(session, ctx.now()) : session]
  return session.id
}

const probes: { name: CommandName; setup(ctx: FakeCtx): ArgsOf<CommandName> }[] = [
  { name: 'goal:hide', setup: (ctx) => ({ id: seedGoal(ctx) }) },
  { name: 'goal:merge', setup: (ctx) => ({ ids: [seedGoal(ctx), seedGoal(ctx)], goal: 'Merged' }) },
  { name: 'goal:restore', setup: (ctx) => { const id = seedGoal(ctx); ctx.store.data.goalMap = hideGoal(ctx.store.data, id, 'Hidden'); return { id } } },
  { name: 'goal:ui', setup: () => ({ patch: { headsOpen: false } }) },
  { name: 'issue:create', setup: () => ({ kind: 'problem', text: 'Problem' }) },
  ...(['issue:update', 'issue:delete'] as const).map((name) => ({ name, setup: (ctx: FakeCtx) => {
    const result = createIssue(ctx.store.data, { kind: 'problem', text: 'Saved problem' })
    ctx.store.data.goalMap = result.goalMap
    return name === 'issue:delete' ? { id: result.issue.id } : { id: result.issue.id, patch: { text: 'Changed' } }
  } })),
  { name: 'session:pause', setup: (ctx) => { seedSession(ctx); return {} } },
  { name: 'session:break', setup: (ctx) => { seedSession(ctx); return { minutes: 5 } } },
  { name: 'session:delete', setup: (ctx) => ({ id: seedSession(ctx, true) }) },
  { name: 'session:skipReview', setup: (ctx) => { ctx.runtime.pendingReview = { sessionId: seedSession(ctx, true), thenStart: true }; return {} } },
  { name: 'recovery:close', setup: (ctx) => { ctx.runtime.recovery = { sessionId: seedSession(ctx), lastKnownAt: ctx.now() - 500 }; return {} } },
  { name: 'day:note', setup: () => ({ key: '2026-10-06', text: 'Changed memo' }) },
  { name: 'welcome:dismiss', setup: () => ({}) },
]

describe('failed mutations preserve the saved database', () => {
  it.each(probes)('$name restores the database and runtime and cannot leak into a later save', async ({ name, setup }) => {
    const store = savedStore()
    const ctx = fakeCtx(store.data)
    ctx.store = store
    const args = setup(ctx)
    store.save()
    const before = structuredClone(store.data)
    const runtime = structuredClone(ctx.runtime)
    const file = fs.readFileSync(store.dbPath, 'utf8')
    ctx.publish = () => store.save()
    const error = Object.assign(new Error('I/O failure'), { code: 'EIO' })
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw error })
    await expect(dispatch(createHandlers(ctx), name, args)).rejects.toThrow(error)
    expect(store.data).toEqual(before)
    expect(ctx.runtime).toEqual(runtime)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(file)
    rename.mockRestore()
    store.save()
    expect(new Store(store.dir).data.tasks).toEqual(before.tasks)
    expect(new Store(store.dir).data.sessions).toEqual(before.sessions)
    expect(new Store(store.dir).data.goalMap).toEqual(before.goalMap)
    expect(new Store(store.dir).data.dayNotes).toEqual(before.dayNotes)
    expect(ctx.calls.some((call) => call.startsWith('open:') || call.startsWith('closeLater:'))).toBe(false)
  })

  it('rejects an end timestamp edit of a live session without creating a ghost session', async () => {
    const ctx = fakeCtx()
    const id = seedSession(ctx)
    const before = structuredClone(ctx.store.data)
    await expect(dispatch(createHandlers(ctx), 'session:update', { id, patch: { endedAt: ctx.now() } })).rejects.toThrow('終了操作')
    expect(ctx.store.data).toEqual(before)
    expect(ctx.calls).toEqual([])
  })
})

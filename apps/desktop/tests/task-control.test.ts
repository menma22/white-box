import { describe, expect, it, vi } from 'vitest'
import { createHandlers } from '../src/app/handlers.js'
import { receive } from '../src/app/receive.js'
import { checkExpire, restoreOpenSession, setCurrentWorkOpen } from '../src/app/lifecycle.js'
import { createSession, pauseSession, startBreak } from '../src/domain/session-ops.js'
import { createTask, deleteTask, updateTask } from '../src/domain/task-ops.js'
import { emptyDb, fakeCtx, task } from './helpers.js'
import { taskExecutionProblem } from '@white-box/core/task-control'
import { focusMs } from '@white-box/core/engine'

const external = { who: '担当者', what: '返答', since: '2026-10-01', lastContactOn: null, nextFollowUpOn: '2026-10-05' }

describe('task control public command gates', () => {
  it.each(['missing', 'done', 'blocked', 'external', 'hard', 'archived'])('stops imported %s current work through the public import command and keeps measured focus stable', async (kind) => {
    const db = emptyDb()
    const ctx = fakeCtx(db)
    const imported = emptyDb()
    imported.projects = [{ id: 'archived', name: 'Archive', hue: 18, archived: true, order: 0, createdAt: 0, updatedAt: 0 }]
    imported.tasks = [task({ id: 'before' }), task({ id: 'target', status: 'doing', ...(kind === 'done' ? { status: 'done' as const } : {}), ...(kind === 'blocked' ? { blocked: true } : {}), ...(kind === 'external' ? { externalBlock: external } : {}), ...(kind === 'hard' ? { hardDependencies: ['before'] } : {}), ...(kind === 'archived' ? { projectId: 'archived' } : {}) })]
    imported.sessions = [createSession({ taskId: kind === 'missing' ? 'absent' : 'target', taskTitle: 'target', plannedMs: 60_000, now: ctx.now() - 1000 })]
    ctx.dataIO.importData = async () => { Object.assign(db, imported); return 'isolated-import.json' }
    const handlers = createHandlers(ctx)
    expect((await receive(handlers, 'data:import', {})).ok).toBe(true)
    expect(db.sessions[0]!.state).toBe('paused')
    expect(ctx.runtime.recovery?.sessionId).toBe(imported.sessions[0]!.id)
    const measured = focusMs(db.sessions[0]!, ctx.now())
    ctx.advance(1000)
    checkExpire(ctx)
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(measured)
    expect((await receive(handlers, 'session:resume', {})).ok).toBe(false)
  })

  it('does not pause or change current work when an import is cancelled', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'active', status: 'doing' })]
    const ctx = fakeCtx(db)
    db.sessions = [createSession({ taskId: 'active', taskTitle: 'active', plannedMs: 60_000, now: ctx.now() })]
    ctx.dataIO.importData = async () => null
    const before = structuredClone(db)
    expect((await receive(createHandlers(ctx), 'data:import', {})).ok).toBe(true)
    expect(db).toEqual(before)
    expect(ctx.runtime.recovery).toBeNull()
    expect(ctx.calls).toEqual([])
  })

  it('keeps an imported blocked session safely stopped when its recovery save fails after the import was saved', async () => {
    const db = emptyDb()
    const ctx = fakeCtx(db)
    const imported = emptyDb()
    imported.projects = [{ id: 'archived', name: 'Archive', hue: 18, archived: true, order: 0, createdAt: 0, updatedAt: 0 }]
    imported.tasks = [task({ id: 'target', status: 'doing', projectId: 'archived' })]
    imported.sessions = [createSession({ taskId: 'target', taskTitle: 'target', plannedMs: 60_000, now: ctx.now() - 1000 })]
    ctx.runtime.recovery = { sessionId: 'old', lastKnownAt: 0 }
    ctx.runtime.pendingReview = { sessionId: 'old', thenStart: false }
    ctx.store.save = vi.fn().mockImplementationOnce(() => undefined).mockImplementation(() => { throw new Error('disk full') })
    ctx.dataIO.importData = async () => { Object.assign(db, imported); ctx.store.save(); return 'isolated-import.json' }
    ctx.publish = (persist = true) => { if (persist) ctx.store.save(); else ctx.calls.push('publish:memory') }
    const handlers = createHandlers(ctx)
    expect((await receive(handlers, 'data:import', {})).ok).toBe(false)
    expect(ctx.store.save).toHaveBeenCalledTimes(2)
    expect((await receive(handlers, 'state:get', {}))).toMatchObject({ ok: true, data: { live: { state: 'paused' } } })
    expect(ctx.runtime.recovery?.sessionId).toBe(imported.sessions[0]!.id)
    expect(ctx.runtime.pendingReview).toBeNull()
    expect(ctx.calls).toContain('publish:memory')
    expect(ctx.calls).not.toContain('ticker:start')
    const measured = focusMs(db.sessions[0]!, ctx.now())
    ctx.advance(1000)
    checkExpire(ctx)
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(measured)
    expect((await receive(handlers, 'session:resume', {})).ok).toBe(false)
  })

  it.each(['missing', 'done', 'blocked', 'external', 'hard', 'archived'])('rejects %s on start, switch, Doing update and move without partial changes', async (kind) => {
    const db = emptyDb()
    db.projects = [{ id: 'archived', name: 'Archive', hue: 18, archived: true, order: 0, createdAt: 0, updatedAt: 0 }]
    db.tasks = [task({ id: 'safe' }), task({ id: 'before', progress: 100 }), task({ id: 'target', ...(kind === 'done' ? { status: 'done' as const } : {}), ...(kind === 'blocked' ? { blocked: true, blockReason: '確認中' } : {}), ...(kind === 'external' ? { externalBlock: external } : {}), ...(kind === 'hard' ? { hardDependencies: ['before'] } : {}), ...(kind === 'archived' ? { projectId: 'archived' } : {}) })]
    const id = kind === 'missing' ? 'absent' : 'target'
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    const before = structuredClone(db)
    expect((await receive(handlers, 'session:start', { taskId: id })).ok).toBe(false)
    expect(db).toEqual(before)
    if (kind !== 'done') {
      expect((await receive(handlers, 'task:update', { id, patch: { status: 'doing' } })).ok).toBe(false)
      expect((await receive(handlers, 'task:move', { id, status: 'doing', index: 0 })).ok).toBe(false)
      expect(db).toEqual(before)
    }
    await handlers['session:start']({ taskId: 'safe' })
    const liveBefore = structuredClone(db)
    expect((await receive(handlers, 'session:switchTask', { taskId: id })).ok).toBe(false)
    expect(db).toEqual(liveBefore)
  })

  it('commits Inbox on start, permits advisory links and requires explicit Done reopening', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'before' }), task({ id: 'target', status: 'inbox', recommendedPredecessors: ['before'] })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    await handlers['session:start']({ taskId: 'target' })
    expect(db.tasks[1]!.status).toBe('doing')
    await handlers['session:end']({})
    await handlers['session:review']({ sessionId: db.sessions[0]!.id, changes: [{ taskId: 'target', from: 0, to: 100, markedDone: true }] })
    expect(db.tasks[1]!.status).toBe('done')
    expect(() => handlers['session:start']({ taskId: 'target' })).toThrow('Todo')
    await handlers['task:update']({ id: 'target', patch: { status: 'todo' } })
    await handlers['session:start']({ taskId: 'target' })
    expect(db.tasks[1]!.status).toBe('doing')
  })

  it('preserves dangling links on deletion, allows editing them, and unblocks only on unlink', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'before', status: 'done' }), task({ id: 'target', progress: 70, hardDependencies: ['before'] })]
    db.tasks = deleteTask(db, 'before')
    expect(db.tasks[0]!.hardDependencies).toEqual(['before'])
    expect(taskExecutionProblem(db, 'target')).toContain('削除')
    db.tasks = updateTask(db, 'target', { notes: '残った依存を確認' })
    expect(taskExecutionProblem(db, 'target')).toContain('削除')
    db.tasks = updateTask(db, 'target', { hardDependencies: [] })
    expect(taskExecutionProblem(db, 'target')).toBeNull()
    expect(db.tasks[0]!.progress).toBe(70)
  })

  it('rejects self/cyclic/new-missing/overlapping links atomically and rejects blocked Doing creation', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a', hardDependencies: ['b'] }), task({ id: 'b' })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    for (const patch of [{ hardDependencies: ['b'] }, { hardDependencies: ['a'] }, { hardDependencies: ['missing'] }, { hardDependencies: ['a'], recommendedPredecessors: ['a'] }]) {
      const before = structuredClone(db)
      expect((await receive(handlers, 'task:update', { id: 'b', patch })).ok).toBe(false)
      expect(db).toEqual(before)
    }
    expect(() => createTask(db, { title: 'blocked', status: 'doing', blocked: true })).toThrow('Blocked')
  })

  it('rejects changes that conflict with running or paused work through direct and agent paths', async () => {
    const db = emptyDb()
    db.projects = [{ id: 'project', name: 'P', hue: 18, archived: false, order: 0, createdAt: 0, updatedAt: 0 }]
    db.tasks = [task({ id: 'before', status: 'done' }), task({ id: 'active', projectId: 'project', hardDependencies: ['before'] })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    await handlers['session:start']({ taskId: 'active' })
    for (const paused of [false, true]) {
      if (paused) await handlers['session:pause']({})
      for (const [name, args] of [
        ['task:update', { id: 'active', patch: { blocked: true } }], ['task:update', { id: 'active', patch: { externalBlock: external } }],
        ['task:update', { id: 'before', patch: { status: 'todo' } }], ['task:delete', { id: 'before' }], ['task:delete', { id: 'active' }],
        ['project:update', { id: 'project', patch: { archived: true } }], ['task:move', { id: 'active', status: 'inbox', index: 0 }],
        ['session:update', { id: db.sessions[0]!.id, patch: {}, segmentTaskId: 'before' }],
      ] as const) {
        const before = structuredClone(db)
        expect((await receive(handlers, name, args)).ok).toBe(false)
        expect(db).toEqual(before)
      }
    }
    await handlers['task:update']({ id: 'active', patch: { progress: 70 } })
    expect(db.tasks[1]!.progress).toBe(70)
  })

  it.each(['blocked', 'missing', 'hard', 'archived'])('gates imported %s live work on manual, toggle, recovery, extension and automatic resumes', async (kind) => {
    const db = emptyDb()
    db.projects = [{ id: 'archived', name: 'A', hue: 18, archived: true, order: 0, createdAt: 0, updatedAt: 0 }]
    db.tasks = kind === 'missing' ? [] : [task({ id: 'active', status: 'doing', ...(kind === 'blocked' ? { blocked: true } : {}), ...(kind === 'hard' ? { hardDependencies: ['missing'] } : {}), ...(kind === 'archived' ? { projectId: 'archived' } : {}) })]
    const ctx = fakeCtx(db)
    const live = createSession({ taskId: 'active', taskTitle: 'active', plannedMs: 60_000, mode: 'pomodoro', pomodoroAutoResume: true, now: ctx.now() - 60_000 })
    db.sessions = [pauseSession(live, ctx.now(), 'manual')]
    ctx.runtime.recovery = { sessionId: live.id, lastKnownAt: ctx.now() }
    const handlers = createHandlers(ctx)
    for (const name of ['session:resume', 'session:toggle', 'recovery:resume', 'session:extend'] as const) expect((await receive(handlers, name, {})).ok).toBe(false)
    expect(db.sessions[0]!.state).toBe('paused')
    db.sessions = [startBreak({ ...live, expiredNotifiedAt: ctx.now() - 1 }, 1, ctx.now() - 61_000)]
    checkExpire(ctx)
    expect(db.sessions[0]!.pauses.some((item) => item.reason === 'break' && item.endedAt === null)).toBe(true)
    db.sessions = [pauseSession(live, ctx.now(), 'task-management')]
    ctx.runtime.currentWorkOpen = true
    setCurrentWorkOpen(ctx, false)
    expect(db.sessions[0]!.state).toBe('paused')
    db.sessions = [live]
    restoreOpenSession(ctx, 60_000)
    expect(db.sessions[0]!.state).toBe('paused')
  })

  it('preserves progress/status/doneAt and goal outcome on external save/unblock and review completion', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'target', progress: 70 }), task({ id: 'legacy-done', status: 'done', progress: 70, doneAt: null })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    const goal = await handlers['goal:create']({ goal: '成果物を確認する' })
    await handlers['task:update']({ id: 'target', patch: { goalNodeId: goal.id } })
    const goals = structuredClone(db.goalMap)
    await handlers['task:update']({ id: 'target', patch: { externalBlock: external } })
    await handlers['task:update']({ id: 'target', patch: { externalBlock: null } })
    await handlers['task:update']({ id: 'legacy-done', patch: { externalBlock: external } })
    await handlers['task:update']({ id: 'legacy-done', patch: { externalBlock: null } })
    expect(db.tasks[0]).toMatchObject({ progress: 70, status: 'todo', doneAt: null })
    expect(db.tasks[1]).toMatchObject({ progress: 70, status: 'done', doneAt: null })
    expect(db.goalMap).toEqual(goals)
    const session = await handlers['session:start']({ taskId: 'target' })
    await handlers['session:end']({})
    await handlers['session:review']({ sessionId: session!.id, changes: [{ taskId: 'target', from: 70, to: 100, markedDone: true }] })
    expect(db.tasks[0]).toMatchObject({ progress: 100, status: 'done', doneAt: expect.any(Number) })
    expect(db.goalMap).toEqual(goals)
  })

  it('agent completion of a current task is rejected and imported blockers can be removed independently', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'active', status: 'doing', blocked: true, blockReason: '旧理由', hardDependencies: ['missing'] })]
    const ctx = fakeCtx(db)
    const live = createSession({ taskId: 'active', taskTitle: 'active', plannedMs: 60_000, now: ctx.now() })
    db.sessions = [pauseSession(live, ctx.now(), 'manual'), { ...live, id: 'past', state: 'ended', endedAt: ctx.now() }]
    const handlers = createHandlers(ctx)
    await handlers['task:update']({ id: 'active', patch: { blockReason: '理由の訂正' } })
    await handlers['task:update']({ id: 'active', patch: { blocked: false } })
    expect(taskExecutionProblem(db, 'active')).toContain('リンク解除')
    await handlers['task:update']({ id: 'active', patch: { hardDependencies: [] } })
    expect(taskExecutionProblem(db, 'active')).toBeNull()
    const proposal = await handlers['agent:propose']({ sessionId: 'past', taskId: 'active', reason: '進捗の提案', markDone: true })
    const before = structuredClone(db)
    expect((await receive(handlers, 'agent:resolve', { id: proposal.id, accept: true })).ok).toBe(false)
    expect(db).toEqual(before)
  })

  it('rolls back task/start/switch/review changes on save failure, before window side effects', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const ctx = fakeCtx(db)
    ctx.publish = () => ctx.store.save()
    ctx.store.save = vi.fn(() => { throw new Error('disk full') })
    const handlers = createHandlers(ctx)
    for (const [name, args] of [['task:update', { id: 'a', patch: { externalBlock: external } }], ['task:move', { id: 'a', status: 'doing', index: 0 }], ['task:delete', { id: 'a' }], ['session:start', { newTask: { title: 'new' } }]] as const) {
      const before = structuredClone(db)
      expect((await receive(handlers, name, args)).ok).toBe(false)
      expect(db).toEqual(before)
    }
    ctx.store.save = vi.fn()
    await handlers['session:start']({ taskId: 'a' })
    ctx.calls.length = 0
    ctx.store.save = vi.fn(() => { throw new Error('disk full') })
    const before = structuredClone(db)
    expect((await receive(handlers, 'session:switchTask', { taskId: 'b' })).ok).toBe(false)
    expect(db).toEqual(before)
    expect(ctx.calls).toEqual([])
    db.sessions[0] = { ...db.sessions[0]!, state: 'ended', endedAt: ctx.now() }
    ctx.runtime.pendingReview = { sessionId: db.sessions[0]!.id, thenStart: false }
    const ended = structuredClone(db)
    expect((await receive(handlers, 'session:review', { sessionId: db.sessions[0]!.id, changes: [{ taskId: 'a', from: 0, to: 100, markedDone: true }] })).ok).toBe(false)
    expect(db).toEqual(ended)
    expect(ctx.runtime.pendingReview).not.toBeNull()
  })

  it('rolls back manual and recovery resume on save failure while preserving recovery UI', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'active', status: 'doing' })]
    const ctx = fakeCtx(db)
    const live = createSession({ taskId: 'active', taskTitle: 'active', plannedMs: 60_000, now: ctx.now() })
    db.sessions = [pauseSession(live, ctx.now(), 'manual')]
    ctx.runtime.recovery = { sessionId: live.id, lastKnownAt: ctx.now() }
    ctx.publish = () => { throw new Error('disk full') }
    const handlers = createHandlers(ctx)
    const before = structuredClone(db)
    for (const name of ['session:resume', 'recovery:resume'] as const) {
      expect((await receive(handlers, name, {})).ok).toBe(false)
      expect(db).toEqual(before)
      expect(ctx.runtime.recovery).not.toBeNull()
      expect(ctx.calls).toEqual([])
    }
  })

  it('keeps blocked recovery stopped on save failure and rolls back other lifecycle edits', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'active', status: 'doing', blocked: true })]
    const ctx = fakeCtx(db)
    ctx.publish = (persist = true) => { if (persist) throw new Error('disk full') }
    const live = createSession({ taskId: 'active', taskTitle: 'active', plannedMs: 60_000, now: ctx.now() })
    db.sessions = [live]
    expect(() => restoreOpenSession(ctx, 60_000)).toThrow('disk full')
    expect(db.sessions[0]!.state).toBe('paused')
    expect(ctx.runtime.recovery).not.toBeNull()
    expect(ctx.calls).toEqual(['ticker:stop'])
    ctx.calls.length = 0
    ctx.runtime.recovery = null
    ctx.runtime.currentWorkOpen = true
    db.sessions = [pauseSession(live, ctx.now(), 'task-management')]
    const managing = structuredClone(db)
    expect(() => setCurrentWorkOpen(ctx, false)).toThrow('disk full')
    expect(db).toEqual(managing)
    expect(ctx.runtime.currentWorkOpen).toBe(true)
    db.tasks[0] = { ...db.tasks[0]!, blocked: false }
    db.sessions = [startBreak({ ...live, mode: 'pomodoro', pomodoroAutoResume: true }, 0.01, ctx.now())]
    ctx.runtime.currentWorkOpen = false
    ctx.advance(1000)
    const breaking = structuredClone(db)
    expect(() => checkExpire(ctx)).toThrow('disk full')
    expect(db).toEqual(breaking)
    expect(ctx.calls).toEqual([])
    db.tasks[0] = { ...db.tasks[0]!, blocked: true }
    const blockedBreak = structuredClone(db)
    expect(() => checkExpire(ctx)).toThrow('disk full')
    expect(db).toEqual(blockedBreak)
    expect(ctx.calls).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { createHandlers } from '../src/app/handlers.js'
import { buildState } from '../src/app/state.js'
import { createFixedWork, setWeeklyBudget, updateFixedWork } from '../src/domain/planning-ops.js'
import { recommendTasks, taskControl } from '@white-box/core/task-priority'
import { emptyDb, fakeCtx, task } from './helpers.js'

const plan = { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 60, allocations: [{ projectId: 'p', mode: 'minimum' as const, minutes: 120 }] }
const project = { id: 'p', name: 'P', hue: 18, archived: false, order: 0, createdAt: 0, updatedAt: 0 }
function context() {
  const db = emptyDb()
  db.projects = [project]
  db.tasks = [task({ id: 't', projectId: 'p', notes: 'old notes', nextContext: 'return here' })]
  return fakeCtx(db)
}
describe('phase 2 planned resources and task context', () => {
  it('reuses defaults without aliasing previous week and retains original creation time', () => {
    const ctx = context()
    const handlers = createHandlers(ctx)
    handlers['weeklyBudget:set']({ weekStart: '2026-10-05', plan, reuseAsDefault: true })
    ctx.advance(100)
    handlers['weeklyBudget:reuseDefaults']({ weekStart: '2026-10-12' })
    ctx.store.data.weeklyBudgets![1]!.allocations[0]!.projectId = 'edited locally'
    expect(ctx.store.data.weeklyBudgetDefaults!.allocations[0]!.projectId).toBe('p')
    expect(ctx.store.data.weeklyBudgets![0]!.allocations[0]!.projectId).toBe('p')
    const updated = setWeeklyBudget(ctx.store.data, '2026-10-05', plan, ctx.now()).budget
    expect(updated.createdAt).toBe(ctx.now() - 100)
    expect(updated.updatedAt).toBe(ctx.now())
  })
  it('requires reusable defaults and existing allocation projects', () => {
    const ctx = context()
    expect(() => createHandlers(ctx)['weeklyBudget:reuseDefaults']({ weekStart: '2026-10-05' })).toThrow('既定配分')
    expect(() => setWeeklyBudget(ctx.store.data, '2026-10-05', { ...plan, allocations: [{ projectId: 'missing', mode: 'unlimited' }] }, ctx.now())).toThrow('プロジェクト')
  })
  it('registers external work without starting a session, committing a task or opening a timer', () => {
    const ctx = context()
    ctx.store.data.tasks[0]!.status = 'inbox'
    const before = structuredClone(ctx.store.data.tasks)
    createHandlers(ctx)['fixedWork:create']({ taskId: 't', startedAt: ctx.now() + 1, endedAt: ctx.now() + 60_001, externalReason: ' external meeting ' })
    expect(ctx.store.data.sessions).toEqual([])
    expect(ctx.store.data.tasks).toEqual(before)
    expect(ctx.store.data.fixedWork![0]!.externalReason).toBe('external meeting')
    expect(ctx.calls).toEqual(['publish'])
  })
  it('rejects retroactive creation, unknown/done tasks and invalid edited ranges', () => {
    const ctx = context()
    const input = { taskId: 't', startedAt: ctx.now() + 1, endedAt: ctx.now() + 60_001, externalReason: 'meeting' }
    expect(() => createFixedWork(ctx.store.data, { ...input, startedAt: ctx.now() }, ctx.now())).toThrow('開始前')
    expect(() => createFixedWork(ctx.store.data, { ...input, taskId: 'missing' }, ctx.now())).toThrow('作業タスク')
    const created = createFixedWork(ctx.store.data, input, ctx.now())
    ctx.store.data.fixedWork = created.fixedWork
    expect(() => updateFixedWork(ctx.store.data, created.work.id, { endedAt: input.startedAt }, ctx.now())).toThrow('終了')
    ctx.advance(2)
    expect(() => updateFixedWork(ctx.store.data, created.work.id, { startedAt: ctx.now() + 10 }, ctx.now())).toThrow('開始後')
  })
  it('preserves cancelled registration and immutable creation time', () => {
    const ctx = context()
    const r = createFixedWork(ctx.store.data, { taskId: 't', startedAt: ctx.now() + 1000, endedAt: ctx.now() + 2000, externalReason: 'meeting' }, ctx.now())
    ctx.store.data.fixedWork = r.fixedWork
    ctx.advance(100)
    ctx.store.data.fixedWork = updateFixedWork(ctx.store.data, r.work.id, { cancelled: true }, ctx.now())
    expect(ctx.store.data.fixedWork[0]).toMatchObject({ id: r.work.id, cancelled: true, createdAt: ctx.now() - 100, updatedAt: ctx.now() })
  })
  it('keeps project priority separate from task priority and risk', () => {
    const ctx = context()
    const handlers = createHandlers(ctx)
    handlers['project:update']({ id: 'p', patch: { priority: 'high' } })
    expect(ctx.store.data.tasks[0]!.priority).toBe('normal')
    const control = taskControl(ctx.store.data.tasks[0]!, [], ctx.now(), 3, ctx.store.data.projects)
    expect(control.projectPriority).toBe('high')
    expect(control.risk).toBe('normal')
    const tasks = [task({ id: 'first', projectId: null, order: 0 }), task({ id: 'important', projectId: 'p', order: 1 })]
    expect(recommendTasks(tasks, [], ctx.now(), 3, ctx.store.data.projects)[0]!.id).toBe('important')
  })
  it('context editing preserves old notes, linked notes, progress and commitment anchors', () => {
    const ctx = context()
    ctx.store.data.tasks[0]!.committedAt = 10
    ctx.store.data.tasks[0]!.lastProgressAt = 20
    ctx.store.data.notes = [{ id: 'note', title: 'linked', body: 'content', taskId: 't', projectId: null, pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 0, updatedAt: 0 }]
    createHandlers(ctx)['task:update']({ id: 't', patch: { problems: 'problem', decisions: 'decision', nextContext: 'next step' } })
    expect(ctx.store.data.tasks[0]).toMatchObject({ notes: 'old notes', problems: 'problem', decisions: 'decision', nextContext: 'next step', progress: 0, committedAt: 10, lastProgressAt: 20 })
    expect(buildState(ctx.store.data, ctx.runtime, ctx.now()).notes![0]!.taskId).toBe('t')
  })
  it('restores all changed planning/context fields when persistence fails', () => {
    const ctx = context()
    const snapshot = structuredClone(ctx.store.data)
    ctx.publish = () => { throw new Error('save failure') }
    const handlers = createHandlers(ctx)
    expect(() => handlers['weeklyBudget:set']({ weekStart: '2026-10-05', plan, reuseAsDefault: true })).toThrow('save failure')
    expect(() => handlers['fixedWork:create']({ taskId: 't', startedAt: ctx.now() + 1, endedAt: ctx.now() + 2, externalReason: 'meeting' })).toThrow('save failure')
    expect(() => handlers['project:update']({ id: 'p', patch: { priority: 'high' } })).toThrow('save failure')
    expect(() => handlers['task:update']({ id: 't', patch: { problems: 'unsaved' } })).toThrow('save failure')
    expect(ctx.store.data).toEqual(snapshot)
    expect(Object.keys(ctx.store.data)).toEqual(Object.keys(snapshot))
    expect(ctx.store.data).not.toHaveProperty('weeklyBudgets')
    expect(ctx.store.data).not.toHaveProperty('weeklyBudgetDefaults')
    expect(ctx.store.data).not.toHaveProperty('fixedWork')
  })
})

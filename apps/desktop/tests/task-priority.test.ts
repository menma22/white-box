import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import { taskControl, recommendTasks } from '@white-box/core/task-priority'
import { createHandlers } from '../src/app/handlers.js'
import { createTask, moveTask, updateTask } from '../src/domain/task-ops.js'
import { normalizeDatabase } from '../src/infra/store.js'
import { importGoals } from '../src/domain/goal-ops.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
const DAY = 86_400_000

describe('見積と Aging の保存・遷移', () => {
  it('初回 Todo に置いた瞬間を記録し、Inbox では記録しない', () => {
    const db = emptyDb()
    const inbox = createTask(db, { title: '後で考える' }, 100).task
    expect(inbox.committedAt).toBeUndefined()
    const todo = createTask(db, { title: 'やる', status: 'todo', remainingEffortMinutes: 90, safetyBufferMinutes: 0 }, 100).task
    expect(todo.committedAt).toBe(100)
    expect(todo.remainingEffortMinutes).toBe(90)
    expect(todo.safetyBufferMinutes).toBe(0)
  })
  it.each(['update', 'move'] as const)('長く Inbox にいたタスクを %s で Todo に置いても即警告しない', (operation) => {
    const db = emptyDb()
    db.tasks = [task({ id: 'old', status: 'inbox', createdAt: 0, lastProgressAt: DAY })]
    const now = 100 * DAY
    const tasks = operation === 'update' ? updateTask(db, 'old', { status: 'todo' }, now) : moveTask(db, 'old', 'todo', 0, now)
    expect(tasks[0]!.committedAt).toBe(now)
    expect(taskControl(tasks[0]!, [], now, 3).risk).toBe('normal')
    expect(taskControl(tasks[0]!, [], now, 3).agingDays).toBe(0)
  })
  it('Inbox への差し戻しを挟むと以前のコミット・進捗を繰り越さない', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't', committedAt: DAY, lastProgressAt: 2 * DAY })]
    db.tasks = updateTask(db, 't', { status: 'inbox' }, 5 * DAY)
    expect(db.tasks[0]!.committedAt).toBeNull()
    db.tasks = moveTask(db, 't', 'todo', 0, 20 * DAY)
    expect(taskControl(db.tasks[0]!, [], 20 * DAY, 3).agingDays).toBe(0)
  })
  it('実際の進捗変更だけが起点をリセットし、メモや同じ進捗はリセットしない', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't', committedAt: DAY, lastProgressAt: DAY, progress: 20 })]
    let next = updateTask(db, 't', { notes: '次はここ', priority: 'high', remainingEffortMinutes: 30, progress: 20 }, 10 * DAY)[0]!
    expect(next.lastProgressAt).toBe(DAY)
    next = updateTask({ ...db, tasks: [next] }, 't', { progress: 30 }, 11 * DAY)[0]!
    expect(next.lastProgressAt).toBe(11 * DAY)
    expect(taskControl(next, [], 11 * DAY, 3).agingDays).toBe(0)
  })
  it('旧データ・旧取込で未入力の見積・安全余裕・起点を作らない', () => {
    const original = task({ id: 'legacy', status: 'todo', createdAt: 0 })
    const db = normalizeDatabase({ tasks: [original] })
    expect(db.tasks[0]).toEqual(original)
    for (const field of ['remainingEffortMinutes', 'safetyBufferMinutes', 'committedAt', 'lastProgressAt']) expect(Object.hasOwn(db.tasks[0]!, field)).toBe(false)
    expect(taskControl(db.tasks[0]!, [], 100 * DAY, 3).agingDays).toBeNull()
    const imported = importGoals(emptyDb(), { ...emptyDb().goalMap, version: 1,
      tasks: [{ id: 'old', title: '旧道標のタスク', priority: 'high', due: '', done: false, createdAt: 0 }],
    }).tasks[0]!
    for (const field of ['remainingEffortMinutes', 'safetyBufferMinutes', 'committedAt', 'lastProgressAt']) expect(Object.hasOwn(imported, field)).toBe(false)
    expect(taskControl(imported, [], 100 * DAY, 3).risk).toBe('normal')
  })
  it('取込で壊れた任意値を拒否し、旧閾値の不正値は既定へ戻す', () => {
    for (const key of ['remainingEffortMinutes', 'safetyBufferMinutes', 'committedAt', 'lastProgressAt']) {
      for (const value of [-1, Infinity, '30']) expect(() => normalizeDatabase({ tasks: [{ ...task({ id: 't' }), [key]: value }] })).toThrow()
    }
    for (const days of [0, -1, Infinity]) expect(normalizeDatabase({ settings: { ...emptyDb().settings, stallWarningDays: days } }).settings.stallWarningDays).toBe(3)
  })
  it('セッション・レビューを保存しても残作業見積を減らさない', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't', remainingEffortMinutes: 90, safetyBufferMinutes: 15 })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    handlers['session:start']({ taskId: 't', minutes: 30 })
    expect(db.tasks[0]!.committedAt).toBe(ctx.now())
    ctx.advance(10 * 60_000)
    handlers['session:end']({})
    handlers['session:review']({ sessionId: db.sessions[0]!.id, changes: [{ taskId: 't', from: 0, to: 20, markedDone: false }] })
    expect(db.tasks[0]!.remainingEffortMinutes).toBe(90)
    expect(db.tasks[0]!.lastProgressAt).toBe(ctx.now())
    handlers['task:move']({ id: 't', status: 'todo', index: 0 })
    expect(taskControl(db.tasks[0]!, db.sessions, ctx.now(), 3).agingDays).toBe(0)
  })
  it('推薦順があっても任意のタスクを開始できる', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'first', priority: 'high' }), task({ id: 'chosen', priority: 'low' })]
    const ctx = fakeCtx(db)
    expect(recommendTasks(db.tasks, [], ctx.now(), 3)[0]!.id).toBe('first')
    createHandlers(ctx)['session:start']({ taskId: 'chosen', minutes: 30 })
    expect(db.sessions[0]!.segments[0]!.taskId).toBe('chosen')
  })
})

describe('保存失敗の復元', () => {
  it.each([
    { label: '単独', patch: { stallWarningDays: 10 } },
    { label: '複合', patch: { stallWarningDays: 10, displayName: 'after' } },
  ])('$label の設定 patch は save・publish の失敗で設定全体を復元する', ({ patch }) => {
    for (const failure of ['save', 'publish']) {
      const ctx = fakeCtx()
      const before = ctx.store.data.settings
      const snapshot = structuredClone(before)
      ctx.publish = () => {
        ctx.store.save()
        if (failure === 'publish') throw new Error('配信に失敗')
        ctx.calls.push('publish')
      }
      if (failure === 'save') ctx.store.save = () => { throw new Error('保存に失敗') }
      expect(() => createHandlers(ctx)['settings:update']({ patch })).toThrow(failure === 'save' ? '保存に失敗' : '配信に失敗')
      expect(ctx.store.data.settings).toBe(before)
      expect(ctx.store.data.settings).toEqual(snapshot)
      expect(ctx.calls).not.toContain('publish')
    }
  })
  it.each(['task:create', 'task:update', 'task:move', 'session:start'] as const)('%s は失敗した値を残さない', (command) => {
    const db = emptyDb()
    db.tasks = [task({ id: 't', status: 'inbox' })]
    const ctx = fakeCtx(db)
    const before = structuredClone(db)
    ctx.publish = () => { throw new Error('保存に失敗') }
    const handlers = createHandlers(ctx)
    const action = {
      'task:create': () => handlers['task:create']({ title: '新規', status: 'todo' }),
      'task:update': () => handlers['task:update']({ id: 't', patch: { progress: 20, remainingEffortMinutes: 90 } }),
      'task:move': () => handlers['task:move']({ id: 't', status: 'todo', index: 0 }),
      'session:start': () => handlers['session:start']({ taskId: 't', minutes: 30 }),
    }[command]
    expect(action).toThrow('保存に失敗')
    expect(db).toEqual(before)
    expect(ctx.calls).toEqual([])
  })
  it('終了・レビューはタスク、セッション、pendingReview と窓を操作前に保つ', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't' })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    handlers['session:start']({ taskId: 't', minutes: 30 })
    const publish = ctx.publish
    ctx.calls.length = 0
    ctx.publish = () => { throw new Error('保存に失敗') }
    const beforeEnd = structuredClone(db)
    expect(() => handlers['session:end']({})).toThrow('保存に失敗')
    expect(db).toEqual(beforeEnd)
    expect(ctx.runtime.pendingReview).toBeNull()
    expect(ctx.calls).toEqual([])
    ctx.publish = publish
    ctx.advance(60_000)
    handlers['session:end']({ thenStart: true })
    const beforeReview = structuredClone(db)
    const pending = ctx.runtime.pendingReview
    ctx.calls.length = 0
    ctx.publish = () => { throw new Error('保存に失敗') }
    expect(() => handlers['session:review']({ sessionId: db.sessions[0]!.id, changes: [{ taskId: 't', from: 0, to: 30, markedDone: false }], note: '進めた' })).toThrow('保存に失敗')
    expect(db).toEqual(beforeReview)
    expect(ctx.runtime.pendingReview).toBe(pending)
    expect(ctx.calls).toEqual([])
  })
  it('タスク切替と作業記録の編集は失敗時に作業起点を動かさない', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't' }), task({ id: 'other' })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    handlers['session:start']({ taskId: 't', minutes: 30 })
    ctx.publish = () => { throw new Error('保存に失敗') }
    const before = structuredClone(db)
    expect(() => handlers['session:switchTask']({ taskId: 'other' })).toThrow('保存に失敗')
    expect(db).toEqual(before)
    expect(() => handlers['session:update']({ id: db.sessions[0]!.id, patch: { note: 'メモ' } })).toThrow('保存に失敗')
    expect(db).toEqual(before)
  })
  it('操作直前の満了判定が保存に失敗しても、作業状態と窓を変えない', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't' })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    handlers['session:start']({ taskId: 't', minutes: 1 })
    ctx.advance(60_000)
    const before = structuredClone(db)
    ctx.calls.length = 0
    ctx.publish = () => { throw new Error('保存に失敗') }
    expect(() => handlers['session:end']({})).toThrow('保存に失敗')
    expect(db).toEqual(before)
    expect(ctx.runtime.pendingReview).toBeNull()
    expect(ctx.calls).toEqual([])
  })
})

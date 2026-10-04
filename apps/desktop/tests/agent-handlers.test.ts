import { describe, expect, it } from 'vitest'
import { parseArgs } from '@white-box/contracts'
import type { Session } from '@white-box/core/types'
import { focusMs } from '@white-box/core/engine'
import { createAgentHandlers } from '../src/app/agent-handlers.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

function endedSession(id = 's'): Session {
  return { id, state: 'ended', startedAt: 0, endedAt: 1200000, plannedMs: 1200000, segments: [{ id: 'seg', taskId: 'unknown', startedAt: 0, endedAt: 1200000 }], pauses: [{ startedAt: 300000, endedAt: 600000, reason: 'manual' }], events: [], progressChanges: [], note: '既存の記録', expiredNotifiedAt: null, editedAt: null, createdAt: 0 }
}

function context() {
  const db = emptyDb()
  db.projects = [{ id: 'p', name: 'Project', archived: false, hue: 100, order: 0, createdAt: 0, updatedAt: 0 }]
  db.goalMap.nodes = { g: { id: 'g', goal: '検証する', reason: '', parentId: null, children: [], hidden: false, hiddenAt: null, hideReason: '' } }
  db.goalMap.heads = ['g']
  db.tasks = [task({ id: 'existing', projectId: 'p', goalNodeId: 'g' })]
  db.sessions = [endedSession()]
  const ctx = fakeCtx(db)
  return { ctx, handlers: createAgentHandlers(ctx) }
}

describe('AIタスク登録', () => {
  it('親子・既存親・プロジェクト・目標・期限・優先度・メモをInboxへ一括保存する', () => {
    const { ctx, handlers } = context()
    const result = handlers['agent:applyPlan'](parseArgs('agent:applyPlan', { requestId: 'plan-1', tasks: [
      { title: '親', projectId: 'p', goalNodeId: 'g', due: '2026-12-31', priority: 'high', notes: '本人の意図' },
      { title: '子', parentIndex: 0 }, { title: '孫', parentIndex: 1 }, { title: '既存親の子', parentId: 'existing' },
    ] }))
    expect(result).toHaveLength(4)
    expect(result[0]).toMatchObject({ title: '親', projectId: 'p', goalNodeId: 'g', due: '2026-12-31', priority: 'high', notes: '本人の意図', status: 'inbox', progress: 0 })
    expect(result[1]).toMatchObject({ parentId: result[0]!.id, projectId: 'p' })
    expect(result[2]).toMatchObject({ parentId: result[1]!.id, projectId: 'p' })
    expect(result[3]).toMatchObject({ parentId: 'existing', projectId: 'p' })
    expect(ctx.store.data.agentRequests?.['plan-1']?.taskIds).toEqual(result.map((item) => item.id))
    expect(ctx.calls).toEqual(['publish'])
  })

  it.each([
    { title: '不明なプロジェクト', projectId: 'missing' },
    { title: '不明な親', parentId: 'missing' },
    { title: '不明な目標', goalNodeId: 'missing' },
    { title: '後ろの親', parentIndex: 2 },
    { title: '存在しない日付', due: '2026-02-30' },
  ])('途中の失敗でも先行タスク・依頼履歴を保存しない: $title', (invalid) => {
    const { ctx, handlers } = context()
    const before = JSON.stringify(ctx.store.data)
    const args = parseArgs('agent:applyPlan', { requestId: 'failed-plan', tasks: [{ title: '先行する正常なタスク' }, invalid] })
    expect(() => handlers['agent:applyPlan'](args)).toThrow()
    expect(JSON.stringify(ctx.store.data)).toBe(before)
    expect(ctx.calls).toEqual([])
  })

  it('同じ依頼の再送は同じIDを返し、変更された再送は保存せず拒否する', () => {
    const { ctx, handlers } = context()
    const args = parseArgs('agent:applyPlan', { requestId: 'retry', tasks: [{ title: '一度だけ' }] })
    const first = handlers['agent:applyPlan'](args)
    const before = JSON.stringify(ctx.store.data)
    const retry = handlers['agent:applyPlan'](parseArgs('agent:applyPlan', { tasks: [{ title: '一度だけ' }], requestId: 'retry' }))
    expect(retry.map((item) => item.id)).toEqual(first.map((item) => item.id))
    expect(JSON.stringify(ctx.store.data)).toBe(before)
    expect(ctx.calls).toEqual(['publish'])
    expect(() => handlers['agent:applyPlan'](parseArgs('agent:applyPlan', { requestId: 'retry', tasks: [{ title: '異なる依頼' }] }))).toThrow('異なる')
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })

  it('登録済みタスクが削除されていたら、再送で別のタスクを作らない', () => {
    const { ctx, handlers } = context()
    const args = parseArgs('agent:applyPlan', { requestId: 'deleted', tasks: [{ title: '登録後に削除' }] })
    const result = handlers['agent:applyPlan'](args)
    ctx.store.data.tasks = ctx.store.data.tasks.filter((item) => item.id !== result[0]!.id)
    const before = JSON.stringify(ctx.store.data)
    expect(() => handlers['agent:applyPlan'](args)).toThrow('削除')
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })
})

describe('AIの実績提案', () => {
  it.each([false, true])('確認・却下後の同じ提案の再送は結果を返し、二重反映を防ぐ（採用=%s）', (accept) => {
    const { ctx, handlers } = context()
    const args = parseArgs('agent:propose', { sessionId: 's', title: '再送される調査', reason: '本人のメモ', markDone: true })
    const proposed = handlers['agent:propose'](args)
    handlers['agent:resolve']({ id: proposed.id, accept })
    const before = JSON.stringify(ctx.store.data)
    const retry = handlers['agent:propose'](args)
    expect(retry.id).toBe(proposed.id)
    expect(retry.status).toBe(accept ? 'accepted' : 'dismissed')
    handlers['agent:resolve']({ id: retry.id, accept: true })
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })

  it.each([false, true])('空区間の未割当記録を本人確認で割り当て、時刻・停止・除外・メモを保持する（完了=%s）', (markDone) => {
    const { ctx, handlers } = context()
    const session = ctx.store.data.sessions[0]!
    session.segments = []
    session.pauses.push({ startedAt: 700000, endedAt: 800000, reason: 'excluded' })
    const before = structuredClone(session)
    const workMs = focusMs(session, ctx.now())
    const proposed = handlers['agent:propose']({ sessionId: session.id, title: '未割当だった調査', reason: '本人のメモ', markDone })
    expect(ctx.store.data.sessions[0]).toEqual(before)
    handlers['agent:resolve']({ id: proposed.id, accept: true })
    const assigned = ctx.store.data.sessions[0]!
    const created = ctx.store.data.tasks.find((item) => item.title === '未割当だった調査')!
    expect(assigned.segments).toHaveLength(1)
    expect(assigned.segments[0]).toMatchObject({ taskId: created.id, startedAt: before.startedAt, endedAt: before.endedAt })
    expect(assigned).toMatchObject({ startedAt: before.startedAt, endedAt: before.endedAt, pauses: before.pauses, note: before.note, plannedMs: before.plannedMs })
    expect(focusMs(assigned, ctx.now())).toBe(workMs)
    expect(created.status).toBe(markDone ? 'done' : 'todo')
    expect(created.progress).toBe(markDone ? 100 : 0)
    expect(ctx.store.data.taskSuggestions![0]!.status).toBe('accepted')
  })

  it('確認前に既存タスクが消えたときはセッションと未確認提案を変更しない', () => {
    const { ctx, handlers } = context()
    const proposed = handlers['agent:propose']({ sessionId: 's', taskId: 'existing', reason: '本人のメモ', markDone: true })
    ctx.store.data.tasks = []
    const before = JSON.stringify(ctx.store.data)
    expect(() => handlers['agent:resolve']({ id: proposed.id, accept: true })).toThrow('見つかりません')
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })

  it('未知の作業は提案だけを保存し、本人の確認後にタスクを作成・割当・完了する', () => {
    const { ctx, handlers } = context()
    const sessionBefore = structuredClone(ctx.store.data.sessions[0]!)
    const tasksBefore = structuredClone(ctx.store.data.tasks)
    const proposed = handlers['agent:propose'](parseArgs('agent:propose', { sessionId: 's', title: '実際に調べた作業', reason: '本人が残した実行メモ', markDone: true }))
    expect(ctx.store.data.sessions[0]).toEqual(sessionBefore)
    expect(ctx.store.data.tasks).toEqual(tasksBefore)
    expect(proposed).toMatchObject({ status: 'pending', taskId: null, markDone: true, resolvedAt: null })
    expect(handlers['agent:propose'](parseArgs('agent:propose', { sessionId: 's', title: '再送', reason: '再送' })).id).toBe(proposed.id)
    expect(ctx.store.data.taskSuggestions).toHaveLength(1)
    handlers['agent:resolve']({ id: proposed.id, accept: true })
    const newTask = ctx.store.data.tasks.find((item) => item.title === '実際に調べた作業')!
    expect(newTask).toMatchObject({ status: 'done', progress: 100 })
    expect(newTask.doneAt).not.toBeNull()
    expect(ctx.store.data.sessions[0]).toMatchObject({ startedAt: sessionBefore.startedAt, endedAt: sessionBefore.endedAt, pauses: sessionBefore.pauses, note: sessionBefore.note, editedAt: ctx.now() })
    expect(ctx.store.data.sessions[0]!.segments[0]!.taskId).toBe(newTask.id)
    expect(ctx.store.data.taskSuggestions![0]).toMatchObject({ status: 'accepted', resolvedAt: ctx.now() })
    const accepted = JSON.stringify(ctx.store.data)
    handlers['agent:resolve']({ id: proposed.id, accept: true })
    expect(JSON.stringify(ctx.store.data)).toBe(accepted)
  })

  it('既存タスクへの割当だけを確認し、完了提案がないときは状態を変えない', () => {
    const { ctx, handlers } = context()
    const proposed = handlers['agent:propose']({ sessionId: 's', taskId: 'existing', reason: '本人の記録' })
    handlers['agent:resolve']({ id: proposed.id, accept: true })
    expect(ctx.store.data.tasks).toHaveLength(1)
    expect(ctx.store.data.tasks[0]).toMatchObject({ id: 'existing', status: 'todo', progress: 0, doneAt: null })
    expect(ctx.store.data.sessions[0]!.segments[0]!.taskId).toBe('existing')
  })

  it('却下はタスクとセッションを変えず、提案だけを解決する', () => {
    const { ctx, handlers } = context()
    const proposed = handlers['agent:propose']({ sessionId: 's', title: '採用しない', reason: '根拠', markDone: true })
    const tasksBefore = structuredClone(ctx.store.data.tasks), sessionsBefore = structuredClone(ctx.store.data.sessions)
    handlers['agent:resolve']({ id: proposed.id, accept: false })
    expect(ctx.store.data.tasks).toEqual(tasksBefore)
    expect(ctx.store.data.sessions).toEqual(sessionsBefore)
    expect(ctx.store.data.taskSuggestions![0]).toMatchObject({ status: 'dismissed', resolvedAt: ctx.now() })
  })

  it('複数区間の記録を一括上書きせず、タスクと提案も変更しない', () => {
    const { ctx, handlers } = context()
    ctx.store.data.sessions[0]!.segments.push({ id: 'second', taskId: 'existing', startedAt: 600000, endedAt: 1200000 })
    const proposed = handlers['agent:propose']({ sessionId: 's', title: '一括上書きは禁止', reason: '複数区間', markDone: true })
    const before = JSON.stringify(ctx.store.data)
    expect(() => handlers['agent:resolve']({ id: proposed.id, accept: true })).toThrow('タスク切替')
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })

  it('消えた関連先・終了していない記録・名前のない未知作業を拒否する', () => {
    const { ctx, handlers } = context()
    const before = JSON.stringify(ctx.store.data)
    expect(() => handlers['agent:propose']({ sessionId: 'missing', title: '名称', reason: '根拠' })).toThrow('終了')
    expect(() => handlers['agent:propose']({ sessionId: 's', taskId: 'missing', reason: '根拠' })).toThrow('タスク')
    expect(() => handlers['agent:propose']({ sessionId: 's', reason: '根拠' })).toThrow('未知')
    expect(JSON.stringify(ctx.store.data)).toBe(before)
    ctx.store.data.sessions[0]!.state = 'running'
    expect(() => handlers['agent:propose']({ sessionId: 's', taskId: 'existing', reason: '根拠' })).toThrow('終了')
  })
})

describe('AIの文脈参照', () => {
  it('プロジェクトに結び付くタスク・目標・セッションを返し、一時停止を引いた実作業を示す', () => {
    const { ctx, handlers } = context()
    ctx.store.data.sessions[0]!.segments[0]!.taskId = 'existing'
    const result = handlers['agent:context']({ projectId: 'p' })
    expect(result.tasks.map((item) => item.id)).toEqual(['existing'])
    expect(result.goals.map((item) => item.id)).toEqual(['g'])
    expect(result.sessions[0]).toMatchObject({ id: 's', taskIds: ['existing'], focusMs: 900000 })
    expect(handlers['agent:context']({ projectId: 'missing' })).toEqual({ projects: [], tasks: [], goals: [], sessions: [] })
    expect(ctx.calls).toEqual([])
  })

  it('直近100セッションに絞る', () => {
    const { ctx, handlers } = context()
    ctx.store.data.sessions = Array.from({ length: 103 }, (_, index) => endedSession(`s-${index}`))
    const result = handlers['agent:context']({})
    expect(result.sessions).toHaveLength(100)
    expect(result.sessions[0]!.id).toBe('s-3')
    expect(result.sessions[99]!.id).toBe('s-102')
  })
})

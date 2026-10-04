import { describe, expect, it } from 'vitest'
import { parseArgs } from '@white-box/contracts'
import type { Session } from '@white-box/core/types'
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

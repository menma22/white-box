import { describe, expect, it } from 'vitest'
import type { Session, Task } from '../src/types.js'
import { MINUTE } from '../src/engine.js'
import { deadlineEnd, lastTaskWorkAt, recommendTasks, stallWarningDays, taskControl, taskWarnings } from '../src/task-priority.js'

const DAY = 86_400_000
const now = new Date(2026, 9, 5, 12).getTime()
function task(patch: Partial<Task> = {}): Task {
  return { id: 'task', title: 'task', notes: '', projectId: null, parentId: null, status: 'todo', progress: 0,
    priority: 'normal', order: 0, createdAt: now - 100 * DAY, updatedAt: now, doneAt: null, createdInSessionId: null, ...patch }
}
function session(patch: Partial<Session> = {}): Session {
  const startedAt = now - DAY
  return { id: 'session', startedAt, endedAt: startedAt + 30 * MINUTE, plannedMs: 30 * MINUTE, state: 'ended',
    segments: [{ id: 'segment', taskId: 'task', startedAt, endedAt: startedAt + 30 * MINUTE }], pauses: [], events: [],
    progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: startedAt, ...patch }
}

describe('締切と残作業から導く Slack', () => {
  it('ローカルの締切日末から現在・残作業・明示した安全余裕を引く', () => {
    const control = taskControl(task({ due: '2026-10-05', remainingEffortMinutes: 60, safetyBufferMinutes: 30 }), [], now, 3)
    expect(control.slackMs).toBe((12 * 60 - 90) * MINUTE)
    expect(control.risk).toBe('normal')
  })
  it.each([
    {}, { due: '2026-10-05' }, { due: '2026-10-05', remainingEffortMinutes: 60 },
    { due: '2026-10-05', safetyBufferMinutes: 0 },
    { due: '2026-10-05', remainingEffortMinutes: null, safetyBufferMinutes: 0 },
    { due: '2026-10-05', remainingEffortMinutes: 0, safetyBufferMinutes: null },
  ])('欠けた入力から Slack を作らない: %j', (patch) => {
    expect(taskControl(task(patch), [], now, 3).slackMs).toBeNull()
  })
  it('明示した 0 は既知の値で、実作業時間は自動減算しない', () => {
    const value = task({ due: '2026-10-05', remainingEffortMinutes: 60, safetyBufferMinutes: 0 })
    expect(taskControl(value, [session()], now, 3).slackMs).toBe(11 * 60 * MINUTE)
    expect(value.remainingEffortMinutes).toBe(60)
  })
  it.each(['2026-12-31', '2027-01-03', '2028-02-29'])('年・週・月の境界で翌日 0:00 を使う: %s', (due) => {
    const expected = new Date(`${due}T00:00:00`)
    expected.setDate(expected.getDate() + 1)
    expect(deadlineEnd(due)).toBe(expected.getTime())
    expect(taskControl(task({ due }), [], expected.getTime() - 1, 3).risk).toBe('normal')
    expect(taskControl(task({ due }), [], expected.getTime(), 3).risk).toBe('overdue')
  })
  it.each(['2026-02-29', '2026-13-01', 'garbage', null, undefined])('無効・不明な締切は不明: %s', (due) => {
    expect(deadlineEnd(due)).toBeNull()
  })
  it('入力の不足とは独立に締切超過を判定し、負の Slack と区別する', () => {
    expect(taskControl(task({ due: '2026-10-04' }), [], now, 3).risk).toBe('overdue')
    const risk = taskControl(task({ due: '2026-10-05', remainingEffortMinutes: 721, safetyBufferMinutes: 0 }), [], now, 3)
    expect(risk.risk).toBe('high-risk')
    expect(risk.reasons).toEqual(['negative-slack'])
  })
})

describe('確かな起点だけを使う Todo Aging', () => {
  it('旧タスクの作成・一般更新時刻を起点にしない', () => {
    expect(taskControl(task(), [], now, 3).agingDays).toBeNull()
    expect(taskWarnings([task({ priority: 'high' })], [], now, 3)).toEqual([])
  })
  it('現在のコミットより前の進捗と作業を全て除く', () => {
    const value = task({ committedAt: now, lastProgressAt: now - 50 * DAY })
    const control = taskControl(value, [session({ startedAt: now - 10 * DAY })], now, 3)
    expect(control.agingDays).toBe(0)
    expect(control.risk).toBe('normal')
  })
  it('進捗変更と実作業のうち新しい根拠を使う', () => {
    const value = task({ committedAt: now - 20 * DAY, lastProgressAt: now - 2 * DAY })
    expect(taskControl(value, [], now, 3).agingDays).toBe(2)
    expect(taskControl(value, [session()], now, 3).agingSince).toBe(now - DAY + 30 * MINUTE)
  })
  it('旧データでも実作業記録があれば、その時刻だけを根拠にする', () => {
    expect(taskControl(task(), [session()], now, 3).agingSince).toBe(now - DAY + 30 * MINUTE)
  })
  it('実行中の作業で Aging が伸びず、一時停止を進捗にしない', () => {
    const startedAt = now - 10 * MINUTE
    const running = session({ startedAt, endedAt: null, state: 'running', mode: 'stopwatch', segments: [{ id: 'segment', taskId: 'task', startedAt, endedAt: null }] })
    expect(taskControl(task({ committedAt: now - 20 * DAY }), [running], now, 3).agingDays).toBe(0)
    const paused = { ...running, state: 'paused' as const, pauses: [{ startedAt: now - 5 * MINUTE, endedAt: null, reason: 'manual' as const }] }
    expect(lastTaskWorkAt(task(), [paused], now)).toBe(now - 5 * MINUTE)
    expect(lastTaskWorkAt(task(), [{ ...paused, pauses: [{ startedAt, endedAt: null, reason: 'manual' }] }], now)).toBeNull()
  })
  it('満了処理前のタイマーと申告除外は作業を増やさない', () => {
    const startedAt = now - 10 * DAY
    const running = session({ startedAt, endedAt: null, state: 'running', plannedMs: MINUTE, segments: [{ id: 'segment', taskId: 'task', startedAt, endedAt: null }] })
    expect(lastTaskWorkAt(task(), [running], now)).toBe(startedAt + MINUTE)
    const excluded = session({ pauses: [{ startedAt: now - DAY + 10 * MINUTE, endedAt: now - DAY + 30 * MINUTE, reason: 'excluded' }] })
    expect(lastTaskWorkAt(task(), [excluded], now)).toBe(now - DAY + 10 * MINUTE)
  })
  it.each(['inbox', 'done'] as const)('%s は Aging・リスク対象外', (status) => {
    const control = taskControl(task({ status, committedAt: now - 20 * DAY, due: '2026-10-04', remainingEffortMinutes: 900, safetyBufferMinutes: 0 }), [], now, 3)
    expect(control.agingDays).toBeNull()
    expect(control.risk).toBe('normal')
  })
  it('Doing には Todo 待機の Aging 警告を当てない', () => {
    expect(taskControl(task({ status: 'doing', committedAt: now - 30 * DAY }), [], now, 3).risk).toBe('normal')
  })
  it('ユーザー閾値とその 2 倍で段階を上げ、不正な旧設定は 3 日', () => {
    const value = task({ committedAt: now - 4 * DAY })
    expect(taskControl(value, [], now, 5).risk).toBe('normal')
    expect(taskControl(value, [], now, 3).risk).toBe('warning')
    expect(taskControl(value, [], now, 2).risk).toBe('high-risk')
    for (const days of [0, -1, NaN, Infinity]) expect(stallWarningDays(days)).toBe(3)
  })
  it('Todo が待つほど連続的に推薦へ浮上し、元配列と保存順は変わらない', () => {
    const tasks = [task({ id: 'low', priority: 'low', committedAt: now, order: 1 }), task({ id: 'high', priority: 'high', committedAt: now, order: 0 })]
    expect(recommendTasks(tasks, [], now, 3).map((value) => value.id)).toEqual(['high', 'low'])
    const aging = [{ ...tasks[0]!, committedAt: now - 8 * DAY }, tasks[1]!]
    expect(recommendTasks(aging, [], now, 3).map((value) => value.id)).toEqual(['low', 'high'])
    expect(taskControl(tasks[0]!, [], now + DAY, 3).recommendationScore).toBeCloseTo(1 / 3)
    expect(tasks.map((value) => value.id)).toEqual(['low', 'high'])
    expect(tasks.map((value) => value.order)).toEqual([1, 0])
  })
})

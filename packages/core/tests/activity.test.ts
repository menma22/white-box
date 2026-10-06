import { describe, expect, it } from 'vitest'
import { activityDayKeys, activitySlices, activitySummary, activityTimeline, dayRange, shiftDay, weekKey, weekRange } from '../src/activity.js'
import { focusMs, MINUTE, sessionsOfDay } from '../src/engine.js'
import type { Session, Task } from '../src/types.js'

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const task = (id: string, projectId: string | null): Task => ({ id, projectId, parentId: null, title: id, notes: '', status: 'doing', progress: 70, priority: 'normal', order: 0, createdAt: at(1, 0), updatedAt: at(1, 0), doneAt: null, createdInSessionId: null })
function session(overrides: Partial<Session> = {}): Session {
  return { id: 's', startedAt: at(5, 3, 30), endedAt: at(5, 4, 30), plannedMs: 50 * MINUTE, mode: 'stopwatch', state: 'ended',
    segments: [{ id: 'a', taskId: 'a', startedAt: at(5, 3, 30), endedAt: at(5, 4) }, { id: 'b', taskId: 'b', startedAt: at(5, 4), endedAt: at(5, 4, 30) }],
    pauses: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: at(5, 3, 30), ...overrides }
}

describe('日・週の実績', () => {
  it('日境界をまたぐ記録を両日から参照できる', () => {
    const s = session()
    expect(sessionsOfDay([s], '2026-10-05', 4)).toEqual([s])
  })

  it('月曜日の境界で日・週・タスク・プロジェクトの合計が一致する', () => {
    const s = session()
    const tasks = [task('a', 'p1'), task('b', 'p2')]
    const previous = activitySummary([s], tasks, at(5, 5), dayRange('2026-10-04', 4))
    const today = activitySummary([s], tasks, at(5, 5), dayRange('2026-10-05', 4))
    expect(previous.focusMs).toBe(30 * MINUTE)
    expect(today.focusMs).toBe(30 * MINUTE)
    expect(previous.focusMs + today.focusMs).toBe(focusMs(s, at(5, 5)))
    expect([...today.taskMs]).toEqual([['b', 30 * MINUTE]])
    expect([...today.projectMs]).toEqual([['p2', 30 * MINUTE]])
    expect([...today.sessionMs]).toEqual([['s', 30 * MINUTE]])
    expect(activitySummary([s], tasks, at(5, 5), weekRange('2026-10-04', 4)).focusMs).toBe(previous.focusMs)
    expect(activitySummary([s], tasks, at(5, 5), weekRange('2026-10-05', 4)).focusMs).toBe(today.focusMs)
    expect(activityDayKeys([s], at(5, 5), 4)).toEqual(['2026-10-05', '2026-10-04'])
  })

  it('日境界の設定を変えると同じ記録を再配分し、全体時間は変えない', () => {
    const startedAt = at(5, 4, 30)
    const endedAt = at(5, 5, 30)
    const s = session({ startedAt, endedAt, segments: [{ id: 'a', taskId: 'a', startedAt, endedAt }] })
    expect(activityDayKeys([s], endedAt, 4)).toEqual(['2026-10-05'])
    expect(activityDayKeys([s], endedAt, 5)).toEqual(['2026-10-05', '2026-10-04'])
    expect(activitySummary([s], [], endedAt, dayRange('2026-10-05', 4)).focusMs).toBe(60 * MINUTE)
    expect(activitySummary([s], [], endedAt, dayRange('2026-10-05', 5)).focusMs).toBe(30 * MINUTE)
    expect(activitySummary([s], [], endedAt, dayRange('2026-10-04', 5)).focusMs).toBe(30 * MINUTE)
    expect(focusMs(s, endedAt)).toBe(60 * MINUTE)
  })

  it('停止・除外の重なりを二重に減算せず、内訳も重ねない', () => {
    const s = session({ pauses: [{ startedAt: at(5, 3, 40), endedAt: at(5, 4, 10), reason: 'manual' }, { startedAt: at(5, 3, 50), endedAt: at(5, 4, 20), reason: 'excluded' }] })
    const summary = activitySummary([s], [], at(5, 5), { startedAt: at(5, 3), endedAt: at(5, 5) })
    expect(summary.focusMs).toBe(20 * MINUTE)
    expect(summary.excludedMs).toBe(30 * MINUTE)
    expect(summary.pausedMs).toBe(10 * MINUTE)
    expect([...summary.taskMs.values()].reduce((a, b) => a + b, 0)).toBe(summary.focusMs)
  })

  it('編集した始終と重複セッションを安定した帰属で一度だけ計上する', () => {
    const first = session({ startedAt: at(5, 3, 20), endedAt: at(5, 4, 40), editedAt: at(5, 5) })
    const second = session({ id: 'other', startedAt: at(5, 4, 20), endedAt: at(5, 5), segments: [{ id: 'c', taskId: 'c', startedAt: at(5, 4, 20), endedAt: at(5, 5) }] })
    const period = { startedAt: at(5, 3), endedAt: at(5, 6) }
    const summary = activitySummary([second, first], [task('a', 'p'), task('b', 'p')], at(5, 6), period)
    expect(summary.focusMs).toBe(100 * MINUTE)
    expect([...summary.taskMs]).toEqual([['a', 40 * MINUTE], ['b', 40 * MINUTE], ['c', 20 * MINUTE]])
    expect([...summary.projectMs.values()].reduce((a, b) => a + b, 0)).toBe(summary.focusMs)
    expect(activitySlices([first, second], at(5, 6), period)).toEqual(activitySlices([second, first], at(5, 6), period))
  })

  it('未終了タイマーは満了で止まり、停止中の記録は増えない', () => {
    const running = session({ endedAt: null, state: 'running', mode: 'timer', segments: [{ id: 'a', taskId: 'a', startedAt: at(5, 3, 30), endedAt: null }] })
    const range = { startedAt: at(5, 3), endedAt: at(5, 6) }
    expect(activitySummary([running], [], at(5, 5), range).focusMs).toBe(50 * MINUTE)
    const paused = { ...running, state: 'paused' as const, pauses: [{ startedAt: at(5, 3, 50), endedAt: null, reason: 'manual' as const }] }
    expect(activitySummary([paused], [], at(5, 5), range).focusMs).toBe(20 * MINUTE)
    expect(activitySummary([paused], [], at(5, 6), range).focusMs).toBe(20 * MINUTE)
    expect(activitySummary([JSON.parse(JSON.stringify(paused)) as Session], [], at(5, 6), range).focusMs).toBe(20 * MINUTE)
  })

  it('重複記録の停止と作業が重なる時刻は、作業を一度だけ表示・計上する', () => {
    const first = session({ startedAt: at(5, 9), endedAt: at(5, 10), segments: [{ id: 'a', taskId: 'a', startedAt: at(5, 9), endedAt: at(5, 10) }],
      pauses: [{ startedAt: at(5, 9, 20), endedAt: at(5, 9, 40), reason: 'manual' }, { startedAt: at(5, 9, 30), endedAt: at(5, 9, 50), reason: 'excluded' }] })
    const second = session({ id: 'other', startedAt: at(5, 9, 10), endedAt: at(5, 9, 40), segments: [{ id: 'b', taskId: 'b', startedAt: at(5, 9, 10), endedAt: at(5, 9, 40) }] })
    const sessions = [first, second, { ...first, id: 'duplicate' }]
    const period = dayRange('2026-10-05', 4)
    const summary = activitySummary(sessions, [], at(5, 11), period)
    expect(summary.focusMs).toBe(50 * MINUTE)
    expect(summary.pausedMs).toBe(0)
    expect(summary.excludedMs).toBe(10 * MINUTE)
    const timeline = activityTimeline(sessions, at(5, 11), period)
    expect(timeline.reduce((sum, item) => sum + item.endedAt - item.startedAt, 0)).toBe(60 * MINUTE)
    expect(timeline.filter((item) => item.kind === 'work').reduce((sum, item) => sum + item.endedAt - item.startedAt, 0)).toBe(summary.focusMs)
    expect(timeline.every((item, index) => index === 0 || timeline[index - 1]!.endedAt <= item.startedAt)).toBe(true)
  })

  it('境界ちょうどに終わる記録は次の日へ入れず、削除済みタスクの時間は残る', () => {
    const s = session({ endedAt: at(5, 4), segments: [{ id: 'a', taskId: 'gone', startedAt: at(5, 3, 30), endedAt: at(5, 4) }] })
    expect(activityDayKeys([s], at(5, 5), 4)).toEqual(['2026-10-04'])
    const summary = activitySummary([s], [], at(5, 5), dayRange('2026-10-04', 4))
    expect(summary.taskMs.get('gone')).toBe(30 * MINUTE)
    expect(summary.projectMs.get(null)).toBe(summary.focusMs)
  })

  it('日付にならない時刻を日付列挙へ入れず、正常な履歴は残す', () => {
    const valid = session()
    const invalid = [
      session({ startedAt: 1e20, endedAt: 1e20 + 1_000_000 }),
      session({ endedAt: Infinity }),
      session({ startedAt: NaN }),
      session({ startedAt: -Infinity, endedAt: at(5, 5) }),
    ]
    expect(activityDayKeys([valid, ...invalid], at(5, 5), 4)).toEqual(['2026-10-05', '2026-10-04'])
  })

  it('長い記録も表示期間だけを列挙し、全体合計と元の記録は保つ', () => {
    const startedAt = new Date(1800, 0, 1, 4).getTime()
    const endedAt = new Date(2400, 0, 1, 4).getTime()
    const s = session({ startedAt, endedAt, segments: [{ id: 'a', taskId: 'a', startedAt, endedAt }] })
    const period = { startedAt: dayRange('2026-10-01', 4).startedAt, endedAt: dayRange('2026-11-01', 4).startedAt }
    const keys = activityDayKeys([s], endedAt, 4, period)
    expect(keys).toHaveLength(31)
    expect(keys[0]).toBe('2026-10-31')
    expect(keys[30]).toBe('2026-10-01')
    expect(activitySummary([s], [], endedAt, period).focusMs).toBe(period.endedAt - period.startedAt)
    expect(activitySummary([s], [], endedAt, { startedAt, endedAt }).focusMs).toBe(endedAt - startedAt)
    expect(s.startedAt).toBe(startedAt)
    expect(s.endedAt).toBe(endedAt)
    expect(activityDayKeys([session({ startedAt: period.endedAt, endedAt: period.endedAt })], endedAt, 4, period)).toEqual([])
    expect(activityDayKeys([session({ startedAt: period.startedAt, endedAt: period.startedAt })], endedAt, 4, period)).toEqual(['2026-10-01'])
  })

  it('完了指標は人間が完了にした時刻で数え、進捗や目標を推測しない', () => {
    const done = { ...task('done', 'p'), status: 'done' as const, progress: 70, doneAt: at(5, 9) }
    expect(activitySummary([], [done, task('work', 'p')], at(5, 10), dayRange('2026-10-05', 4)).completedTasks).toEqual([done])
    expect(done.progress).toBe(70)
  })

  it('月・年をまたいでもカレンダー日と月曜日を決める', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekKey('2026-10-04')).toBe('2026-09-28')
    expect(weekKey('2026-10-05')).toBe('2026-10-05')
  })

  it.each([
    { month: 2, day: 8, key: '2026-03-08' },
    { month: 10, day: 1, key: '2026-11-01' },
  ])('夏時間切替日の $key も履歴と日・週の合計を保つ', ({ month, day, key }) => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const startedAt = new Date(2026, month, day, 3, 30).getTime()
      const endedAt = new Date(2026, month, day, 4, 30).getTime()
      const s = session({ startedAt, endedAt, segments: [{ id: 'a', taskId: 'a', startedAt, endedAt }] })
      const keys = activityDayKeys([s], endedAt, 4)
      expect(keys).toEqual([key, shiftDay(key, -1)])
      const daily = keys.map((day) => activitySummary([s], [], endedAt, dayRange(day, 4)).focusMs)
      expect(daily).toEqual([30 * MINUTE, 30 * MINUTE])
      expect(daily.reduce((sum, ms) => sum + ms, 0)).toBe(focusMs(s, endedAt))
      expect(activitySummary([s], [], endedAt, weekRange(key, 4)).focusMs).toBe(focusMs(s, endedAt))
      const afterBoundary = session({ startedAt: startedAt + 40 * MINUTE, endedAt, segments: [{ id: 'a', taskId: 'a', startedAt: startedAt + 40 * MINUTE, endedAt }] })
      expect(activityDayKeys([afterBoundary], endedAt, 4)).toEqual([key])
      expect(activitySummary([afterBoundary], [], endedAt, dayRange(key, 4)).focusMs).toBe(20 * MINUTE)
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })
})

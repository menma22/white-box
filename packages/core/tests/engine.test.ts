import { describe, expect, it } from 'vitest'
import type { Session } from '../src/types.js'
import {
  dayKey,
  declaredExclusions,
  excludedMs,
  focusByTask,
  focusMs,
  livePausedMs,
  MINUTE,
  overrunRanges,
  pausedMsWithin,
  plannedReachedAt,
  totalRangeMs,
  unpausedRanges,
} from '../src/engine.js'

describe('一日の境目', () => {
  it('境目より前の時刻は前日に入る', () => {
    const lateNight = new Date(2026, 7, 21, 2, 30).getTime()
    expect(dayKey(lateNight, 4)).toBe('2026-08-20')
    expect(dayKey(lateNight, 0)).toBe('2026-08-21')
  })

  it('境目ちょうどはその日に入る', () => {
    expect(dayKey(new Date(2026, 7, 21, 4, 0).getTime(), 4)).toBe('2026-08-21')
  })

  it.each([
    { month: 2, day: 8, previous: '2026-03-07', current: '2026-03-08', offset: 240 },
    { month: 10, day: 1, previous: '2026-10-31', current: '2026-11-01', offset: 300 },
  ])('夏時間切替日の $current も現地の4時を境目にする', ({ month, day, previous, current, offset }) => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      expect(new Date(2026, month, day, 12).getTimezoneOffset()).toBe(offset)
      expect(dayKey(new Date(2026, month, day, 3, 59).getTime(), 4)).toBe(previous)
      expect(dayKey(new Date(2026, month, day, 4).getTime(), 4)).toBe(current)
      expect(dayKey(new Date(2026, month, day, 4, 30).getTime(), 4)).toBe(current)
      expect(dayKey(new Date(2026, month, day, 12).getTime(), 4)).toBe(current)
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })
})

it('重なった停止区間は一度だけ差し引く', () => {
  const pauses = [
    { startedAt: 10, endedAt: 30, reason: 'manual' as const },
    { startedAt: 20, endedAt: 40, reason: 'excluded' as const },
  ]
  expect(pausedMsWithin(pauses, 0, 50, 50)).toBe(30)
  expect(pausedMsWithin(pauses, 25, 35, 50)).toBe(10)
})

const T0 = new Date(2026, 7, 20, 10, 0, 0).getTime()
const min = (n: number) => n * MINUTE

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'ses_x',
    startedAt: T0,
    endedAt: T0 + min(60),
    plannedMs: min(50),
    state: 'ended',
    segments: [{ id: 'seg_x', taskId: 'tsk_x', startedAt: T0, endedAt: T0 + min(60) }],
    pauses: [],
    events: [],
    progressChanges: [],
    note: '',
    expiredNotifiedAt: null,
    editedAt: null,
    createdAt: T0,
    ...over,
  }
}

it('開始・終了を手で直しても、タスク別実作業はセッション全体と一致する', () => {
  const segments = [
    { id: 'seg_a', taskId: 'task_a', startedAt: T0, endedAt: T0 + min(20) },
    { id: 'seg_b', taskId: 'task_b', startedAt: T0 + min(20), endedAt: T0 + min(60) },
  ]
  const shortened = session({ startedAt: T0 + min(30), segments })
  expect(focusMs(shortened, T0 + min(60))).toBe(min(30))
  expect([...focusByTask(shortened, T0 + min(60)).values()]).toEqual([0, min(30)])

  const extended = session({ startedAt: T0 - min(10), endedAt: T0 + min(70), segments })
  expect(focusMs(extended, T0 + min(70))).toBe(min(80))
  expect([...focusByTask(extended, T0 + min(70)).values()]).toEqual([min(30), min(50)])
})

describe('除外できる範囲', () => {
  it('一時停止に重なっていない範囲だけを返す', () => {
    const pauses = [{ startedAt: T0 + min(20), endedAt: T0 + min(30), reason: 'manual' as const }]
    expect(unpausedRanges(pauses, T0, T0 + min(60), T0 + min(60))).toEqual([
      { startedAt: T0, endedAt: T0 + min(20) },
      { startedAt: T0 + min(30), endedAt: T0 + min(60) },
    ])
  })

  it('範囲が停止で埋まっていれば何も残らない', () => {
    const pauses = [{ startedAt: T0, endedAt: T0 + min(60), reason: 'manual' as const }]
    expect(unpausedRanges(pauses, T0 + min(10), T0 + min(20), T0 + min(60))).toEqual([])
  })

  it('閉じていない停止は now で閉じて数える', () => {
    const pauses = [{ startedAt: T0 + min(40), endedAt: null, reason: 'manual' as const }]
    expect(unpausedRanges(pauses, T0, T0 + min(60), T0 + min(50))).toEqual([
      { startedAt: T0, endedAt: T0 + min(40) },
      { startedAt: T0 + min(50), endedAt: T0 + min(60) },
    ])
  })
})

describe('予定に達した瞬間と、そのあとの放置分', () => {
  it('停止がなければ開始から予定ぶん進んだ時刻', () => {
    expect(plannedReachedAt(session(), T0 + min(60))).toBe(T0 + min(50))
  })

  it('停止したぶんだけ後ろにずれる', () => {
    const s = session({
      pauses: [{ startedAt: T0 + min(10), endedAt: T0 + min(25), reason: 'manual' }],
      endedAt: T0 + min(80),
    })
    expect(plannedReachedAt(s, T0 + min(80))).toBe(T0 + min(65))
  })

  it('実作業が予定に届いていなければ null', () => {
    expect(plannedReachedAt(session({ endedAt: T0 + min(30) }), T0 + min(30))).toBeNull()
  })

  it('放置分は「予定に達してから終了まで」のうち、まだ止まっていない範囲', () => {
    const s = session({ endedAt: T0 + min(180) })
    expect(overrunRanges(s, T0 + min(180))).toEqual([{ startedAt: T0 + min(50), endedAt: T0 + min(180) }])
    expect(totalRangeMs(overrunRanges(s, T0 + min(180)))).toBe(min(130))
  })

  it('もう除外してある区間は放置分に数えない', () => {
    const s = session({
      endedAt: T0 + min(180),
      pauses: [{ startedAt: T0 + min(50), endedAt: T0 + min(180), reason: 'excluded' }],
    })
    expect(overrunRanges(s, T0 + min(180))).toEqual([])
  })
})

describe('申告した除外', () => {
  it('除外した分だけ実作業が減り、除外として数えられる', () => {
    const s = session({
      endedAt: T0 + min(180),
      pauses: [
        { startedAt: T0 + min(10), endedAt: T0 + min(20), reason: 'manual' },
        { startedAt: T0 + min(60), endedAt: T0 + min(180), reason: 'excluded' },
      ],
    })
    expect(focusMs(s, T0 + min(180))).toBe(min(50))
    expect(excludedMs(s, T0 + min(180))).toBe(min(120))
    expect(livePausedMs(s, T0 + min(180))).toBe(min(10))
    expect(declaredExclusions(s)).toEqual([{ startedAt: T0 + min(60), endedAt: T0 + min(180) }])
  })
})

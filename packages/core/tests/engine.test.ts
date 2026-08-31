import { describe, expect, it } from 'vitest'
import type { Session } from '../src/types.js'
import {
  dayKey,
  declaredExclusions,
  excludedMs,
  focusMs,
  MINUTE,
  overrunRanges,
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
    expect(declaredExclusions(s)).toEqual([{ startedAt: T0 + min(60), endedAt: T0 + min(180) }])
  })
})

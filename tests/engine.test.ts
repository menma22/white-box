import { describe, expect, it } from 'vitest'
import type { Session } from '@white-box/core/types'
import { activeTaskId, dayKey, focusByTask, focusMs, isPaused, MINUTE, pausedMs, remainingMs, segmentFocusMs } from '@white-box/core/engine'
import { closeAtLastKnown, createSession, endSession, extendSession, pauseSession, resumeSession, switchTask } from '../apps/desktop/src/domain/session-ops.js'

const T0 = new Date(2026, 7, 20, 10, 0, 0).getTime()
const min = (n: number) => n * MINUTE

function base(): Session {
  return createSession({ taskId: 'a', taskTitle: 'A', plannedMs: min(50), now: T0 })
}

describe('実作業時間', () => {
  it('一時停止のぶんを引く', () => {
    let s = base()
    s = pauseSession(s, T0 + min(20))
    s = resumeSession(s, T0 + min(27))
    s = endSession(s, T0 + min(57))
    expect(focusMs(s, T0 + min(99))).toBe(min(50))
    expect(pausedMs(s, T0 + min(99))).toBe(min(7))
  })

  it('停止したままなら now までを停止として数える', () => {
    let s = base()
    s = pauseSession(s, T0 + min(20))
    expect(isPaused(s)).toBe(true)
    expect(focusMs(s, T0 + min(35))).toBe(min(20))
    expect(pausedMs(s, T0 + min(35))).toBe(min(15))
  })

  it('残りは満了後にマイナスへ進む', () => {
    const s = base()
    expect(remainingMs(s, T0 + min(50))).toBe(0)
    expect(remainingMs(s, T0 + min(58))).toBe(min(-8))
  })

  it('区間に重なる停止だけを、その区間から引く', () => {
    let s = base()
    s = switchTask(s, 'b', 'B', T0 + min(30))
    s = pauseSession(s, T0 + min(40))
    s = resumeSession(s, T0 + min(45))
    s = endSession(s, T0 + min(60))
    const [first, second] = s.segments
    expect(segmentFocusMs(s, first!, T0 + min(60))).toBe(min(30))
    expect(segmentFocusMs(s, second!, T0 + min(60))).toBe(min(25))
    const perTask = focusByTask(s, T0 + min(60))
    expect(perTask.get('a')).toBe(min(30))
    expect(perTask.get('b')).toBe(min(25))
    expect(focusMs(s, T0 + min(60))).toBe(min(55))
  })
})

describe('状態遷移', () => {
  it('タスク切替は前の区間を閉じ、新しい区間を開く', () => {
    const s = switchTask(base(), 'b', 'B', T0 + min(26))
    expect(s.segments).toHaveLength(2)
    expect(s.segments[0]!.endedAt).toBe(T0 + min(26))
    expect(activeTaskId(s)).toBe('b')
  })

  it('同じタスクへの切替は区間を増やさない', () => {
    const s = switchTask(base(), 'a', 'A', T0 + min(26))
    expect(s.segments).toHaveLength(1)
  })

  it('終了は開いている停止と区間を閉じる', () => {
    let s = pauseSession(base(), T0 + min(10))
    s = endSession(s, T0 + min(30))
    expect(s.endedAt).toBe(T0 + min(30))
    expect(s.state).toBe('ended')
    expect(s.pauses.every((p) => p.endedAt !== null)).toBe(true)
    expect(s.segments.every((seg) => seg.endedAt !== null)).toBe(true)
    expect(focusMs(s, T0 + min(90))).toBe(min(10))
  })

  it('終了したセッションは以後の操作で動かない', () => {
    const ended = endSession(base(), T0 + min(30))
    expect(pauseSession(ended, T0 + min(40))).toBe(ended)
    expect(switchTask(ended, 'b', 'B', T0 + min(40))).toBe(ended)
    expect(extendSession(ended, 15, T0 + min(40))).toBe(ended)
  })

  it('延長は予定を伸ばし、満了の印を消す', () => {
    let s = base()
    s.expiredNotifiedAt = T0 + min(50)
    s = extendSession(s, 15, T0 + min(50))
    expect(s.plannedMs).toBe(min(65))
    expect(s.expiredNotifiedAt).toBeNull()
  })

  it('落ちたセッションは最後に記録が取れた時刻で閉じる', () => {
    const s = closeAtLastKnown(base(), T0 + min(18))
    expect(s.endedAt).toBe(T0 + min(18))
    expect(focusMs(s, T0 + min(600))).toBe(min(18))
  })
})

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

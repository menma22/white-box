import { describe, expect, it } from 'vitest'
import type { Session } from '@white-box/core/types'
import {
  activeTaskId,
  declaredExclusions,
  excludedMs,
  focusByTask,
  focusMs,
  isPaused,
  MINUTE,
  pausedMs,
  remainingMs,
  segmentFocusMs,
} from '@white-box/core/engine'
import {
  closeAtLastKnown,
  createSession,
  editSession,
  endSession,
  extendSession,
  pauseSession,
  resumeSession,
  switchTask,
} from '../src/domain/session-ops.js'

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

/** 満了に気づかず 3 時間放置してから終了したセッション（予定 50 分・実際は 230 分）。 */
function neglected(): Session {
  return endSession(base(), T0 + min(230))
}

describe('記録の事後修正（除外の申告）', () => {
  const EDITED_AT = T0 + min(240)

  it('除外した分だけ実作業が減る', () => {
    const s = neglected()
    expect(focusMs(s, EDITED_AT)).toBe(min(230))
    const fixed = editSession(s, { exclusions: [{ startedAt: T0 + min(50), endedAt: T0 + min(230) }] }, EDITED_AT)
    expect(focusMs(fixed, EDITED_AT)).toBe(min(50))
    expect(excludedMs(fixed, EDITED_AT)).toBe(min(180))
  })

  it('開始・終了・区間は動かさない（起きた事実は消さない）', () => {
    const s = neglected()
    const fixed = editSession(s, { exclusions: [{ startedAt: T0 + min(50), endedAt: T0 + min(230) }] }, EDITED_AT)
    expect(fixed.startedAt).toBe(s.startedAt)
    expect(fixed.endedAt).toBe(s.endedAt)
    expect(fixed.segments).toEqual(s.segments)
  })

  it('修正した印（editedAt）と、何を外したかがイベントに残る', () => {
    const fixed = editSession(
      neglected(),
      { exclusions: [{ startedAt: T0 + min(50), endedAt: T0 + min(230) }] },
      EDITED_AT,
    )
    expect(fixed.editedAt).toBe(EDITED_AT)
    const logged = fixed.events.filter((e) => e.type === 'session_edited')
    expect(logged).toHaveLength(1)
    expect(logged[0]!.label).toContain('除外')
    expect(logged[0]!.label).toContain('3h') // 10:50–13:50 の 3 時間
  })

  it('取り消すと元の実作業に戻る', () => {
    const fixed = editSession(
      neglected(),
      { exclusions: [{ startedAt: T0 + min(50), endedAt: T0 + min(230) }] },
      EDITED_AT,
    )
    const undone = editSession(fixed, { exclusions: [] }, EDITED_AT + min(1))
    expect(focusMs(undone, EDITED_AT + min(1))).toBe(min(230))
    expect(declaredExclusions(undone)).toEqual([])
    expect(undone.events.at(-1)!.label).toContain('取り消し')
  })

  it('観測された一時停止は申告で置き換わらない', () => {
    let s = pauseSession(base(), T0 + min(20))
    s = resumeSession(s, T0 + min(30))
    s = endSession(s, T0 + min(230))
    const fixed = editSession(s, { exclusions: [{ startedAt: T0 + min(60), endedAt: T0 + min(230) }] }, EDITED_AT)
    expect(fixed.pauses.filter((p) => p.reason === 'manual')).toHaveLength(1)
    expect(pausedMs(fixed, EDITED_AT) - excludedMs(fixed, EDITED_AT)).toBe(min(10))
  })

  it('時刻の修正と除外を同時に受けても、範囲は修正後の値で見る', () => {
    const s = neglected()
    const fixed = editSession(
      s,
      { endedAt: T0 + min(200), exclusions: [{ startedAt: T0 + min(150), endedAt: T0 + min(200) }] },
      EDITED_AT,
    )
    expect(fixed.endedAt).toBe(T0 + min(200))
    expect(focusMs(fixed, EDITED_AT)).toBe(min(150))
    // 修正前の終了時刻（230分）までを外そうとすると、修正後の範囲の外なので通らない
    expect(() =>
      editSession(s, { endedAt: T0 + min(200), exclusions: [{ startedAt: T0 + min(150), endedAt: T0 + min(230) }] }, EDITED_AT),
    ).toThrow()
  })

  it('噛み合わない申告は通さない', () => {
    const s = neglected()
    const bad = (exclusions: { startedAt: number; endedAt: number }[]) => () => editSession(s, { exclusions }, EDITED_AT)
    expect(bad([{ startedAt: T0 + min(60), endedAt: T0 + min(60) }])).toThrow() // 長さ 0
    expect(bad([{ startedAt: T0 + min(70), endedAt: T0 + min(60) }])).toThrow() // 逆さま
    expect(bad([{ startedAt: T0 - min(5), endedAt: T0 + min(10) }])).toThrow() // 開始より前
    expect(bad([{ startedAt: T0 + min(200), endedAt: T0 + min(400) }])).toThrow() // 終了より後
    expect(
      bad([
        { startedAt: T0 + min(60), endedAt: T0 + min(120) },
        { startedAt: T0 + min(100), endedAt: T0 + min(140) },
      ]),
    ).toThrow() // 除外どうしが重なる
    // 既にある一時停止と重なる
    let paused = pauseSession(base(), T0 + min(20))
    paused = resumeSession(paused, T0 + min(30))
    paused = endSession(paused, T0 + min(230))
    expect(() => editSession(paused, { exclusions: [{ startedAt: T0 + min(25), endedAt: T0 + min(60) }] }, EDITED_AT)).toThrow()
    // 終わっていないセッションは対象外
    expect(() => editSession(base(), { exclusions: [{ startedAt: T0, endedAt: T0 + min(5) }] }, EDITED_AT)).toThrow()
  })

  it('実行中のセッションでも、除外を渡さない修正はできる', () => {
    const s = editSession(base(), { note: 'まだ途中' }, EDITED_AT)
    expect(s.note).toBe('まだ途中')
    expect(s.endedAt).toBeNull()
  })

  it('除外を渡さない修正は、申告済みの除外に触らない', () => {
    const fixed = editSession(
      neglected(),
      { exclusions: [{ startedAt: T0 + min(50), endedAt: T0 + min(230) }] },
      EDITED_AT,
    )
    const renamed = editSession(fixed, { note: 'あとで書いた' }, EDITED_AT + min(1))
    expect(renamed.note).toBe('あとで書いた')
    expect(declaredExclusions(renamed)).toEqual([{ startedAt: T0 + min(50), endedAt: T0 + min(230) }])
  })
})

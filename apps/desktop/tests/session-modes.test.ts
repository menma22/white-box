import { describe, expect, it } from 'vitest'
import { focusByTask, focusMs, MINUTE } from '@white-box/core/engine'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { restoreOpenSession } from '../src/app/lifecycle.js'
import { liveSession } from '../src/app/state.js'
import { createSession, endSession, extendSession, markExpired, pauseSession, resumeSession, startBreak } from '../src/domain/session-ops.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

const minute = (n: number) => n * MINUTE
const T0 = 1_000_000_000

describe('タイマーの満了', () => {
  it('満了後の再開だけでは計測を再開せず、明示延長を待つ', () => {
    const expired = markExpired(createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), now: T0 }), T0 + minute(25))
    expect(resumeSession(expired, T0 + minute(60))).toBe(expired)
    expect(focusMs(expired, T0 + minute(90))).toBe(minute(25))
  })

  it('満了後の休憩も明示延長で終え、手動休憩の延長では停止を保つ', () => {
    const expired = markExpired(createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), now: T0 }), T0 + minute(25))
    const rested = startBreak(expired, 5, T0 + minute(30))
    expect(resumeSession(rested, T0 + minute(60))).toBe(rested)
    const extended = extendSession(rested, 10, T0 + minute(60))
    expect(extended.state).toBe('running')
    expect(focusMs(extended, T0 + minute(65))).toBe(minute(30))
    const manual = startBreak(createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), now: T0 }), 5, T0 + minute(10))
    expect(extendSession(manual, 10, T0 + minute(12)).state).toBe('paused')
  })

  it('停止を考慮した実時刻で止まり、遅延した通知からの時間を数えない', () => {
    let s = createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), now: T0 })
    s = pauseSession(s, T0 + minute(10))
    s = resumeSession(s, T0 + minute(17))
    expect(focusMs(s, T0 + minute(60))).toBe(minute(25))
    expect(focusByTask(s, T0 + minute(60)).get('a')).toBe(minute(25))
    s = markExpired(s, T0 + minute(60))
    expect(s.pauses.at(-1)).toMatchObject({ startedAt: T0 + minute(32), endedAt: null, reason: 'expired' })
    expect(s.state).toBe('paused')
    expect(s.events.find((e) => e.type === 'timer_expired')?.at).toBe(T0 + minute(32))
    expect(focusMs(s, T0 + minute(120))).toBe(minute(25))
  })

  it('明示延長まで放置した時間を除き、延長後から新しい実作業を数える', () => {
    let s = markExpired(createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), now: T0 }), T0 + minute(80))
    s = extendSession(s, 10, T0 + minute(90))
    expect(s.state).toBe('running')
    expect(focusMs(s, T0 + minute(95))).toBe(minute(30))
    s = endSession(s, T0 + minute(110))
    expect(focusMs(s, T0 + minute(110))).toBe(minute(35))
    expect(s.pauses.at(-1)?.startedAt).toBe(T0 + minute(100))
  })

  it('満了通知を受ける前に終了しても満了時刻で計上が止まる', () => {
    const s = endSession(createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), now: T0 }), T0 + minute(300))
    expect(focusMs(s, T0 + minute(300))).toBe(minute(25))
  })

  it('満了未処理の復旧を終了しても、確認前後で実作業時間が増えない', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    const started = await dispatch(h, 'session:start', { taskId: 'a', minutes: 25 })
    ctx.setLastAlive(ctx.now() + minute(40))
    ctx.advance(minute(50))
    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery?.lastKnownAt).toBe(T0 + minute(40))
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(25))
    await dispatch(h, 'recovery:close', {})
    const closed = ctx.store.data.sessions.find((s) => s.id === started?.id)!
    expect(closed.endedAt).toBe(T0 + minute(40))
    expect(focusMs(closed, ctx.now())).toBe(minute(25))
    expect(closed.pauses.find((p) => p.reason === 'expired')).toMatchObject({ startedAt: T0 + minute(25), endedAt: T0 + minute(40) })
  })

})

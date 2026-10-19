import { describe, expect, it } from 'vitest'
import { focusByTask, focusMs, MINUTE, pausedMsWithin } from '@white-box/core/engine'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { checkExpire, restoreOpenSession, setCurrentWorkOpen } from '../src/app/lifecycle.js'
import { buildState, liveSession, newRuntime } from '../src/app/state.js'
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

describe('現在の仕事の管理時間', () => {
  it('開くと除外し、閉じると元の実行中だけを再開する', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    await dispatch(createHandlers(ctx), 'session:start', { taskId: 'a', minutes: 500 })
    ctx.advance(minute(10))
    setCurrentWorkOpen(ctx, true)
    setCurrentWorkOpen(ctx, true)
    ctx.advance(minute(5))
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(10))
    setCurrentWorkOpen(ctx, false)
    ctx.advance(minute(3))
    const session = liveSession(ctx.store.data)!
    expect(session.state).toBe('running')
    expect(session.pauses).toHaveLength(1)
    expect(session.pauses[0]?.reason).toBe('task-management')
    expect(focusMs(session, ctx.now())).toBe(minute(13))
  })

  it('元の手動停止を保持し、重なる管理時間を二度引かない', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', minutes: 500 })
    ctx.advance(minute(10))
    await dispatch(h, 'session:pause', {})
    ctx.advance(minute(2))
    setCurrentWorkOpen(ctx, true)
    ctx.advance(minute(5))
    setCurrentWorkOpen(ctx, false)
    ctx.advance(minute(3))
    const s = liveSession(ctx.store.data)!
    expect(s.state).toBe('paused')
    expect(focusMs(s, ctx.now())).toBe(minute(10))
    expect(pausedMsWithin(s.pauses, s.startedAt, ctx.now(), ctx.now())).toBe(minute(10))
    expect(s.pauses.find((p) => p.reason === 'manual')?.endedAt).toBeNull()
  })

  it('管理中に手動停止した場合は、閉じてもその停止を保つ', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', minutes: 500 })
    setCurrentWorkOpen(ctx, true)
    await dispatch(h, 'session:pause', {})
    setCurrentWorkOpen(ctx, false)
    expect(liveSession(ctx.store.data)?.state).toBe('paused')
  })

  it('管理窓を開いたままの再起動は、停止区間を閉じても空白を実作業にしない', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    await dispatch(createHandlers(ctx), 'session:start', { taskId: 'a', minutes: 500 })
    ctx.advance(minute(10))
    setCurrentWorkOpen(ctx, true)
    ctx.advance(minute(3))
    ctx.setLastAlive(ctx.now())
    ctx.advance(minute(60))
    ctx.runtime = newRuntime()
    restoreOpenSession(ctx, 90_000)
    const s = liveSession(ctx.store.data)!
    expect(s.pauses.find((p) => p.reason === 'task-management')?.endedAt).toBe(T0 + minute(13))
    expect(s.pauses.at(-1)).toMatchObject({ reason: 'suspend', endedAt: null })
    expect(focusMs(s, ctx.now())).toBe(minute(10))
    expect(ctx.runtime.recovery).not.toBeNull()
  })
})

describe('計測方式', () => {
  it('ストップウォッチには満了がなく、超過除外も発生しない', () => {
    const running = createSession({ taskId: 'a', taskTitle: 'A', plannedMs: minute(25), mode: 'stopwatch', now: T0 })
    expect(markExpired(running, T0 + minute(90))).toBe(running)
    expect(focusMs(endSession(running, T0 + minute(90)), T0 + minute(90))).toBe(minute(90))
  })
  it('設定の方式を省略時の既定値として使う', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    ctx.store.data.settings.defaultSessionMode = 'pomodoro'
    ctx.store.data.settings.pomodoroBreakMinutes = 7
    ctx.store.data.settings.pomodoroAutoResume = true
    const s = await dispatch(createHandlers(ctx), 'session:start', { taskId: 'a' })
    expect(s).toMatchObject({ mode: 'pomodoro', pomodoroBreakMs: minute(7), pomodoroAutoResume: true })
  })
})

describe('ポモドーロ', () => {
  it.each(['manual', 'lock', 'suspend'] as const)('自動休憩中の%sは、休憩終了後も明示再開まで保つ', async (reason) => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25, breakMinutes: 5, autoResume: true })
    ctx.advance(minute(25))
    checkExpire(ctx)
    ctx.advance(minute(1))
    await dispatch(h, 'session:pause', { reason })
    ctx.advance(minute(10))
    checkExpire(ctx)
    const stopped = liveSession(ctx.store.data)!
    expect(stopped.state).toBe('paused')
    expect(stopped.pauses.find((p) => p.reason === reason)?.endedAt).toBeNull()
    expect(focusMs(stopped, ctx.now())).toBe(minute(25))
    await dispatch(h, 'session:pause', { reason: reason === 'suspend' ? 'lock' : 'suspend' })
    expect(liveSession(ctx.store.data)?.pauses).toHaveLength(2)
    ctx.advance(minute(5))
    checkExpire(ctx)
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(25))
    await dispatch(h, 'session:resume', {})
    ctx.advance(minute(1))
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(26))
  })

  it('自動休憩に入り、休憩後は手動で次周期を再開する', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25, breakMinutes: 5 })
    const startedAt = ctx.now()
    ctx.advance(minute(27))
    checkExpire(ctx)
    expect(buildState(ctx.store.data, ctx.runtime, ctx.now()).breakTimer).toMatchObject({ startedAt: startedAt + minute(25), endsAt: startedAt + minute(30) })
    expect(ctx.calls).not.toContain('open:expire')
    ctx.advance(minute(10))
    checkExpire(ctx)
    expect(ctx.calls).toContain('open:expire')
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(25))
    await dispatch(h, 'session:resume', {})
    ctx.advance(minute(10))
    expect(liveSession(ctx.store.data)?.plannedMs).toBe(minute(50))
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(35))
  })

  it('任意の自動再開でも、遅れた刻みの空白を作業に加算しない', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    await dispatch(createHandlers(ctx), 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25, breakMinutes: 5, autoResume: true })
    ctx.advance(minute(50))
    checkExpire(ctx)
    expect(liveSession(ctx.store.data)?.state).toBe('running')
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(25))
    ctx.advance(minute(3))
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(28))
  })

  it('作業途中の手動休憩から再開しても次周期へ繰り上げない', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25 })
    ctx.advance(minute(10))
    await dispatch(h, 'session:break', { minutes: 3 })
    ctx.advance(minute(3))
    await dispatch(h, 'session:resume', {})
    expect(liveSession(ctx.store.data)?.plannedMs).toBe(minute(25))
    ctx.advance(minute(5))
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(15))
  })

  it('自動再開の設定があっても管理中に明示した停止は保つ', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25, breakMinutes: 5, autoResume: true })
    ctx.advance(minute(25))
    checkExpire(ctx)
    setCurrentWorkOpen(ctx, true)
    await dispatch(h, 'session:pause', {})
    ctx.advance(minute(10))
    checkExpire(ctx)
    setCurrentWorkOpen(ctx, false)
    expect(liveSession(ctx.store.data)?.state).toBe('paused')
    expect(focusMs(liveSession(ctx.store.data)!, ctx.now())).toBe(minute(25))
  })
})

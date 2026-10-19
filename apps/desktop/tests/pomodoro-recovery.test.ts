import { describe, expect, it } from 'vitest'
import { focusMs, MINUTE } from '@white-box/core/engine'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { checkExpire, restoreOpenSession } from '../src/app/lifecycle.js'
import { liveSession, newRuntime } from '../src/app/state.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

describe('ポモドーロ休憩中の再起動', () => {
  it.each([
    { autoResume: true, heartbeat: true },
    { autoResume: true, heartbeat: false },
    { autoResume: false, heartbeat: true },
  ])('長い空白の後は人の再開を待つ: %j', async ({ autoResume, heartbeat }) => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    const startedAt = ctx.now()
    await dispatch(h, 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25, breakMinutes: 5, autoResume })
    ctx.advance(25 * MINUTE)
    checkExpire(ctx)
    ctx.advance(MINUTE)
    if (heartbeat) ctx.setLastAlive(ctx.now())
    ctx.advance(60 * MINUTE)
    ctx.runtime = newRuntime()
    restoreOpenSession(ctx, 90_000)
    checkExpire(ctx)
    expect(liveSession(db)?.state).toBe('paused')
    if (autoResume) expect(ctx.runtime.recovery).toMatchObject({ lastKnownAt: startedAt + (heartbeat ? 26 : 25) * MINUTE })
    else expect(ctx.runtime.recovery).toBeNull()
    ctx.advance(10 * MINUTE)
    checkExpire(ctx)
    expect(focusMs(liveSession(db)!, ctx.now())).toBe(25 * MINUTE)
    await dispatch(h, autoResume ? 'recovery:resume' : 'session:resume', {})
    expect(ctx.runtime.recovery).toBeNull()
    expect(liveSession(db)?.plannedMs).toBe(50 * MINUTE)
    ctx.advance(MINUTE)
    expect(focusMs(liveSession(db)!, ctx.now())).toBe(26 * MINUTE)
  })

  it('最初の生存記録が無い実行中記録も、最後の操作で停止して復旧を待つ', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const startedAt = ctx.now()
    await dispatch(createHandlers(ctx), 'session:start', { taskId: 'a', mode: 'stopwatch', minutes: 25 })
    ctx.advance(60 * MINUTE)
    ctx.runtime = newRuntime()
    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery).toMatchObject({ lastKnownAt: startedAt })
    expect(focusMs(liveSession(db)!, ctx.now())).toBe(0)
  })

  it('短い再起動では自動再開の設定を維持する', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    await dispatch(createHandlers(ctx), 'session:start', { taskId: 'a', mode: 'pomodoro', minutes: 25, breakMinutes: 5, autoResume: true })
    ctx.advance(25 * MINUTE)
    checkExpire(ctx)
    ctx.advance(4.5 * MINUTE)
    ctx.setLastAlive(ctx.now())
    ctx.advance(MINUTE)
    ctx.runtime = newRuntime()
    restoreOpenSession(ctx, 90_000)
    checkExpire(ctx)
    expect(ctx.runtime.recovery).toBeNull()
    expect(liveSession(db)?.state).toBe('running')
    expect(focusMs(liveSession(db)!, ctx.now())).toBe(25 * MINUTE)
  })
})

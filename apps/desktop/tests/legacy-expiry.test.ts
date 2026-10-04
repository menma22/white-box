import { describe, expect, it } from 'vitest'
import { focusMs, MINUTE } from '@white-box/core/engine'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { checkExpire, restoreOpenSession } from '../src/app/lifecycle.js'
import { liveSession } from '../src/app/state.js'
import { createSession } from '../src/domain/session-ops.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

describe('旧版の満了済み未終了記録', () => {
  it('停止区間がまだ無くても満了後を計上せず、延長は操作時刻から再開する', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const startedAt = ctx.now()
    const legacy = createSession({ taskId: 'a', taskTitle: 'A', plannedMs: 25 * MINUTE, now: startedAt })
    legacy.expiredNotifiedAt = startedAt + 26 * MINUTE
    legacy.events.push({ at: legacy.expiredNotifiedAt, type: 'timer_expired', label: '予定時間に到達' })
    db.sessions.push(legacy)
    ctx.advance(60 * MINUTE)
    expect(focusMs(legacy, ctx.now())).toBe(25 * MINUTE)
    checkExpire(ctx)
    const stopped = liveSession(db)!
    expect(stopped.state).toBe('paused')
    expect(stopped.pauses).toEqual([{ startedAt: startedAt + 25 * MINUTE, endedAt: null, reason: 'expired' }])
    expect(stopped.expiredNotifiedAt).toBe(legacy.expiredNotifiedAt)
    expect(stopped.events.filter((e) => e.type === 'timer_expired')).toHaveLength(1)
    await dispatch(createHandlers(ctx), 'session:extend', { minutes: 10 })
    ctx.advance(5 * MINUTE)
    expect(focusMs(liveSession(db)!, ctx.now())).toBe(30 * MINUTE)
  })

  it('旧満了記録からの復旧終了も正確な到達時刻で止める', async () => {
    const db = emptyDb()
    const ctx = fakeCtx(db)
    const startedAt = ctx.now()
    const legacy = createSession({ taskId: 'a', taskTitle: 'A', plannedMs: 25 * MINUTE, now: startedAt })
    legacy.expiredNotifiedAt = startedAt + 26 * MINUTE
    db.sessions.push(legacy)
    ctx.setLastAlive(startedAt + 40 * MINUTE)
    ctx.advance(90 * MINUTE)
    restoreOpenSession(ctx, 90_000)
    await dispatch(createHandlers(ctx), 'recovery:close', {})
    expect(db.sessions[0]?.endedAt).toBe(startedAt + 40 * MINUTE)
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(25 * MINUTE)
  })
})

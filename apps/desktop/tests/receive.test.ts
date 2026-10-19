import { describe, expect, it } from 'vitest'
import type { Session } from '@white-box/core/types'
import { excludedMs, focusMs, MINUTE } from '@white-box/core/engine'
import { restoreOpenSession } from '../src/app/lifecycle.js'
import { createHandlers, dispatch, type Handlers } from '../src/app/handlers.js'
import { receive } from '../src/app/receive.js'
import { emptyDb, fakeCtx, task, type FakeCtx } from './helpers.js'

async function neglected(): Promise<{ ctx: FakeCtx; h: Handlers; session: Session }> {
  const db = emptyDb()
  db.tasks = [task({ id: 'a' })]
  const ctx = fakeCtx(db)
  const h = createHandlers(ctx)
  const startedAt = ctx.now()
  ctx.advance(230 * MINUTE)
  db.sessions.push({
    id: 'legacy-overrun',
    startedAt,
    endedAt: ctx.now(),
    plannedMs: 50 * MINUTE,
    state: 'ended',
    segments: [{ id: 'legacy-segment', taskId: 'a', startedAt, endedAt: ctx.now() }],
    pauses: [],
    events: [{ at: ctx.now(), type: 'session_ended', label: 'セッション終了' }],
    progressChanges: [],
    note: '',
    expiredNotifiedAt: null,
    editedAt: null,
    createdAt: startedAt,
  })
  return { ctx, h, session: db.sessions[0]! }
}

describe('受け口', () => {
  it('満了後の異常終了から再開しても停止を保ち、延長の確認窓を示す', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await receive(h, 'session:start', { taskId: 'a', minutes: 1 })
    ctx.advance(2 * MINUTE)
    await receive(h, 'session:resume', {})
    ctx.setLastAlive(ctx.now())
    ctx.advance(5 * MINUTE)
    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery).not.toBeNull()
    ctx.calls.length = 0
    expect((await receive(h, 'recovery:resume', {})).ok).toBe(true)
    expect(db.sessions[0]?.state).toBe('paused')
    expect(ctx.runtime.recovery).toBeNull()
    expect(ctx.calls).toContain('open:expire')
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(MINUTE)
  })

  it('満了後の再開コマンドは停止と確認窓を保ち、延長コマンドで再開する', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await receive(h, 'session:start', { taskId: 'a', minutes: 1 })
    ctx.advance(2 * MINUTE)
    expect((await receive(h, 'session:resume', {})).ok).toBe(true)
    expect(db.sessions[0]?.state).toBe('paused')
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(MINUTE)
    expect(ctx.calls.at(-1)).toBe('open:expire')
    await receive(h, 'session:extend', { minutes: 1 })
    ctx.advance(MINUTE / 2)
    expect(db.sessions[0]?.state).toBe('running')
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(1.5 * MINUTE)
  })

  it('旧タイマーの満了超過記録でも除外は {ok:true} で、実作業がその分だけ減る', async () => {
    const { ctx, h, session } = await neglected()
    expect(focusMs(session, ctx.now())).toBe(230 * MINUTE)
    const from = session.startedAt + 50 * MINUTE
    const reply = await receive(h, 'session:update', {
      id: session.id,
      patch: { exclusions: [{ startedAt: from, endedAt: session.endedAt }] },
    })
    expect(reply.ok).toBe(true)
    const after = ctx.store.data.sessions[0]!
    expect(focusMs(after, ctx.now())).toBe(50 * MINUTE)
    expect(excludedMs(after, ctx.now())).toBe(180 * MINUTE)
    expect(after.editedAt).toBe(ctx.now())
    expect(after.events.some((e) => e.type === 'session_edited')).toBe(true)
  })

  it('噛み合わない除外は {ok:false} で、記録は 1 ミリ秒も動かない', async () => {
    const { ctx, h, session } = await neglected()
    const before = JSON.stringify(session)
    const bad: Record<string, { startedAt: number; endedAt: number }[]> = {
      逆さま: [{ startedAt: session.startedAt + 60 * MINUTE, endedAt: session.startedAt + 30 * MINUTE }],
      長さ0: [{ startedAt: session.startedAt + 60 * MINUTE, endedAt: session.startedAt + 60 * MINUTE }],
      範囲の外: [{ startedAt: session.startedAt - MINUTE, endedAt: session.startedAt + 30 * MINUTE }],
      重なり: [
        { startedAt: session.startedAt + 60 * MINUTE, endedAt: session.startedAt + 120 * MINUTE },
        { startedAt: session.startedAt + 100 * MINUTE, endedAt: session.startedAt + 140 * MINUTE },
      ],
    }
    for (const [name, exclusions] of Object.entries(bad)) {
      const reply = await receive(h, 'session:update', { id: session.id, patch: { exclusions } })
      expect(reply.ok, `${name} が通ってしまった`).toBe(false)
      expect(JSON.stringify(ctx.store.data.sessions[0]), `${name} で記録が変わった`).toBe(before)
    }
  })

  it('観測された一時停止と重なる除外は {ok:false}', async () => {
    const { ctx, h, session } = await neglected()
    const pauseStart = session.startedAt + 100 * MINUTE
    ctx.store.data.sessions[0]!.pauses.push({ startedAt: pauseStart, endedAt: pauseStart + 10 * MINUTE, reason: 'manual' })
    const reply = await receive(h, 'session:update', {
      id: session.id,
      patch: { exclusions: [{ startedAt: pauseStart + 5 * MINUTE, endedAt: pauseStart + 50 * MINUTE }] },
    })
    expect(reply.ok).toBe(false)
  })

  it('終わっていないセッションへの除外は {ok:false}', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', minutes: 50 })
    const live = db.sessions[0]!
    ctx.advance(60 * MINUTE)
    const reply = await receive(h, 'session:update', {
      id: live.id,
      patch: { exclusions: [{ startedAt: live.startedAt + 10 * MINUTE, endedAt: live.startedAt + 20 * MINUTE }] },
    })
    expect(reply.ok).toBe(false)
    expect(db.sessions[0]!.editedAt).toBeNull()
  })

  it('契約に無いコマンド・綴り違いのキーも {ok:false}', async () => {
    const { h, session } = await neglected()
    expect((await receive(h, 'session:steal', {})).ok).toBe(false)
    expect((await receive(h, 'session:update', { id: session.id, patch: { exclusion: [] } })).ok).toBe(false)
    expect(
      (await receive(h, 'session:update', { id: session.id, patch: { exclusions: [{ startedAt: 0, ended: 1 }] } })).ok,
    ).toBe(false)
  })

  it('通ったコマンドは結果をそのまま返す', async () => {
    const { h } = await neglected()
    const reply = await receive(h, 'task:create', { title: '書きかけの仕事' })
    expect(reply.ok).toBe(true)
    expect(reply.ok && (reply.data as { title: string }).title).toBe('書きかけの仕事')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { declaredExclusions, focusMs } from '@white-box/core/engine'
import type { Session } from '@white-box/core/types'
import { resolvePresenceCandidate } from '../src/domain/presence-ops.js'
import { createPresenceHandlers } from '../src/app/presence-handlers.js'
import { emptyDb, fakeCtx } from './helpers.js'

function setup() {
  const db = emptyDb()
  const session: Session = {
    id: 's', startedAt: 0, endedAt: 60_000, state: 'ended', plannedMs: 60_000,
    segments: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: 0,
    pauses: [
      { startedAt: 10_000, endedAt: 20_000, reason: 'manual' },
      { startedAt: 15_000, endedAt: 25_000, reason: 'excluded' },
      { startedAt: 30_000, endedAt: 35_000, reason: 'lock' },
      { startedAt: 40_000, endedAt: 50_000, reason: 'break' },
    ],
  }
  db.sessions = [session]
  db.presenceCandidates = [{ id: 'candidate', sessionId: 's', startedAt: 5_000, endedAt: 55_000, status: 'pending', createdAt: 60_000, reviewedAt: null }]
  return { db, session }
}

describe('本人による離席候補の確認', () => {
  it.each(['accept', 'dismiss'] as const)('保存失敗を候補と記録へ残さず、同じ確認を再試行できる（%s）', (decision) => {
    const { db } = setup()
    const ctx = fakeCtx(db)
    const resolve = createPresenceHandlers(ctx)['presence:resolve']
    const before = JSON.stringify(db)
    vi.spyOn(ctx, 'publish').mockImplementationOnce(() => { throw new Error('保存失敗') })
    expect(() => resolve({ id: 'candidate', decision })).toThrow('保存失敗')
    expect(JSON.stringify(db)).toBe(before)
    resolve({ id: 'candidate', decision })
    expect(db.presenceCandidates![0]!.status).toBe(decision === 'accept' ? 'accepted' : 'dismissed')
    const resolved = JSON.stringify(db)
    resolve({ id: 'candidate', decision })
    expect(JSON.stringify(db)).toBe(resolved)
  })

  it('未確認・見送りでは時間を変えず、確認後は停止済みの重なりを二重に引かない', () => {
    const { db, session } = setup()
    const original = JSON.stringify(db)
    const dismissed = resolvePresenceCandidate(db, 'candidate', 'dismiss', 70_000)
    expect(dismissed.sessions).toBe(db.sessions)
    const result = resolvePresenceCandidate(db, 'candidate', 'accept', 70_000)
    expect(JSON.stringify(db)).toBe(original)
    const updated = result.sessions[0]!
    expect(updated.pauses.filter((p) => p.reason !== 'excluded')).toEqual(session.pauses.filter((p) => p.reason !== 'excluded'))
    expect(declaredExclusions(updated)).toEqual([
      { startedAt: 5_000, endedAt: 10_000 }, { startedAt: 15_000, endedAt: 25_000 },
      { startedAt: 25_000, endedAt: 30_000 }, { startedAt: 35_000, endedAt: 40_000 },
      { startedAt: 50_000, endedAt: 55_000 },
    ])
    expect(focusMs(session, 70_000) - focusMs(updated, 70_000)).toBe(20_000)
    expect(result.presenceCandidates[0]).toMatchObject({ status: 'accepted', reviewedAt: 70_000 })
    expect(resolvePresenceCandidate({ ...db, ...result }, 'candidate', 'accept', 80_000).sessions).toBe(result.sessions)
  })
  it('実行中への反映と不明な候補を拒否し、途中で記録を変えない', () => {
    const { db } = setup()
    db.sessions[0]!.endedAt = null
    db.sessions[0]!.state = 'running'
    const before = JSON.stringify(db)
    expect(() => resolvePresenceCandidate(db, 'candidate', 'accept', 70_000)).toThrow(/終了/)
    expect(() => resolvePresenceCandidate(db, 'missing', 'dismiss', 70_000)).toThrow(/見つかりません/)
    expect(JSON.stringify(db)).toBe(before)
    expect(resolvePresenceCandidate(db, 'candidate', 'dismiss', 70_000).sessions).toBe(db.sessions)
  })
  it('ハンドラが確認結果と記録を同時に保存・配信する', () => {
    const { db } = setup()
    const ctx = fakeCtx(db)
    createPresenceHandlers(ctx)['presence:resolve']({ id: 'candidate', decision: 'accept' })
    expect(ctx.store.data.presenceCandidates?.[0]?.status).toBe('accepted')
    expect(ctx.store.data.sessions[0]?.editedAt).toBe(ctx.now())
    expect(ctx.calls).toContain('publish')
  })
})

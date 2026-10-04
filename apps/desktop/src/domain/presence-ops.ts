import type { Database, Session } from '@white-box/core/types'
import { candidateExclusions, type PresenceCandidate } from '@white-box/core/presence'
import { editSession } from './session-ops.js'

export function resolvePresenceCandidate(db: Database, candidateId: string, decision: 'accept' | 'dismiss', now: number): {
  presenceCandidates: PresenceCandidate[]; sessions: Session[]
} {
  const candidates = db.presenceCandidates ?? []
  const candidate = candidates.find((item) => item.id === candidateId)
  if (!candidate) throw new Error('離席候補が見つかりません')
  if (candidate.status !== 'pending') return { presenceCandidates: candidates, sessions: db.sessions }
  let sessions = db.sessions
  if (decision === 'accept') {
    const session = db.sessions.find((item) => item.id === candidate.sessionId)
    if (!session) throw new Error('対象のセッションが見つかりません')
    const ranges = candidateExclusions(session, candidate, now)
    if (ranges.length) {
      const updated = editSession(session, {}, now)
      updated.pauses = [...updated.pauses, ...ranges.map((range) => ({ ...range, reason: 'excluded' as const }))].sort((a, b) => a.startedAt - b.startedAt)
      updated.events[updated.events.length - 1]!.label = '記録を手で修正（カメラの離席候補を確認）'
      sessions = db.sessions.map((item) => item.id === session.id ? updated : item)
    }
  }
  return {
    sessions,
    presenceCandidates: candidates.map((item) => item.id === candidateId ? { ...item, status: decision === 'accept' ? 'accepted' : 'dismissed', reviewedAt: now } : item),
  }
}

import { unpausedRanges } from './engine.js'
import type { Session, TimeRange } from './types.js'

export const PRESENCE_THRESHOLD_MS = 10_000

export interface PresenceCandidate extends TimeRange {
  id: string
  sessionId: string
  status: 'pending' | 'accepted' | 'dismissed'
  createdAt: number
  reviewedAt: number | null
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('離席候補の日時が不正です')
  return value
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('離席候補のIDが不正です')
  return value
}

export function parsePresenceCandidates(value: unknown): PresenceCandidate[] {
  if (!Array.isArray(value)) throw new Error('離席候補の形式が不正です')
  const ids = new Set<string>()
  return value.map((entry): PresenceCandidate => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('離席候補の形式が不正です')
    const raw = entry as Record<string, unknown>
    const candidateId = id(raw.id)
    if (ids.has(candidateId)) throw new Error('離席候補のIDが重複しています')
    ids.add(candidateId)
    const startedAt = timestamp(raw.startedAt), endedAt = timestamp(raw.endedAt)
    if (endedAt - startedAt < PRESENCE_THRESHOLD_MS) throw new Error('離席候補は10秒以上で指定してください')
    if (!['pending', 'accepted', 'dismissed'].includes(raw.status as string)) throw new Error('離席候補の状態が不正です')
    const reviewedAt = raw.reviewedAt === null ? null : timestamp(raw.reviewedAt)
    if ((raw.status === 'pending') !== (reviewedAt === null)) throw new Error('離席候補の確認日時が不正です')
    return { id: candidateId, sessionId: id(raw.sessionId), startedAt, endedAt, status: raw.status as PresenceCandidate['status'], createdAt: timestamp(raw.createdAt), reviewedAt }
  })
}

export function candidateExclusions(session: Session, candidate: TimeRange, now: number): TimeRange[] {
  if (session.state !== 'ended' || session.endedAt === null) throw new Error('終了したセッションで離席候補を確認してください')
  return unpausedRanges(session.pauses, Math.max(session.startedAt, candidate.startedAt), Math.min(session.endedAt, candidate.endedAt), now)
}

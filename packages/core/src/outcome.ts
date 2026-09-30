import type { OutcomeRecord, OutcomeStatus } from './types.js'

export function emptyOutcome(): OutcomeRecord {
  return { status: 'pending', deliverable: '', result: '', assessedAt: null }
}

export function parseOutcome(value: unknown): OutcomeRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('成果の形式が不正です')
  const raw = value as Record<string, unknown>
  const status = raw.status ?? 'pending'
  if (!['pending', 'achieved', 'not-achieved'].includes(status as string)) throw new Error('達成状態が不正です')
  const deliverable = raw.deliverable ?? ''
  const result = raw.result ?? ''
  const assessedAt = raw.assessedAt ?? null
  if (typeof deliverable !== 'string' || typeof result !== 'string') throw new Error('成果の内容が不正です')
  if (assessedAt !== null && (typeof assessedAt !== 'number' || !Number.isFinite(assessedAt) || assessedAt < 0)) throw new Error('達成日時が不正です')
  if (status === 'achieved' && !deliverable.trim() && !result.trim()) throw new Error('成果物または達成結果を記入してください')
  return { status: status as OutcomeStatus, deliverable, result, assessedAt }
}

export function changeOutcome(current: OutcomeRecord | undefined, patch: Partial<OutcomeRecord>, now: number): OutcomeRecord {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('成果の形式が不正です')
  const previous = current ?? emptyOutcome()
  const status = patch.status ?? previous.status
  const assessedAt = status === 'pending' ? null : status === previous.status ? previous.assessedAt ?? now : now
  return parseOutcome({ ...previous, ...patch, status, assessedAt })
}

/**
 * セッションの時間計算。副作用を持たない純関数だけを置く（テスト対象）。
 *
 * 実作業時間 = 経過時間 − 一時停止の重なり。開いたままの区間は now で閉じて数える。
 */
import type { PauseInterval, Session, TaskSegment, TimeRange, ID } from './types.js'

export const MINUTE = 60_000
export const HOUR = 3_600_000

/** [from, to) と一時停止区間の重なりの合計。 */
export function pausedMsWithin(pauses: PauseInterval[], from: number, to: number, now: number): number {
  if (to <= from) return 0
  let total = 0
  for (const p of pauses) {
    const start = Math.max(p.startedAt, from)
    const end = Math.min(p.endedAt ?? now, to)
    if (end > start) total += end - start
  }
  return total
}

export function sessionEndOrNow(session: Session, now: number): number {
  return session.endedAt ?? now
}

/** セッション全体の実作業時間。 */
export function focusMs(session: Session, now: number): number {
  const end = sessionEndOrNow(session, now)
  const gross = Math.max(0, end - session.startedAt)
  return Math.max(0, gross - pausedMsWithin(session.pauses, session.startedAt, end, now))
}

/** セッション全体の一時停止時間。 */
export function pausedMs(session: Session, now: number): number {
  const end = sessionEndOrNow(session, now)
  return pausedMsWithin(session.pauses, session.startedAt, end, now)
}

/** そのうち、後から「作業していなかった」と申告して除外した時間。 */
export function excludedMs(session: Session, now: number): number {
  const end = sessionEndOrNow(session, now)
  const declared = session.pauses.filter((p) => p.reason === 'excluded')
  return pausedMsWithin(declared, session.startedAt, end, now)
}

/** そのとき実際に止めた時間（後からの申告を含まない）。 */
export function livePausedMs(session: Session, now: number): number {
  const end = sessionEndOrNow(session, now)
  const observed = session.pauses.filter((p) => p.reason !== 'excluded')
  return pausedMsWithin(observed, session.startedAt, end, now)
}

/** 申告として記録されている除外区間。 */
export function declaredExclusions(session: Session): TimeRange[] {
  return session.pauses.flatMap((p) =>
    p.reason === 'excluded' && p.endedAt !== null ? [{ startedAt: p.startedAt, endedAt: p.endedAt }] : [],
  )
}

/** [from, to) のうち、まだ一時停止になっていない範囲。除外を申告できる範囲そのもの。 */
export function unpausedRanges(pauses: PauseInterval[], from: number, to: number, now: number): TimeRange[] {
  if (to <= from) return []
  const blocks = pauses
    .map((p) => ({ startedAt: Math.max(p.startedAt, from), endedAt: Math.min(p.endedAt ?? now, to) }))
    .filter((p) => p.endedAt > p.startedAt)
    .sort((a, b) => a.startedAt - b.startedAt)
  const out: TimeRange[] = []
  let cursor = from
  for (const b of blocks) {
    if (b.startedAt > cursor) out.push({ startedAt: cursor, endedAt: b.startedAt })
    cursor = Math.max(cursor, b.endedAt)
  }
  if (cursor < to) out.push({ startedAt: cursor, endedAt: to })
  return out
}

/** 実作業が予定時間に達した瞬間。まだ達していなければ null。 */
export function plannedReachedAt(session: Session, now: number): number | null {
  const end = sessionEndOrNow(session, now)
  let worked = 0
  for (const run of unpausedRanges(session.pauses, session.startedAt, end, now)) {
    const length = run.endedAt - run.startedAt
    if (worked + length >= session.plannedMs) return run.startedAt + (session.plannedMs - worked)
    worked += length
  }
  return null
}

/** 予定に達してから終了までの、まだ止まっていない範囲（＝満了後に放置していた分）。 */
export function overrunRanges(session: Session, now: number): TimeRange[] {
  const from = plannedReachedAt(session, now)
  if (from === null) return []
  return unpausedRanges(session.pauses, from, sessionEndOrNow(session, now), now)
}

export function totalRangeMs(ranges: TimeRange[]): number {
  return ranges.reduce((sum, r) => sum + Math.max(0, r.endedAt - r.startedAt), 0)
}

export function segmentFocusMs(session: Session, segment: TaskSegment, now: number): number {
  const end = Math.min(segment.endedAt ?? sessionEndOrNow(session, now), sessionEndOrNow(session, now))
  const gross = Math.max(0, end - segment.startedAt)
  return Math.max(0, gross - pausedMsWithin(session.pauses, segment.startedAt, end, now))
}

export function remainingMs(session: Session, now: number): number {
  return session.plannedMs - focusMs(session, now)
}

export function activeSegment(session: Session): TaskSegment | null {
  for (let i = session.segments.length - 1; i >= 0; i--) {
    const s = session.segments[i]!
    if (s.endedAt === null) return s
  }
  return null
}

export function activeTaskId(session: Session): ID | null {
  return activeSegment(session)?.taskId ?? null
}

export function isPaused(session: Session): boolean {
  return session.pauses.some((p) => p.endedAt === null)
}

/** セッション内でタスクごとに費やした実作業時間。 */
export function focusByTask(session: Session, now: number): Map<ID, number> {
  const out = new Map<ID, number>()
  for (const seg of session.segments) {
    out.set(seg.taskId, (out.get(seg.taskId) ?? 0) + segmentFocusMs(session, seg, now))
  }
  return out
}

/** dayStartHour を境界にした「その日」のキー（YYYY-MM-DD, ローカル）。 */
export function dayKey(ts: number, dayStartHour: number): string {
  const d = new Date(ts - dayStartHour * HOUR)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** dayKey の 1 日が始まる時刻。 */
export function dayStartTs(key: string, dayStartHour: number): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, dayStartHour, 0, 0, 0).getTime()
}

export function sessionsOfDay(sessions: Session[], key: string, dayStartHour: number): Session[] {
  return sessions
    .filter((s) => dayKey(s.startedAt, dayStartHour) === key)
    .sort((a, b) => a.startedAt - b.startedAt)
}

export function totalFocusMs(sessions: Session[], now: number): number {
  return sessions.reduce((sum, s) => sum + focusMs(s, now), 0)
}

/** 複数セッションを横断したタスク別の実作業時間。 */
export function focusByTaskAcross(sessions: Session[], now: number): Map<ID, number> {
  const out = new Map<ID, number>()
  for (const s of sessions) {
    for (const [taskId, ms] of focusByTask(s, now)) {
      out.set(taskId, (out.get(taskId) ?? 0) + ms)
    }
  }
  return out
}

export function formatDuration(ms: number, style: 'hm' | 'hms' | 'compact' = 'hm'): string {
  const neg = ms < 0
  const abs = Math.abs(ms)
  const totalSec = Math.floor(abs / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const sign = neg ? '-' : ''
  if (style === 'hms') {
    return h > 0
      ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  if (style === 'compact') {
    if (h > 0 && m > 0) return `${sign}${h}h ${m}m`
    if (h > 0) return `${sign}${h}h`
    return `${sign}${m}m`
  }
  return `${sign}${h}:${String(m).padStart(2, '0')}`
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * セッションの時間計算。副作用を持たない純関数だけを置く（テスト対象）。
 *
 * 実作業時間 = 経過時間 − 一時停止の重なり。開いたままの区間は now で閉じて数える。
 */
import type { PauseInterval, Session, TaskSegment, ID } from './types.js'

export const MINUTE = 60_000
export const HOUR = 3_600_000

/** [from, to) と一時停止区間の重なりの合計。重複区間は一度だけ数える。 */
export function pausedMsWithin(pauses: PauseInterval[], from: number, to: number, now: number): number {
  if (to <= from) return 0

  const intervals = pauses
    .map((pause) => [Math.max(pause.startedAt, from), Math.min(pause.endedAt ?? now, to)] as const)
    .filter(([start, end]) => end > start)
    .sort(([a], [b]) => a - b)

  let total = 0
  let currentStart: number | null = null
  let currentEnd = 0
  for (const [start, end] of intervals) {
    if (currentStart === null) {
      currentStart = start
      currentEnd = end
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end)
    } else {
      total += currentEnd - currentStart
      currentStart = start
      currentEnd = end
    }
  }
  return currentStart === null ? 0 : total + currentEnd - currentStart
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

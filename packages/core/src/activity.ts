import type { ID, PauseInterval, Session, Task, TimeRange } from './types.js'
import { dayKey, dayStartTs, focusEndOrNow, segmentRange, sessionEndOrNow, totalRangeMs, unpausedRanges } from './engine.js'

export function shiftDay(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + days)
  return dayKey(date.getTime(), 0)
}

export function dayRange(key: string, dayStartHour: number): TimeRange {
  return { startedAt: dayStartTs(key, dayStartHour), endedAt: dayStartTs(shiftDay(key, 1), dayStartHour) }
}

export function weekKey(key: string): string {
  const weekday = new Date(`${key}T12:00:00`).getDay()
  return shiftDay(key, -(weekday + 6) % 7)
}

export function weekRange(key: string, dayStartHour: number): TimeRange {
  const start = weekKey(key)
  return { startedAt: dayStartTs(start, dayStartHour), endedAt: dayStartTs(shiftDay(start, 7), dayStartHour) }
}

function clip(range: TimeRange, period: TimeRange): TimeRange | null {
  const startedAt = Math.max(range.startedAt, period.startedAt)
  const endedAt = Math.min(range.endedAt, period.endedAt)
  return endedAt > startedAt ? { startedAt, endedAt } : null
}

export interface WorkSlice extends TimeRange {
  sessionId: ID
  taskId: ID | null
}

export function activitySlices(sessions: Session[], now: number, period: TimeRange): WorkSlice[] {
  const raw: WorkSlice[] = []
  for (const session of [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))) {
    for (const segment of session.segments) {
      const range = clip(segmentRange(session, segment, now), period)
      if (!range) continue
      for (const work of unpausedRanges(session.pauses, range.startedAt, range.endedAt, now)) {
        raw.push({ ...work, sessionId: session.id, taskId: segment.taskId })
      }
    }
    if (!session.segments.length) {
      const range = clip({ startedAt: session.startedAt, endedAt: focusEndOrNow(session, now) }, period)
      if (range) for (const work of unpausedRanges(session.pauses, range.startedAt, range.endedAt, now)) {
        raw.push({ ...work, sessionId: session.id, taskId: null })
      }
    }
  }
  // 開始時刻・ID・区間順の先行記録へ帰属させ、編集で重なった時刻を一度だけ数える。
  const out: WorkSlice[] = []
  const occupied: TimeRange[] = []
  for (const work of raw) {
    for (const range of unpausedRanges(occupied.map((r) => ({ ...r, reason: null })), work.startedAt, work.endedAt, now)) {
      out.push({ ...range, sessionId: work.sessionId, taskId: work.taskId })
    }
    occupied.push(work)
  }
  return out.sort((a, b) => a.startedAt - b.startedAt)
}

export interface ActivitySummary {
  focusMs: number
  pausedMs: number
  managementMs: number
  excludedMs: number
  taskMs: Map<ID | null, number>
  projectMs: Map<ID | null, number>
  sessionMs: Map<ID, number>
  sessions: Session[]
  completedTasks: Task[]
}

interface PauseSlice extends WorkSlice { reason: PauseInterval['reason'] }

function pauseSlices(sessions: Session[], now: number, period: TimeRange, work: WorkSlice[]): PauseSlice[] {
  const rank = (reason: PauseInterval['reason']) => reason === 'excluded' ? 0 : reason === 'task-management' ? 1 : 2
  const pauses = [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).flatMap((session) => session.pauses.flatMap((pause) => {
    const range = clip({ startedAt: Math.max(pause.startedAt, session.startedAt), endedAt: Math.min(pause.endedAt ?? now, sessionEndOrNow(session, now)) }, period)
    return range ? [{ ...range, reason: pause.reason, sessionId: session.id, taskId: null }] : []
  })).sort((a, b) => rank(a.reason) - rank(b.reason))
  const occupied: TimeRange[] = [...work]
  const out: PauseSlice[] = []
  for (const pause of pauses) {
    for (const range of unpausedRanges(occupied.map((r) => ({ ...r, reason: null })), pause.startedAt, pause.endedAt, now)) out.push({ ...pause, ...range })
    occupied.push(pause)
  }
  return out
}

export function activitySummary(sessions: Session[], tasks: Task[], now: number, period: TimeRange): ActivitySummary {
  const slices = activitySlices(sessions, now, period)
  const taskMs = new Map<ID | null, number>()
  const projectMs = new Map<ID | null, number>()
  const sessionMs = new Map<ID, number>()
  const taskProjects = new Map(tasks.map((t) => [t.id, t.projectId]))
  for (const slice of slices) {
    const ms = slice.endedAt - slice.startedAt
    const projectId = slice.taskId === null ? null : taskProjects.get(slice.taskId) ?? null
    taskMs.set(slice.taskId, (taskMs.get(slice.taskId) ?? 0) + ms)
    projectMs.set(projectId, (projectMs.get(projectId) ?? 0) + ms)
    sessionMs.set(slice.sessionId, (sessionMs.get(slice.sessionId) ?? 0) + ms)
  }
  const touching = sessions.filter((s) => clip({ startedAt: s.startedAt, endedAt: sessionEndOrNow(s, now) }, period)
    || s.startedAt === sessionEndOrNow(s, now) && s.startedAt >= period.startedAt && s.startedAt < period.endedAt)
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
  const pauses = pauseSlices(touching, now, period, slices)
  const excluded = pauses.filter((p) => p.reason === 'excluded')
  const observed = pauses.filter((p) => p.reason !== 'excluded')
  const management = pauses.filter((p) => p.reason === 'task-management')
  return {
    focusMs: totalRangeMs(slices), pausedMs: totalRangeMs(observed), managementMs: totalRangeMs(management), excludedMs: totalRangeMs(excluded),
    taskMs, projectMs, sessionMs, sessions: touching,
    completedTasks: tasks.filter((t) => t.status === 'done' && t.doneAt !== null && t.doneAt >= period.startedAt && t.doneAt < period.endedAt),
  }
}

export interface ActivityTimelineItem extends WorkSlice {
  kind: 'work' | 'pause' | 'excluded'
}

export function activityTimeline(sessions: Session[], now: number, period: TimeRange): ActivityTimelineItem[] {
  const work = activitySlices(sessions, now, period)
  const items: ActivityTimelineItem[] = work.map((s) => ({ ...s, kind: 'work' }))
  for (const pause of pauseSlices(sessions, now, period, work)) items.push({ ...pause, kind: pause.reason === 'excluded' ? 'excluded' : 'pause' })
  return items.sort((a, b) => a.startedAt - b.startedAt)
}

export function activityDayKeys(sessions: Session[], now: number, dayStartHour: number, period?: TimeRange): string[] {
  const keys = new Set<string>()
  for (const session of sessions) {
    const end = sessionEndOrNow(session, now)
    if (!Number.isFinite(new Date(session.startedAt).getTime()) || !Number.isFinite(new Date(end).getTime())) continue
    if (end === session.startedAt && (!period || end >= period.startedAt && end < period.endedAt)) keys.add(dayKey(end, dayStartHour))
    const from = Math.max(session.startedAt, period?.startedAt ?? -Infinity)
    const to = Math.min(end, period?.endedAt ?? Infinity)
    if (to <= from) continue
    const last = dayKey(to - 1, dayStartHour)
    for (let key = dayKey(from, dayStartHour); key <= last;) {
      keys.add(key)
      const next = shiftDay(key, 1)
      if (next <= key || !Number.isFinite(dayStartTs(next, dayStartHour))) break
      key = next
    }
  }
  return [...keys].sort().reverse()
}

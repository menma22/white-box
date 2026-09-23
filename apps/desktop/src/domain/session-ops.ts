/**
 * セッションの状態遷移。すべて「新しい Session を返す」純関数（テスト対象）。
 *
 * 終了済み（endedAt != null）のセッションは遷移させない — 記録を後から動かさないため。
 */
import type { ID, Session, SessionEvent, SessionEventType, PauseInterval, TimeRange } from '@white-box/core/types'
import {
  activeSegment,
  declaredExclusions,
  focusMs,
  formatClock,
  formatDuration,
  isPaused,
  MINUTE,
  totalRangeMs,
} from '@white-box/core/engine'

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${rand}`
}

function clone(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session
}

function pushEvent(
  session: Session,
  at: number,
  type: SessionEventType,
  label: string,
  ref?: SessionEvent['ref'],
): void {
  session.events.push(ref ? { at, type, label, ref } : { at, type, label })
}

export function createSession(opts: {
  taskId: ID
  taskTitle: string
  plannedMs: number
  now: number
}): Session {
  const { taskId, taskTitle, plannedMs, now } = opts
  const session: Session = {
    id: newId('ses'),
    startedAt: now,
    endedAt: null,
    plannedMs,
    state: 'running',
    segments: [{ id: newId('seg'), taskId, startedAt: now, endedAt: null }],
    pauses: [],
    events: [],
    progressChanges: [],
    note: '',
    expiredNotifiedAt: null,
    editedAt: null,
    createdAt: now,
  }
  pushEvent(session, now, 'session_started', `セッション開始（${Math.round(plannedMs / MINUTE)}分）`)
  pushEvent(session, now, 'task_started', taskTitle, { taskId })
  return session
}

export function pauseSession(session: Session, now: number, reason: PauseInterval['reason'] = 'manual'): Session {
  if (session.endedAt || isPaused(session)) return session
  const next = clone(session)
  next.pauses.push({ startedAt: now, endedAt: null, reason })
  next.state = 'paused'
  const label = reason === 'manual' ? '一時停止' : reason === 'suspend' ? '一時停止（スリープ）' : '一時停止（ロック）'
  pushEvent(next, now, 'paused', label)
  return next
}

export function startBreak(session: Session, minutes: number, now: number): Session {
  if (session.endedAt || isPaused(session) || !Number.isFinite(minutes) || minutes <= 0) return session
  const next = clone(session)
  next.pauses.push({
    startedAt: now,
    endedAt: null,
    reason: 'break',
    plannedEndAt: now + minutes * MINUTE,
    notifiedAt: null,
  })
  next.state = 'paused'
  pushEvent(next, now, 'paused', `休憩（${minutes}分）`)
  return next
}

export function markBreakExpired(session: Session, now: number): Session {
  if (session.endedAt) return session
  const currentBreak = session.pauses.find(
    (pause) => pause.endedAt === null && pause.reason === 'break' && pause.plannedEndAt !== undefined,
  )
  if (!currentBreak || currentBreak.notifiedAt != null || now < currentBreak.plannedEndAt!) return session
  const next = clone(session)
  const nextBreak = next.pauses.find(
    (pause) => pause.endedAt === null && pause.reason === 'break' && pause.plannedEndAt !== undefined,
  )
  if (nextBreak) nextBreak.notifiedAt = now
  return next
}

export function resumeSession(session: Session, now: number): Session {
  if (session.endedAt || !isPaused(session)) return session
  const next = clone(session)
  for (const p of next.pauses) {
    if (p.endedAt === null) p.endedAt = now
  }
  next.state = 'running'
  pushEvent(next, now, 'resumed', '再開')
  return next
}

export function switchTask(session: Session, taskId: ID, taskTitle: string, now: number): Session {
  if (session.endedAt) return session
  const current = activeSegment(session)
  if (current && current.taskId === taskId) return session
  const next = clone(session)
  const open = activeSegment(next)
  if (open) open.endedAt = now
  next.segments.push({ id: newId('seg'), taskId, startedAt: now, endedAt: null })
  pushEvent(next, now, open ? 'task_switched' : 'task_started', taskTitle, { taskId })
  return next
}

export function extendSession(session: Session, minutes: number, now: number): Session {
  if (session.endedAt) return session
  const next = clone(session)
  next.plannedMs += minutes * MINUTE
  next.expiredNotifiedAt = null
  pushEvent(next, now, 'extended', `延長 +${minutes}分`, { minutes })
  return next
}

export function markExpired(session: Session, now: number): Session {
  if (session.endedAt || session.expiredNotifiedAt !== null) return session
  const next = clone(session)
  next.expiredNotifiedAt = now
  pushEvent(next, now, 'timer_expired', '予定時間に到達')
  return next
}

export function endSession(session: Session, now: number): Session {
  if (session.endedAt) return session
  const next = clone(session)
  for (const p of next.pauses) {
    if (p.endedAt === null) p.endedAt = now
  }
  const open = activeSegment(next)
  if (open) open.endedAt = now
  next.endedAt = now
  next.state = 'ended'
  pushEvent(next, now, 'session_ended', `セッション終了（実作業 ${Math.round(focusMs(next, now) / MINUTE)}分）`)
  return next
}

export function noteTaskCreated(session: Session, taskTitle: string, taskId: ID, now: number): Session {
  if (session.endedAt) return session
  const next = clone(session)
  pushEvent(next, now, 'task_created', `タスク追加: ${taskTitle}`, { taskId })
  return next
}

export function recordProgress(
  session: Session,
  changes: { taskId: ID; from: number; to: number; markedDone: boolean }[],
  now: number,
): Session {
  const next = clone(session)
  next.progressChanges = changes
  for (const c of changes) {
    if (c.from !== c.to || c.markedDone) {
      pushEvent(next, now, 'progress_updated', c.markedDone ? `完了 ${c.to}%` : `進捗 ${c.from}% → ${c.to}%`, {
        taskId: c.taskId,
        from: c.from,
        to: c.to,
      })
    }
  }
  return next
}

export interface SessionEdit {
  startedAt?: number
  endedAt?: number
  plannedMs?: number
  note?: string
  /** 一部だけ渡すと、渡さなかった申告分が消える（常に申告の全体を渡す）。 */
  exclusions?: TimeRange[]
  segmentTaskId?: ID
}

/** 人間が記録を手で直す。除外の申告（作業していなかった区間）もここを通る。 */
export function editSession(session: Session, edit: SessionEdit, now: number): Session {
  const next = clone(session)
  if (typeof edit.startedAt === 'number') next.startedAt = edit.startedAt
  if (typeof edit.endedAt === 'number') next.endedAt = edit.endedAt
  if (typeof edit.plannedMs === 'number') next.plannedMs = edit.plannedMs
  if (typeof edit.note === 'string') next.note = edit.note
  if (edit.segmentTaskId && next.segments[0]) {
    for (const seg of next.segments) seg.taskId = edit.segmentTaskId
  }
  if (next.endedAt !== null && next.startedAt > next.endedAt) next.endedAt = next.startedAt
  if (edit.exclusions) replaceExclusions(next, edit.exclusions)
  next.editedAt = now
  pushEvent(next, now, 'session_edited', editLabel(declaredExclusions(session), declaredExclusions(next)))
  return next
}

function replaceExclusions(session: Session, ranges: TimeRange[]): void {
  const end = session.endedAt
  if (end === null) throw new Error('終わっていないセッションには除外を申告できない')
  const observed = session.pauses.filter((p) => p.reason !== 'excluded')
  const sorted = [...ranges].sort((a, b) => a.startedAt - b.startedAt)
  let prevEnd = -Infinity
  for (const r of sorted) {
    if (r.endedAt <= r.startedAt) throw new Error('除外の終わりは始まりより後にする')
    if (r.startedAt < session.startedAt || r.endedAt > end) throw new Error('除外はセッションの開始から終了までの中で指定する')
    if (r.startedAt < prevEnd) throw new Error('除外どうしが重なっている')
    // 重なりを許すと pausedMsWithin が同じ時間を二度引き、実作業が実際より減る
    if (observed.some((p) => Math.min(p.endedAt ?? end, r.endedAt) > Math.max(p.startedAt, r.startedAt))) {
      throw new Error('その時間はすでに一時停止として記録されている')
    }
    prevEnd = r.endedAt
  }
  const declared: PauseInterval[] = sorted.map((r) => ({ startedAt: r.startedAt, endedAt: r.endedAt, reason: 'excluded' }))
  session.pauses = [...observed, ...declared].sort((a, b) => a.startedAt - b.startedAt)
}

function editLabel(before: TimeRange[], after: TimeRange[]): string {
  const same = before.length === after.length && before.every((r, i) => r.startedAt === after[i]?.startedAt && r.endedAt === after[i]?.endedAt)
  if (same) return '記録を手で修正'
  if (after.length === 0) return '記録を手で修正（除外を取り消し）'
  const spans = after.map((r) => `${formatClock(r.startedAt)}–${formatClock(r.endedAt)}`).join('・')
  return `記録を手で修正（除外 ${formatDuration(totalRangeMs(after), 'compact')}: ${spans}）`
}

/**
 * 異常終了で開いたままのセッションを、最後に記録が取れた時刻で閉じる。
 * PC が落ちていた時間を実作業として数えないための復旧経路。
 */
export function closeAtLastKnown(session: Session, lastKnownAt: number): Session {
  const at = Math.max(lastKnownAt, session.startedAt)
  const next = clone(session)
  for (const p of next.pauses) {
    if (p.endedAt === null) p.endedAt = Math.min(at, p.startedAt > at ? p.startedAt : at)
  }
  const open = activeSegment(next)
  if (open) open.endedAt = at
  next.endedAt = at
  next.state = 'ended'
  next.editedAt = Date.now()
  pushEvent(next, at, 'session_ended', 'セッション終了（アプリ終了により自動記録）')
  return next
}

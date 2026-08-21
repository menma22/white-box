/**
 * セッションの状態遷移。すべて「新しい Session を返す」純関数（テスト対象）。
 *
 * 終了済み（endedAt != null）のセッションは遷移させない — 記録を後から動かさないため。
 */
import type { ID, Session, SessionEvent, SessionEventType, PauseInterval } from '@white-box/core/types'
import { activeSegment, focusMs, isPaused, MINUTE } from '@white-box/core/engine'

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

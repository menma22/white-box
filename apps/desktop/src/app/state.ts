/**
 * Database と実行時状態から、配信する AppState / LiveTick を導く。
 * ここは electron を知らない（テストは素の Database で回せる）。
 */
import type { AppState, Database, ID, LiveTick, Session } from '@white-box/core/types'
import { activeTaskId, focusMs, isPaused, remainingMs } from '@white-box/core/engine'

export interface RuntimeState {
  pendingReview: { sessionId: ID; thenStart: boolean } | null
  recovery: { sessionId: ID; lastKnownAt: number } | null
  /** 配信のたびに増える通し番号。 */
  revision: number
}

export function newRuntime(): RuntimeState {
  return { pendingReview: null, recovery: null, revision: 0 }
}

export function liveSession(db: Database): Session | null {
  return db.sessions.find((s) => s.state !== 'ended') ?? null
}

export function replaceSession(db: Database, next: Session): void {
  const i = db.sessions.findIndex((s) => s.id === next.id)
  if (i >= 0) db.sessions[i] = next
  else db.sessions.push(next)
}

export function taskTitle(db: Database, id: ID): string {
  return db.tasks.find((t) => t.id === id)?.title ?? '（削除されたタスク）'
}

export function buildTick(db: Database, now: number): LiveTick | null {
  const s = liveSession(db)
  if (!s) return null
  return {
    sessionId: s.id,
    state: isPaused(s) ? 'paused' : 'running',
    elapsedMs: focusMs(s, now),
    remainingMs: remainingMs(s, now),
    plannedMs: s.plannedMs,
    activeTaskId: activeTaskId(s),
  }
}

export function buildState(db: Database, runtime: RuntimeState, now: number): AppState {
  return {
    revision: ++runtime.revision,
    projects: db.projects,
    tasks: db.tasks,
    sessions: db.sessions,
    settings: db.settings,
    dayNotes: db.dayNotes,
    live: buildTick(db, now),
    recovery: runtime.recovery,
    pendingReview: runtime.pendingReview,
  }
}

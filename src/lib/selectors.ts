import type { AppState, ID, Project, Session, Task, TaskStatus } from '@shared/types'
import { dayKey, focusByTaskAcross, focusMs, sessionsOfDay } from '@shared/engine'

export const STATUS_ORDER: TaskStatus[] = ['inbox', 'todo', 'doing', 'done']

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
}

export const STATUS_NOTE: Record<TaskStatus, string> = {
  inbox: 'まだやると決めていない',
  todo: 'やると決めた',
  doing: '進行中',
  done: '完了',
}

export function projectById(state: AppState, id: ID | null): Project | null {
  return id ? state.projects.find((p) => p.id === id) ?? null : null
}

export function taskById(state: AppState, id: ID | null): Task | null {
  return id ? state.tasks.find((t) => t.id === id) ?? null : null
}

export function taskTitle(state: AppState, id: ID | null): string {
  return taskById(state, id)?.title ?? '（削除されたタスク）'
}

export function childrenOf(state: AppState, id: ID): Task[] {
  return state.tasks.filter((t) => t.parentId === id).sort((a, b) => a.order - b.order)
}

/** 親が同じ列にいる場合は入れ子で描くので、列の一覧からは外す。 */
export function columnRoots(state: AppState, status: TaskStatus): Task[] {
  const inColumn = new Set(state.tasks.filter((t) => t.status === status).map((t) => t.id))
  return state.tasks
    .filter((t) => t.status === status && (t.parentId === null || !inColumn.has(t.parentId)))
    .sort((a, b) => a.order - b.order)
}

export function nestedChildren(state: AppState, task: Task): Task[] {
  return childrenOf(state, task.id).filter((c) => c.status === task.status)
}

export function ancestorTitles(state: AppState, task: Task): string[] {
  const out: string[] = []
  let cur = task.parentId ? taskById(state, task.parentId) : null
  let guard = 0
  while (cur && guard++ < 12) {
    out.unshift(cur.title)
    cur = cur.parentId ? taskById(state, cur.parentId) : null
  }
  return out
}

export function focusByTask(state: AppState, now: number): Map<ID, number> {
  return focusByTaskAcross(state.sessions, now)
}

export function lastTouchedAt(state: AppState, taskId: ID): number | null {
  let last: number | null = null
  for (const s of state.sessions) {
    for (const seg of s.segments) {
      if (seg.taskId !== taskId) continue
      const at = seg.endedAt ?? seg.startedAt
      if (last === null || at > last) last = at
    }
  }
  return last
}

export interface Stall {
  task: Task
  days: number
  since: number
}

/**
 * 「重要だと決めたのに動いていない」タスク。Inbox は決めていないので対象外。
 */
export function stalledTasks(state: AppState, now: number): Stall[] {
  const limit = state.settings.stallWarningDays
  const out: Stall[] = []
  for (const task of state.tasks) {
    if (task.priority !== 'high') continue
    if (task.status === 'inbox' || task.status === 'done') continue
    const since = lastTouchedAt(state, task.id) ?? task.createdAt
    const days = Math.floor((now - since) / 86_400_000)
    if (days >= limit) out.push({ task, days, since })
  }
  return out.sort((a, b) => b.days - a.days)
}

export function todayKey(state: AppState, now: number): string {
  return dayKey(now, state.settings.dayStartHour)
}

export function sessionsForDay(state: AppState, key: string): Session[] {
  return sessionsOfDay(state.sessions, key, state.settings.dayStartHour)
}

export function dayKeysWithSessions(state: AppState): string[] {
  const keys = new Set(state.sessions.map((s) => dayKey(s.startedAt, state.settings.dayStartHour)))
  return [...keys].sort().reverse()
}

export function dayTotalMs(state: AppState, key: string, now: number): number {
  return sessionsForDay(state, key).reduce((sum, s) => sum + focusMs(s, now), 0)
}

export function projectColor(project: Project | null): string {
  if (!project) return 'var(--text-3)'
  return `hsl(${project.hue} 52% 58%)`
}

export function projectTint(project: Project | null, alpha = 0.16): string {
  if (!project) return 'rgba(140,148,158,0.12)'
  return `hsl(${project.hue} 52% 58% / ${alpha})`
}

/** Start UI と切替 UI で共通の並び。今やる可能性が高い順。 */
export function candidateTasks(state: AppState): Task[] {
  const weight: Record<TaskStatus, number> = { doing: 0, todo: 1, inbox: 2, done: 9 }
  const prio: Record<Task['priority'], number> = { high: 0, normal: 1, low: 2 }
  return state.tasks
    .filter((t) => t.status !== 'done')
    .sort(
      (a, b) =>
        weight[a.status] - weight[b.status] || prio[a.priority] - prio[b.priority] || a.order - b.order,
    )
}

export function matchTask(state: AppState, task: Task, query: string): boolean {
  if (!query.trim()) return true
  const q = query.trim().toLowerCase()
  const project = projectById(state, task.projectId)?.name ?? ''
  return `${task.title} ${project}`.toLowerCase().includes(q)
}

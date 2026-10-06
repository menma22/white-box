import type { Session, Task } from './types.js'
import { MINUTE, segmentRange, unpausedRanges } from './engine.js'
import { validGoalDue } from './goal-map.js'

const DAY = 86_400_000
export const DEFAULT_STALL_WARNING_DAYS = 3
export type RiskLevel = 'normal' | 'warning' | 'high-risk' | 'overdue'
export const RISK_LABEL: Record<RiskLevel, string> = {
  normal: 'Normal', warning: 'Warning', 'high-risk': 'High Risk', overdue: 'Overdue',
}

export interface TaskControl {
  task: Task
  deadlineEnd: number | null
  slackMs: number | null
  agingSince: number | null
  agingDays: number | null
  risk: RiskLevel
  reasons: ('deadline-passed' | 'negative-slack' | 'aging')[]
  recommendationScore: number
}

export function stallWarningDays(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_STALL_WARNING_DAYS
}

export function validateTaskPlanning(task: Pick<Task, 'remainingEffortMinutes' | 'safetyBufferMinutes' | 'committedAt' | 'lastProgressAt'>): void {
  for (const key of ['remainingEffortMinutes', 'safetyBufferMinutes', 'committedAt', 'lastProgressAt'] as const) {
    const value = task[key]
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
      throw new Error(`${key} は非負の有限の数値で指定してください`)
    }
  }
}

/** 日付の締切はローカルの翌日 0:00。作業日の境界や夏時間を固定 24 時間で代用しない。 */
export function deadlineEnd(due: Task['due']): number | null {
  if (!due) return null
  try { validGoalDue(due) } catch { return null }
  const date = new Date(`${due}T00:00:00`)
  date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** 停止・除外・タイマー満了を含めず、実際に作業した区間の最後を返す。 */
export function lastTaskWorkAt(task: Task, sessions: Session[], now: number): number | null {
  let last: number | null = null
  for (const session of sessions) {
    for (const segment of session.segments) {
      if (segment.taskId !== task.id) continue
      const range = segmentRange(session, segment, now)
      const start = Math.max(range.startedAt, task.committedAt ?? 0)
      const end = Math.min(range.endedAt, now)
      const runs = unpausedRanges(session.pauses, start, end, now)
      const at = runs[runs.length - 1]?.endedAt
      if (at !== undefined && (last === null || at > last)) last = at
    }
  }
  return last
}

export function taskControl(task: Task, sessions: Session[], now: number, warningDays: number): TaskControl {
  const limit = stallWarningDays(warningDays)
  const end = deadlineEnd(task.due)
  const effort = task.remainingEffortMinutes
  const buffer = task.safetyBufferMinutes
  const slackMs = end !== null && effort != null && buffer != null && Number.isFinite(effort) && effort >= 0 && Number.isFinite(buffer) && buffer >= 0
    ? end - now - (effort + buffer) * MINUTE : null
  const active = task.status !== 'inbox' && task.status !== 'done'
  const anchors = [task.committedAt, task.lastProgressAt, lastTaskWorkAt(task, sessions, now)]
    .filter((at): at is number => at != null && Number.isFinite(at) && at >= 0)
  const agingSince = task.status === 'todo' && anchors.length ? Math.max(...anchors) : null
  const agingDays = agingSince === null ? null : Math.max(0, now - agingSince) / DAY
  const reasons: TaskControl['reasons'] = []
  let risk: RiskLevel = 'normal'
  if (active) {
    if (agingDays !== null && agingDays >= limit) { reasons.push('aging'); risk = agingDays >= 2 * limit ? 'high-risk' : 'warning' }
    if (slackMs !== null && slackMs < 0) { reasons.push('negative-slack'); risk = 'high-risk' }
    if (end !== null && now >= end) { reasons.push('deadline-passed'); risk = 'overdue' }
  }
  const riskWeight: Record<RiskLevel, number> = { normal: 0, warning: 1, 'high-risk': 2, overdue: 3 }
  const priorityWeight = { low: 0, normal: 1, high: 2 }
  return { task, deadlineEnd: end, slackMs, agingSince, agingDays, risk, reasons,
    recommendationScore: priorityWeight[task.priority] + (agingDays ?? 0) / limit + riskWeight[risk] }
}

export function taskWarnings(tasks: Task[], sessions: Session[], now: number, warningDays: number): TaskControl[] {
  const severity: Record<RiskLevel, number> = { normal: 0, warning: 1, 'high-risk': 2, overdue: 3 }
  return tasks.map((task) => taskControl(task, sessions, now, warningDays))
    .filter((control) => control.risk !== 'normal')
    .sort((a, b) => severity[b.risk] - severity[a.risk] || b.recommendationScore - a.recommendationScore || a.task.order - b.task.order)
}

export function recommendTasks(tasks: Task[], sessions: Session[], now: number, warningDays: number): Task[] {
  const statusWeight = { doing: 0, todo: 1, inbox: 2, done: 3 }
  return tasks.filter((task) => task.status !== 'done')
    .map((task) => taskControl(task, sessions, now, warningDays))
    .sort((a, b) => statusWeight[a.task.status] - statusWeight[b.task.status] || b.recommendationScore - a.recommendationScore || a.task.order - b.task.order)
    .map((control) => control.task)
}

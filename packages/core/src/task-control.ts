import type { ExternalBlock, ID, Project, Task } from './types.js'

export type TaskControl = Pick<Task, 'blocked' | 'blockReason' | 'hardDependencies' | 'recommendedPredecessors' | 'externalBlock'>
export type TaskContext = { tasks: Task[]; projects: Project[] }

export function validControlDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function normalizeTaskControl(task: Task): Task {
  return { ...task, blocked: task.blocked ?? false, blockReason: task.blockReason ?? '', hardDependencies: task.hardDependencies ?? [], recommendedPredecessors: task.recommendedPredecessors ?? [], externalBlock: task.externalBlock ?? null }
}

export function unfinishedPredecessors(context: TaskContext, task: Task, kind: 'hard' | 'recommended' = 'hard'): { id: ID; task: Task | null }[] {
  const ids = (kind === 'hard' ? task.hardDependencies : task.recommendedPredecessors) ?? []
  return ids.map((id) => ({ id, task: context.tasks.find((item) => item.id === id) ?? null })).filter((item) => item.task?.status !== 'done')
}

function taskBlockingIssues(context: TaskContext, task: Task): { key: string; reason: string }[] {
  const issues: { key: string; reason: string }[] = []
  if (task.blocked) issues.push({ key: 'blocked', reason: task.blockReason?.trim() || 'Blocked' })
  if (task.externalBlock) issues.push({ key: 'external', reason: `${task.externalBlock.who} · ${task.externalBlock.what} 待ち` })
  for (const predecessor of unfinishedPredecessors(context, task)) issues.push({ key: `dependency:${predecessor.id}`, reason: predecessor.task ? `先行タスク「${predecessor.task.title}」の完了待ち` : `削除された先行タスク (${predecessor.id}) のリンク解除が必要` })
  return issues
}

export function taskBlockReasons(context: TaskContext, task: Task): string[] {
  return taskBlockingIssues(context, task).map((issue) => issue.reason)
}

export function taskExecutionBlockers(context: TaskContext, id: ID | null): { key: string; reason: string }[] {
  const task = context.tasks.find((item) => item.id === id)
  if (!task) return [{ key: 'missing', reason: 'タスクが見つからない' }]
  const issues = taskBlockingIssues(context, task)
  if (task.status === 'done') issues.unshift({ key: 'done', reason: '完了済みのタスクは Todo に戻してから開始する' })
  if (task.projectId && !context.projects.some((project) => project.id === task.projectId)) issues.unshift({ key: `project-missing:${task.projectId}`, reason: 'プロジェクトが見つからない' })
  if (context.projects.some((project) => project.id === task.projectId && project.archived)) issues.unshift({ key: `archived:${task.projectId}`, reason: 'アーカイブされたプロジェクトは復元してから開始する' })
  return issues
}

export function taskExecutionProblem(context: TaskContext, id: ID | null): string | null {
  return taskExecutionBlockers(context, id).map((issue) => issue.reason).join(' / ') || null
}

export function assertTaskExecutable(context: TaskContext, id: ID | null): void {
  const problem = taskExecutionProblem(context, id)
  if (problem) throw new Error(problem)
}

export function followUpDue(block: ExternalBlock, today: string): boolean {
  return block.nextFollowUpOn !== null && block.nextFollowUpOn <= today
}

export function validateTaskLinks(tasks: Task[], task: Task, previous?: Task): void {
  const links = [...(task.hardDependencies ?? []), ...(task.recommendedPredecessors ?? [])]
  if (new Set(links).size !== links.length) throw new Error('同じタスクを重複してリンクできない')
  const retained = new Set([...(previous?.hardDependencies ?? []), ...(previous?.recommendedPredecessors ?? [])])
  for (const id of links) {
    if (id === task.id) throw new Error('自分自身を先行タスクにできない')
    if (!tasks.some((item) => item.id === id) && !retained.has(id)) throw new Error('先行タスクが見つからない')
  }
  validateTaskGraph(tasks)
}

export function validateTaskGraph(tasks: Task[]): void {
  for (const task of tasks) {
    const links = [...(task.hardDependencies ?? []), ...(task.recommendedPredecessors ?? [])]
    if (new Set(links).size !== links.length) throw new Error('同じタスクを重複してリンクできない')
    if (links.includes(task.id)) throw new Error('自分自身を先行タスクにできない')
  }
  const byId = new Map(tasks.map((item) => [item.id, item]))
  const visiting = new Set<ID>()
  const visited = new Set<ID>()
  function walk(id: ID): void {
    if (visiting.has(id)) throw new Error('先行タスクのリンクが循環している')
    if (visited.has(id)) return
    visiting.add(id)
    const item = byId.get(id)
    for (const predecessor of [...(item?.hardDependencies ?? []), ...(item?.recommendedPredecessors ?? [])]) walk(predecessor)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of byId.keys()) walk(id)
}

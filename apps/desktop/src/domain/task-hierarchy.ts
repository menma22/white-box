import type { Task } from '@white-box/core/types'

export function validateTaskHierarchy(tasks: Task[]): void {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const complete = new Set<string>()
  for (const task of tasks) {
    const visiting = new Set<string>()
    let id: string | null = task.id
    while (id !== null && byId.has(id) && !complete.has(id)) {
      if (visiting.has(id)) throw new Error('タスクの親子関係が循環しています')
      visiting.add(id)
      id = byId.get(id)!.parentId
    }
    for (const visited of visiting) complete.add(visited)
  }
}

export function validateTaskParent(tasks: Task[], task: Task, previous?: Task): void {
  if (task.parentId !== null && task.parentId !== previous?.parentId && !tasks.some((item) => item.id === task.parentId)) {
    throw new Error('親タスクが見つからない')
  }
  validateTaskHierarchy(tasks)
}

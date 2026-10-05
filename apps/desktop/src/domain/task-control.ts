import { activeTaskId } from '@white-box/core/engine'
import { taskExecutionBlockers } from '@white-box/core/task-control'
import type { Database } from '@white-box/core/types'

export function assertLiveWorkPreserved(before: Database, next: Database): void {
  for (const session of next.sessions.filter((item) => item.endedAt === null)) {
    const id = activeTaskId(session)
    const task = next.tasks.find((item) => item.id === id)
    const prior = before.tasks.find((item) => item.id === id)
    const blockers = taskExecutionBlockers(next, id)
    const priorBlockers = new Set(taskExecutionBlockers(before, id).map((item) => item.key))
    const introducesBlocker = blockers.some((item) => !priorBlockers.has(item.key))
    const changesActiveStatus = prior && task && task.status !== prior.status && task.status !== 'doing'
    if (introducesBlocker || !task || changesActiveStatus) {
      throw new Error('セッションを終了してから、現在のタスクや先行タスクの待ち状態を変更する')
    }
  }
}

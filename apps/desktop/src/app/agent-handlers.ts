import type { ArgsOf, ResultOf } from '@white-box/contracts'
import { focusMs } from '@white-box/core/engine'
import type { Task } from '@white-box/core/types'
import * as taskOps from '../domain/task-ops.js'
import type { Ctx } from './ports.js'

export function createAgentHandlers(ctx: Ctx) {
  const db = () => ctx.store.data
  return {
    'agent:config': (): string => ctx.system.agentConfig?.() ?? '',
    'agent:context': (args: ArgsOf<'agent:context'>): ResultOf<'agent:context'> => {
      const tasks = db().tasks.filter((task) => !args.projectId || task.projectId === args.projectId)
      const taskIds = new Set(tasks.map((task) => task.id))
      const goalIds = new Set(tasks.map((task) => task.goalNodeId).filter(Boolean))
      return {
        projects: db().projects.filter((project) => !args.projectId || project.id === args.projectId),
        tasks,
        goals: Object.values(db().goalMap.nodes).filter((goal) => !args.projectId || goalIds.has(goal.id)),
        sessions: db().sessions.filter((session) => !args.projectId || session.segments.some((segment) => taskIds.has(segment.taskId))).slice(-100).map((session) => ({
          id: session.id, startedAt: session.startedAt, endedAt: session.endedAt,
          taskIds: [...new Set(session.segments.map((segment) => segment.taskId))], focusMs: focusMs(session, ctx.now()),
        })),
      }
    },
    'agent:applyPlan': (args: ArgsOf<'agent:applyPlan'>): ResultOf<'agent:applyPlan'> => {
      const fingerprint = JSON.stringify(args.tasks)
      const requests = db().agentRequests ?? {}
      const previous = Object.hasOwn(requests, args.requestId) ? requests[args.requestId] : undefined
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('同じrequestIdで異なるタスク案が送信されました')
        return previous.taskIds.map((id) => {
          const task = db().tasks.find((item) => item.id === id)
          if (!task) throw new Error('登録済みのタスクは削除されています。新しいrequestIdで依頼してください')
          return task
        })
      }
      let staged = db()
      const created: Task[] = []
      for (const [index, entry] of args.tasks.entries()) {
        if (entry.parentIndex !== undefined && entry.parentIndex >= index) throw new Error('親タスクは子より前に置いてください')
        const parentId = entry.parentIndex === undefined ? entry.parentId : created[entry.parentIndex]!.id
        const parent = parentId == null ? undefined : staged.tasks.find((task) => task.id === parentId)
        if (parentId != null && !parent) throw new Error('親タスクが見つかりません')
        const projectId = entry.projectId === undefined ? parent?.projectId ?? null : entry.projectId
        if (projectId != null && !staged.projects.some((project) => project.id === projectId)) throw new Error('プロジェクトが見つかりません')
        const result = taskOps.createTask(staged, { ...entry, parentId, projectId, status: 'inbox' })
        created.push(result.task)
        staged = { ...staged, tasks: result.tasks }
      }
      db().tasks = staged.tasks
      db().agentRequests = { ...requests, [args.requestId]: { fingerprint, taskIds: created.map((task) => task.id) } }
      ctx.publish()
      return created
    },
  }
}

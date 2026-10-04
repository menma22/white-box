import type { ArgsOf, ResultOf } from '@white-box/contracts'
import { focusMs } from '@white-box/core/engine'
import type { Task } from '@white-box/core/types'
import type { TaskSuggestion } from '@white-box/core/agent'
import * as taskOps from '../domain/task-ops.js'
import * as sessionOps from '../domain/session-ops.js'
import type { Ctx } from './ports.js'
import { replaceSession } from './state.js'

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
    'agent:propose': (args: ArgsOf<'agent:propose'>): ResultOf<'agent:propose'> => {
      const session = db().sessions.find((item) => item.id === args.sessionId)
      if (!session || session.state !== 'ended') throw new Error('終了したセッションを指定してください')
      const task = args.taskId ? db().tasks.find((item) => item.id === args.taskId) : null
      if (args.taskId && !task) throw new Error('タスクが見つかりません')
      if (!task && !args.title) throw new Error('未知の作業はタスク名を提案してください')
      const pending = (db().taskSuggestions ?? []).find((item) => item.sessionId === session.id && item.status === 'pending')
      if (pending) return pending
      const suggestion: TaskSuggestion = {
        id: sessionOps.newId('sug'), sessionId: session.id, taskId: task?.id ?? null,
        title: task?.title ?? args.title!, reason: args.reason, markDone: args.markDone ?? false,
        status: 'pending', createdAt: ctx.now(), resolvedAt: null,
      }
      db().taskSuggestions = [...(db().taskSuggestions ?? []), suggestion]
      ctx.publish()
      return suggestion
    },
    'agent:resolve': (args: ArgsOf<'agent:resolve'>): null => {
      const suggestion = (db().taskSuggestions ?? []).find((item) => item.id === args.id)
      if (!suggestion || suggestion.status !== 'pending') return null
      if (args.accept) {
        const session = db().sessions.find((item) => item.id === suggestion.sessionId)
        if (!session || session.state !== 'ended') throw new Error('対象セッションを確認できません')
        if (session.segments.length > 1) throw new Error('タスク切替を含む記録は、記録画面で区間を確認して割り当ててください')
        const created = suggestion.taskId === null ? taskOps.createTask(db(), { title: suggestion.title, status: 'todo' }) : null
        const taskId = suggestion.taskId ?? created!.task.id
        const staged = { ...db(), tasks: created?.tasks ?? db().tasks }
        if (!staged.tasks.some((task) => task.id === taskId)) throw new Error('提案されたタスクが見つかりません')
        const updated = sessionOps.editSession(session, { segmentTaskId: taskId }, ctx.now())
        const tasks = suggestion.markDone ? taskOps.updateTask(staged, taskId, { status: 'done' }) : staged.tasks
        db().tasks = tasks
        replaceSession(db(), updated)
      }
      db().taskSuggestions = (db().taskSuggestions ?? []).map((item) => item.id === suggestion.id ? { ...item, status: args.accept ? 'accepted' : 'dismissed', resolvedAt: ctx.now() } : item)
      ctx.publish()
      return null
    },
  }
}

/**
 * ユースケース層。コマンド 1 つ = 関数 1 つ。外の世界には Ctx の Port 経由でしか触らない。
 * electron を import しないこと（ここが破れると Electron 起動なしのテストができなくなる）。
 */
import type { ArgsOf, CommandName, ResultOf } from '@white-box/contracts'
import { dayKey, isPaused, MINUTE, activeTaskId } from '@white-box/core/engine'
import * as ops from '../domain/session-ops.js'
import * as taskOps from '../domain/task-ops.js'
import type { Ctx } from './ports.js'
import { buildState, liveSession, replaceSession, taskTitle } from './state.js'

export type Handlers = {
  [N in CommandName]: (args: ArgsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>
}

export function createHandlers(ctx: Ctx): Handlers {
  const db = () => ctx.store.data

  const handlers: Handlers = {
    'state:get': () => buildState(db(), ctx.runtime, ctx.now()),

    // ── Project
    'project:create': (a) => {
      const r = taskOps.createProject(db(), { name: a.name })
      db().projects = r.projects
      ctx.publish()
      return r.project
    },
    'project:update': (a) => {
      db().projects = taskOps.updateProject(db(), a.id, a.patch)
      ctx.publish()
      return null
    },
    'project:delete': (a) => {
      const r = taskOps.deleteProject(db(), a.id)
      db().projects = r.projects
      db().tasks = r.tasks
      ctx.publish()
      return null
    },

    // ── Task
    'task:create': (a) => {
      const r = taskOps.createTask(db(), a)
      db().tasks = r.tasks
      const s = liveSession(db())
      if (s && a.fromSession) replaceSession(db(), ops.noteTaskCreated(s, r.task.title, r.task.id, ctx.now()))
      ctx.publish()
      return r.task
    },
    'task:update': (a) => {
      db().tasks = taskOps.updateTask(db(), a.id, a.patch)
      ctx.publish()
      return null
    },
    'task:move': (a) => {
      db().tasks = taskOps.moveTask(db(), a.id, a.status, a.index)
      ctx.publish()
      return null
    },
    'task:delete': (a) => {
      db().tasks = taskOps.deleteTask(db(), a.id)
      ctx.publish()
      return null
    },
    'task:hasTime': (a) => taskOps.hasRecordedTime(db(), a.id),

    // ── Session
    'session:start': (a) => {
      if (liveSession(db())) return null
      const now = ctx.now()
      let taskId = a.taskId
      if (!taskId && a.newTask) {
        const r = taskOps.createTask(db(), {
          title: a.newTask.title,
          projectId: a.newTask.projectId ?? null,
          status: 'doing',
        })
        db().tasks = r.tasks
        taskId = r.task.id
      }
      if (!taskId) return null
      const minutes = a.minutes || db().settings.defaultSessionMinutes
      const session = ops.createSession({ taskId, taskTitle: taskTitle(db(), taskId), plannedMs: minutes * MINUTE, now })
      db().sessions.push(session)
      db().tasks = taskOps.updateTask(db(), taskId, { status: 'doing' })
      ctx.publish()
      ctx.windows.open('hud', false)
      ctx.ticker.start()
      ctx.windows.closeLater('start')
      return session
    },
    'session:pause': (a) => {
      const s = liveSession(db())
      if (!s) return null
      replaceSession(db(), ops.pauseSession(s, ctx.now(), a.reason ?? 'manual'))
      ctx.publish()
      ctx.windows.open('hud', false)
      return null
    },
    'session:resume': () => {
      const s = liveSession(db())
      if (!s) return null
      replaceSession(db(), ops.resumeSession(s, ctx.now()))
      ctx.publish()
      return null
    },
    'session:toggle': async () => {
      const s = liveSession(db())
      if (!s) {
        ctx.windows.open('start')
        return null
      }
      return await handlers[isPaused(s) ? 'session:resume' : 'session:pause']({})
    },
    'session:extend': (a) => {
      const s = liveSession(db())
      if (!s) return null
      const minutes = a.minutes || db().settings.defaultExtendMinutes
      replaceSession(db(), ops.extendSession(s, minutes, ctx.now()))
      ctx.publish()
      ctx.windows.closeLater('expire')
      return null
    },
    'session:switchTask': (a) => {
      const s = liveSession(db())
      if (!s) return null
      const now = ctx.now()
      const prev = activeTaskId(s)
      replaceSession(db(), ops.switchTask(s, a.taskId, taskTitle(db(), a.taskId), now))
      db().tasks = taskOps.updateTask(db(), a.taskId, { status: 'doing' })
      if (prev && prev !== a.taskId) {
        const prevTask = db().tasks.find((t) => t.id === prev)
        if (prevTask && prevTask.status === 'doing') db().tasks = taskOps.updateTask(db(), prev, { status: 'todo' })
      }
      ctx.publish()
      return null
    },
    'session:end': (a) => {
      const s = liveSession(db())
      if (!s) return null
      const ended = ops.endSession(s, ctx.now())
      replaceSession(db(), ended)
      ctx.ticker.stop()
      ctx.runtime.pendingReview = { sessionId: ended.id, thenStart: Boolean(a.thenStart) }
      ctx.publish()
      ctx.windows.open('review')
      ctx.windows.closeLater('expire', 'hud')
      return null
    },
    'session:review': (a) => {
      const s = db().sessions.find((x) => x.id === a.sessionId)
      if (!s) return null
      const updated = ops.recordProgress(s, a.changes, ctx.now())
      updated.note = a.note ?? ''
      replaceSession(db(), updated)
      for (const c of a.changes) {
        db().tasks = taskOps.updateTask(db(), c.taskId, {
          progress: c.to,
          ...(c.markedDone ? { status: 'done' as const } : {}),
        })
      }
      const thenStart = ctx.runtime.pendingReview?.thenStart ?? false
      ctx.runtime.pendingReview = null
      ctx.publish()
      if (thenStart) ctx.windows.open('start')
      ctx.windows.closeLater('review')
      return null
    },
    'session:skipReview': () => {
      ctx.runtime.pendingReview = null
      ctx.publish()
      ctx.windows.closeLater('review')
      return null
    },
    'session:update': (a) => {
      const s = db().sessions.find((x) => x.id === a.id)
      if (!s) return null
      if (typeof a.patch.startedAt === 'number') s.startedAt = a.patch.startedAt
      if (typeof a.patch.endedAt === 'number') s.endedAt = a.patch.endedAt
      if (typeof a.patch.plannedMs === 'number') s.plannedMs = a.patch.plannedMs
      if (typeof a.patch.note === 'string') s.note = a.patch.note
      if (a.segmentTaskId && s.segments[0]) {
        for (const seg of s.segments) seg.taskId = a.segmentTaskId
      }
      if (s.endedAt !== null && s.startedAt > s.endedAt) s.endedAt = s.startedAt
      const now = ctx.now()
      s.editedAt = now
      s.events.push({ at: now, type: 'session_edited', label: '記録を手で修正' })
      ctx.publish()
      return null
    },
    'session:delete': (a) => {
      db().sessions = db().sessions.filter((s) => s.id !== a.id)
      ctx.publish()
      return null
    },

    // ── 復旧
    'recovery:close': () => {
      const s = db().sessions.find((x) => x.id === ctx.runtime.recovery?.sessionId)
      if (s && ctx.runtime.recovery) {
        replaceSession(db(), ops.closeAtLastKnown(s, ctx.runtime.recovery.lastKnownAt))
        ctx.runtime.pendingReview = { sessionId: s.id, thenStart: false }
      }
      ctx.runtime.recovery = null
      ctx.publish()
      ctx.windows.open('review')
      return null
    },
    'recovery:resume': () => {
      const s = db().sessions.find((x) => x.id === ctx.runtime.recovery?.sessionId)
      if (s) replaceSession(db(), ops.resumeSession(s, ctx.now()))
      ctx.runtime.recovery = null
      ctx.publish()
      ctx.ticker.start()
      return null
    },

    // ── ウィンドウ / 設定 / データ
    'window:open': (a) => {
      ctx.windows.open(a.kind)
      return null
    },
    'window:close': (a) => {
      ctx.windows.close(a.kind)
      return null
    },
    'window:toggle': (a) => {
      ctx.windows.toggle(a.kind)
      return null
    },
    'window:minimize': () => {
      ctx.windows.minimizeFocused()
      return null
    },

    'settings:update': (a) => {
      Object.assign(db().settings, a.patch)
      ctx.system.applyShortcuts()
      ctx.system.applyLoginItem()
      ctx.publish()
      return null
    },
    'day:note': (a) => {
      db().dayNotes[a.key] = a.text
      ctx.publish()
      return null
    },
    'welcome:dismiss': () => {
      db().settings.lastWelcomeDate = dayKey(ctx.now(), db().settings.dayStartHour)
      ctx.publish()
      return null
    },

    'data:export': () => ctx.dataIO.exportData(),
    'data:import': async () => {
      const p = await ctx.dataIO.importData()
      if (p) ctx.publish()
      return p
    },
    'data:reveal': () => {
      ctx.dataIO.revealDataDir()
      return null
    },

    'app:quit': () => {
      ctx.system.quit()
      return null
    },
  }
  return handlers
}

export async function dispatch<N extends CommandName>(handlers: Handlers, name: N, args: ArgsOf<N>): Promise<ResultOf<N>> {
  // handlers[name] はコマンド名ごとの関数の合併型になり、そのままでは呼べないので 1 箇所だけ絞り込む
  const handler = handlers[name] as (a: ArgsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>
  return await handler(args)
}

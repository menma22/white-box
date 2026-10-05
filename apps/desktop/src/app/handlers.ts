/**
 * ユースケース層。コマンド 1 つ = 関数 1 つ。外の世界には Ctx の Port 経由でしか触らない。
 * electron を import しないこと（ここが破れると Electron 起動なしのテストができなくなる）。
 */
import type { ArgsOf, CommandName, ResultOf } from '@white-box/contracts'
import { dayKey, isPaused, MINUTE, activeTaskId } from '@white-box/core/engine'
import type { WindowKind } from '@white-box/core/types'
import { assertTaskExecutable } from '@white-box/core/task-control'
import { restoreOpenSession } from './lifecycle.js'
import * as ops from '../domain/session-ops.js'
import * as taskOps from '../domain/task-ops.js'
import * as goalOps from '../domain/goal-ops.js'
import type { Ctx } from './ports.js'
import { createPresenceHandlers } from './presence-handlers.js'
import { buildState, liveSession, replaceSession, taskTitle } from './state.js'
import { checkExpire } from './lifecycle.js'
import { commitChanges } from './commit.js'
import { createAgentHandlers } from './agent-handlers.js'
import { createNoteHandlers } from './note-handlers.js'
import { createPlanningHandlers } from './planning-handlers.js'

export type Handlers = {
  [N in CommandName]: (args: ArgsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>
}

export function createHandlers(ctx: Ctx): Handlers {
  const db = () => ctx.store.data
  const currentSession = () => {
    checkExpire(ctx)
    return liveSession(db())
  }

  const handlers: Handlers = {
    ...createPresenceHandlers(ctx),
    ...createAgentHandlers(ctx),
    ...createNoteHandlers(ctx),
    ...createPlanningHandlers(ctx),
    'state:get': () => buildState(db(), ctx.runtime, ctx.now()),

    // ── Project
    'project:create': (a) => {
      const r = taskOps.createProject(db(), { name: a.name }, ctx.now())
      commitChanges(ctx, { projects: r.projects })
      return r.project
    },
    'project:update': (a) => {
      commitChanges(ctx, { projects: taskOps.updateProject(db(), a.id, a.patch, ctx.now()) })
      return null
    },
    'project:delete': (a) => {
      const r = taskOps.deleteProject(db(), a.id)
      commitChanges(ctx, r)
      return null
    },

    // ── Task
    'task:create': (a) => {
      const now = ctx.now()
      const r = taskOps.createTask(db(), a, now)
      const s = liveSession(db())
      const sessions = s && a.fromSession ? db().sessions.map((session) => session.id === s.id ? ops.noteTaskCreated(s, r.task.title, r.task.id, now) : session) : db().sessions
      commitChanges(ctx, { tasks: r.tasks, sessions })
      return r.task
    },
    'task:update': (a) => {
      commitChanges(ctx, { tasks: taskOps.updateTask(db(), a.id, a.patch, ctx.now()) })
      return null
    },
    'task:move': (a) => {
      commitChanges(ctx, { tasks: taskOps.moveTask(db(), a.id, a.status, a.index, ctx.now()) })
      return null
    },
    'task:delete': (a) => {
      commitChanges(ctx, { tasks: taskOps.deleteTask(db(), a.id) })
      return null
    },
    'task:hasTime': (a) => taskOps.hasRecordedTime(db(), a.id),

    // ── 道標
    'goal:create': (a) => {
      const r = goalOps.createGoal(db(), a)
      commitChanges(ctx, { goalMap: r.goalMap })
      return r.goal
    },
    'goal:update': (a) => {
      commitChanges(ctx, { goalMap: goalOps.updateGoal(db(), a.id, a.patch) })
      return null
    },
    'goal:merge': (a) => {
      const r = goalOps.mergeGoals(db(), a)
      db().goalMap = r.goalMap
      ctx.publish()
      return r.goal
    },
    'goal:hide': (a) => {
      db().goalMap = goalOps.hideGoal(db(), a.id, a.reason ?? '')
      ctx.publish()
      return null
    },
    'goal:restore': (a) => {
      db().goalMap = goalOps.restoreGoal(db(), a.id)
      ctx.publish()
      return null
    },
    'goal:ui': (a) => {
      db().goalMap = goalOps.updateGoalUi(db(), a)
      ctx.publish()
      return null
    },
    'goal:import': (a) => {
      const r = goalOps.importGoals(db(), a.data)
      commitChanges(ctx, { goalMap: r.goalMap, tasks: r.tasks, goalMapImports: r.goalMapImports })
      return r.counts
    },
    'issue:create': (a) => {
      const r = goalOps.createIssue(db(), a)
      db().goalMap = r.goalMap
      ctx.publish()
      return r.issue
    },
    'issue:update': (a) => {
      db().goalMap = goalOps.updateIssue(db(), a.id, a.patch)
      ctx.publish()
      return null
    },
    'issue:delete': (a) => {
      db().goalMap = goalOps.deleteIssue(db(), a.id)
      ctx.publish()
      return null
    },

    // ── Session
    'session:start': (a) => {
      if (liveSession(db())) return null
      const now = ctx.now()
      let taskId = a.taskId
      let tasks = db().tasks
      if (!taskId && a.newTask) {
        const r = taskOps.createTask(db(), {
          title: a.newTask.title,
          projectId: a.newTask.projectId ?? null,
          status: 'doing',
        }, now)
        tasks = r.tasks
        taskId = r.task.id
      }
      if (!taskId) return null
      const staged = { ...db(), tasks }
      assertTaskExecutable(staged, taskId)
      const minutes = a.minutes ?? db().settings.defaultSessionMinutes
      if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('作業時間は1分以上にする')
      const session = ops.createSession({
        taskId,
        taskTitle: taskTitle(staged, taskId),
        plannedMs: minutes * MINUTE,
        mode: a.mode ?? db().settings.defaultSessionMode ?? 'timer',
        pomodoroBreakMs: (a.breakMinutes ?? db().settings.pomodoroBreakMinutes ?? 5) * MINUTE,
        pomodoroAutoResume: a.autoResume ?? db().settings.pomodoroAutoResume ?? false,
        now,
      })
      const started = ctx.runtime.currentWorkOpen ? ops.pauseSession(session, now, 'task-management') : session
      commitChanges(ctx, { sessions: [...db().sessions, started], tasks: taskOps.updateTask(staged, taskId, { status: 'doing' }, now) })
      ctx.windows.open('hud', false)
      ctx.ticker.start()
      ctx.windows.closeLater('start')
      return liveSession(db())
    },
    'session:pause': (a) => {
      const s = currentSession()
      if (!s) return null
      const next = ops.pauseSession(s, ctx.now(), a.reason ?? 'manual')
      // スリープは lock-screen と suspend が続くため、停止を追加しない場合は窓も出し直さない。
      if (next === s) return null
      replaceSession(db(), next)
      ctx.publish()
      ctx.windows.open('hud', false)
      return null
    },
    'session:resume': () => {
      const s = currentSession()
      if (!s) return null
      assertTaskExecutable(db(), activeTaskId(s))
      const next = ops.resumeSession(s, ctx.now())
      if (next === s) {
        if (s.expiredNotifiedAt !== null) ctx.windows.open('expire')
        return null
      }
      commitChanges(ctx, { sessions: db().sessions.map((item) => item.id === s.id ? next : item) })
      ctx.windows.closeLater('expire')
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
      const s = currentSession()
      if (!s) return null
      assertTaskExecutable(db(), activeTaskId(s))
      const minutes = a.minutes || db().settings.defaultExtendMinutes
      const next = ops.extendSession(s, minutes, ctx.now())
      commitChanges(ctx, { sessions: db().sessions.map((item) => item.id === s.id ? next : item) })
      ctx.windows.closeLater('expire')
      return null
    },
    'session:break': (a) => {
      const s = currentSession()
      if (!s) return null
      const minutes = a.minutes || 5
      const next = ops.startBreak(s, minutes, ctx.now())
      if (next === s) return null
      replaceSession(db(), next)
      ctx.publish()
      ctx.windows.open('hud', false)
      ctx.windows.closeLater('expire')
      return null
    },
    'session:switchTask': (a) => {
      const s = currentSession()
      if (!s) return null
      assertTaskExecutable(db(), a.taskId)
      const now = ctx.now()
      const prev = activeTaskId(s)
      const sessions = db().sessions.map((item) => item.id === s.id ? ops.switchTask(s, a.taskId, taskTitle(db(), a.taskId), now) : item)
      let staged = { ...db(), sessions }
      staged = { ...staged, tasks: taskOps.updateTask(staged, a.taskId, { status: 'doing' }, now) }
      if (prev && prev !== a.taskId) {
        const prevTask = staged.tasks.find((t) => t.id === prev)
        if (prevTask && prevTask.status === 'doing') staged = { ...staged, tasks: taskOps.updateTask(staged, prev, { status: 'todo' }, now) }
      }
      commitChanges(ctx, { sessions, tasks: staged.tasks })
      return null
    },
    'session:end': (a) => {
      const s = currentSession()
      if (!s) return null
      const ended = ops.endSession(s, ctx.now())
      const beforeReview = ctx.runtime.pendingReview
      ctx.runtime.pendingReview = { sessionId: ended.id, thenStart: Boolean(a.thenStart) }
      try {
        commitChanges(ctx, { sessions: db().sessions.map((session) => session.id === s.id ? ended : session) })
      } catch (cause) {
        ctx.runtime.pendingReview = beforeReview
        throw cause
      }
      ctx.ticker.stop()
      ctx.windows.open('review')
      ctx.windows.closeLater('expire', 'hud', 'current')
      return null
    },
    'session:review': (a) => {
      const s = db().sessions.find((x) => x.id === a.sessionId)
      if (!s) return null
      const now = ctx.now()
      const updated = ops.recordProgress(s, a.changes, now)
      updated.note = a.note ?? ''
      const sessions = db().sessions.map((item) => item.id === s.id ? updated : item)
      let staged = { ...db(), sessions }
      for (const c of a.changes) {
        staged = { ...staged, tasks: taskOps.updateTask(staged, c.taskId, {
          progress: c.to,
          ...(c.markedDone ? { status: 'done' as const } : {}),
        }, now) }
      }
      const thenStart = ctx.runtime.pendingReview?.thenStart ?? false
      const pendingReview = ctx.runtime.pendingReview
      ctx.runtime.pendingReview = null
      try {
        commitChanges(ctx, { sessions, tasks: staged.tasks })
      } catch (cause) {
        ctx.runtime.pendingReview = pendingReview
        throw cause
      }
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
      if (s.endedAt === null && a.segmentTaskId) throw new Error('現在のタスク変更にはセッションの切替を使う')
      // 先に db を書き換えてから検証しない（申告が拒否されたときに記録が半分だけ変わる）
      const next = ops.editSession(s, { ...a.patch, segmentTaskId: a.segmentTaskId }, ctx.now())
      commitChanges(ctx, { sessions: db().sessions.map((session) => session.id === s.id ? next : session) })
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
      if (s) assertTaskExecutable(db(), activeTaskId(s))
      const next = s ? ops.resumeSession(s, ctx.now()) : null
      const recovery = ctx.runtime.recovery
      ctx.runtime.recovery = null
      try {
        commitChanges(ctx, { sessions: db().sessions.map((item) => item.id === s?.id ? next! : item) })
      } catch (cause) {
        ctx.runtime.recovery = recovery
        throw cause
      }
      if (s && next === s && s.expiredNotifiedAt !== null) ctx.windows.open('expire')
      ctx.ticker.start()
      return null
    },

    // ── ウィンドウ / 設定 / データ
    'window:open': (a) => {
      ctx.windows.open(a.kind)
      return null
    },
    'window:close': (a) => {
      ctx.windows.closeLater(a.kind)
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
      const previous = db().settings
      const next = { ...previous, ...a.patch }
      db().settings = next
      try {
        if (a.patch.shortcuts) {
          const unavailable = ctx.system.applyShortcuts()
          if (unavailable.length > 0) throw new Error(`ショートカットを登録できません: ${unavailable.join(', ')}`)
        }
        ctx.system.applyLoginItem()
        db().settings = previous
        commitChanges(ctx, { settings: next })
      } catch (err) {
        db().settings = previous
        if (a.patch.shortcuts) ctx.system.applyShortcuts()
        ctx.system.applyLoginItem()
        throw err
      }
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
      if (p) {
        ctx.ticker.stop()
        ctx.runtime.recovery = null
        ctx.runtime.pendingReview = null
        restoreOpenSession(ctx)
        ctx.publish()
      }
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
  const quitSaveCommands = new Set<CommandName>(['state:get', 'app:quit', 'task:update', 'project:update', 'note:update', 'fixedWork:create', 'fixedWork:update'])
  function guard<N extends CommandName>(name: N, reason?: 'end' | 'switch' | 'import') {
    const original = handlers[name] as (args: ArgsOf<N>) => ResultOf<N> | Promise<ResultOf<N>>
    const assertAvailable = () => {
      if (ctx.runtime.quitting && name !== 'state:get' || ctx.runtime.preparingQuit && !quitSaveCommands.has(name)) throw new Error('アプリを終了中です')
    }
    handlers[name] = ((args: ArgsOf<N>) => {
      assertAvailable()
      if (!reason || !ctx.windows.prepareEditors) return original(args)
      return ctx.windows.prepareEditors(reason, reason === 'import' ? undefined : ['current']).then(async (release) => {
        let closing: WindowKind[] = []
        try {
          assertAvailable()
          const endsCurrent = name === 'session:end' && Boolean(currentSession())
          const result = await original(args)
          if (endsCurrent) closing = ['current']
          return result
        } finally { release(closing) }
      })
    }) as Handlers[N]
  }
  for (const name of Object.keys(handlers) as CommandName[]) {
    guard(name, name === 'session:end' ? 'end' : name === 'session:switchTask' ? 'switch' : name === 'data:import' ? 'import' : undefined)
  }
  return handlers
}

export async function dispatch<N extends CommandName>(handlers: Handlers, name: N, args: ArgsOf<N>): Promise<ResultOf<N>> {
  // handlers[name] はコマンド名ごとの関数の合併型になり、そのままでは呼べないので 1 箇所だけ絞り込む
  const handler = handlers[name] as (a: ArgsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>
  return await handler(args)
}

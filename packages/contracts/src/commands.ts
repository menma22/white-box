/**
 * 画面⇄メインプロセスの全コマンド契約。ここが両者の唯一の合意点。
 *
 * コマンドを増やす・変えるときは必ずこの表を先に変える（契約ファースト）。
 * メイン側の受け口は args をこのスキーマで検証してから処理へ渡す。
 */
import { z } from 'zod'
import {
  AppStateSchema,
  IdSchema,
  PauseReasonSchema,
  PrioritySchema,
  ProgressChangeSchema,
  ProjectSchema,
  SessionSchema,
  SettingsSchema,
  TaskSchema,
  TaskStatusSchema,
  WindowKindSchema,
} from './schemas.js'

const NoArgs = z.object({})

export const COMMANDS = {
  'state:get': { args: NoArgs, result: AppStateSchema },

  // ── Project
  'project:create': { args: z.object({ name: z.string() }), result: ProjectSchema },
  'project:update': {
    args: z.object({ id: IdSchema, patch: ProjectSchema.partial() }),
    result: z.null(),
  },
  'project:delete': { args: z.object({ id: IdSchema }), result: z.null() },

  // ── Task
  'task:create': {
    args: z.object({
      title: z.string(),
      projectId: IdSchema.nullable().optional(),
      parentId: IdSchema.nullable().optional(),
      status: TaskStatusSchema.optional(),
      priority: PrioritySchema.optional(),
      notes: z.string().optional(),
      sessionId: IdSchema.nullable().optional(),
      /** true なら実行中セッションのログに「タスク追加」を残す */
      fromSession: z.boolean().optional(),
    }),
    result: TaskSchema,
  },
  'task:update': {
    args: z.object({ id: IdSchema, patch: TaskSchema.partial() }),
    result: z.null(),
  },
  'task:move': {
    args: z.object({ id: IdSchema, status: TaskStatusSchema, index: z.number().int() }),
    result: z.null(),
  },
  'task:delete': { args: z.object({ id: IdSchema }), result: z.null() },
  'task:hasTime': { args: z.object({ id: IdSchema }), result: z.boolean() },

  // ── Session
  'session:start': {
    args: z.object({
      taskId: IdSchema.optional(),
      newTask: z.object({ title: z.string(), projectId: IdSchema.nullable().optional() }).optional(),
      minutes: z.number().optional(),
    }),
    result: SessionSchema.nullable(),
  },
  'session:pause': { args: z.object({ reason: PauseReasonSchema.optional() }), result: z.null() },
  'session:resume': { args: NoArgs, result: z.null() },
  'session:toggle': { args: NoArgs, result: z.null() },
  'session:extend': { args: z.object({ minutes: z.number().optional() }), result: z.null() },
  'session:switchTask': { args: z.object({ taskId: IdSchema }), result: z.null() },
  'session:end': { args: z.object({ thenStart: z.boolean().optional() }), result: z.null() },
  'session:review': {
    args: z.object({
      sessionId: IdSchema,
      changes: z.array(ProgressChangeSchema),
      note: z.string().optional(),
    }),
    result: z.null(),
  },
  'session:skipReview': { args: NoArgs, result: z.null() },
  'session:update': {
    args: z.object({
      id: IdSchema,
      patch: z.object({
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
        plannedMs: z.number().optional(),
        note: z.string().optional(),
      }),
      segmentTaskId: IdSchema.optional(),
    }),
    result: z.null(),
  },
  'session:delete': { args: z.object({ id: IdSchema }), result: z.null() },

  // ── 復旧
  'recovery:close': { args: NoArgs, result: z.null() },
  'recovery:resume': { args: NoArgs, result: z.null() },

  // ── ウィンドウ / 設定 / データ
  'window:open': { args: z.object({ kind: WindowKindSchema }), result: z.null() },
  'window:close': { args: z.object({ kind: WindowKindSchema }), result: z.null() },
  'window:toggle': { args: z.object({ kind: WindowKindSchema }), result: z.null() },
  'window:minimize': { args: NoArgs, result: z.null() },
  'settings:update': { args: z.object({ patch: SettingsSchema.partial() }), result: z.null() },
  'day:note': { args: z.object({ key: z.string(), text: z.string() }), result: z.null() },
  'welcome:dismiss': { args: NoArgs, result: z.null() },
  'data:export': { args: NoArgs, result: z.string().nullable() },
  'data:import': { args: NoArgs, result: z.string().nullable() },
  'data:reveal': { args: NoArgs, result: z.null() },
  'app:quit': { args: NoArgs, result: z.null() },
} as const

export type CommandName = keyof typeof COMMANDS
export type ArgsOf<N extends CommandName> = z.output<(typeof COMMANDS)[N]['args']>
export type ResultOf<N extends CommandName> = z.output<(typeof COMMANDS)[N]['result']>

export function isCommand(name: string): name is CommandName {
  return Object.prototype.hasOwnProperty.call(COMMANDS, name)
}

/** メイン側の受け口用。検証に失敗すると ZodError を投げる。 */
export function parseArgs<N extends CommandName>(name: N, args: unknown): ArgsOf<N> {
  return COMMANDS[name].args.parse(args ?? {}) as ArgsOf<N>
}

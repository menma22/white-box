/**
 * 画面⇄メインプロセスの全コマンド契約。ここが両者の唯一の合意点。
 *
 * コマンドを増やす・変えるときは必ずこの表を先に変える（契約ファースト）。
 * メイン側の受け口は args をこのスキーマで検証してから処理へ渡す。
 * args を緩い object にすると、綴り違いのキーが zod に黙って捨てられ、無反応のまま成功が返る。
 */
import { z } from 'zod'
import {
  AppStateSchema,
  IdSchema,
  LivePauseReasonSchema,
  PrioritySchema,
  ProgressChangeSchema,
  ProjectSchema,
  SessionSchema,
  SettingsSchema,
  TaskSchema,
  TaskStatusSchema,
  TimeRangeSchema,
  WindowKindSchema,
} from './schemas.js'

const NoArgs = z.strictObject({})

export const COMMANDS = {
  'state:get': { args: NoArgs, result: AppStateSchema },

  // ── Project
  'project:create': { args: z.strictObject({ name: z.string() }), result: ProjectSchema },
  'project:update': {
    args: z.strictObject({ id: IdSchema, patch: ProjectSchema.partial().strict() }),
    result: z.null(),
  },
  'project:delete': { args: z.strictObject({ id: IdSchema }), result: z.null() },

  // ── Task
  'task:create': {
    args: z.strictObject({
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
    args: z.strictObject({ id: IdSchema, patch: TaskSchema.partial().strict() }),
    result: z.null(),
  },
  'task:move': {
    args: z.strictObject({ id: IdSchema, status: TaskStatusSchema, index: z.number().int() }),
    result: z.null(),
  },
  'task:delete': { args: z.strictObject({ id: IdSchema }), result: z.null() },
  'task:hasTime': { args: z.strictObject({ id: IdSchema }), result: z.boolean() },

  // ── Session
  'session:start': {
    args: z.strictObject({
      taskId: IdSchema.optional(),
      newTask: z.strictObject({ title: z.string(), projectId: IdSchema.nullable().optional() }).optional(),
      minutes: z.number().optional(),
    }),
    result: SessionSchema.nullable(),
  },
  'session:pause': { args: z.strictObject({ reason: LivePauseReasonSchema.optional() }), result: z.null() },
  'session:resume': { args: NoArgs, result: z.null() },
  'session:toggle': { args: NoArgs, result: z.null() },
  'session:extend': { args: z.strictObject({ minutes: z.number().optional() }), result: z.null() },
  'session:break': { args: z.strictObject({ minutes: z.number().optional() }), result: z.null() },
  'session:switchTask': { args: z.strictObject({ taskId: IdSchema }), result: z.null() },
  'session:end': { args: z.strictObject({ thenStart: z.boolean().optional() }), result: z.null() },
  'session:review': {
    args: z.strictObject({
      sessionId: IdSchema,
      changes: z.array(ProgressChangeSchema.strict()),
      note: z.string().optional(),
    }),
    result: z.null(),
  },
  'session:skipReview': { args: NoArgs, result: z.null() },
  'session:update': {
    args: z.strictObject({
      id: IdSchema,
      patch: z.strictObject({
        startedAt: z.number().optional(),
        endedAt: z.number().optional(),
        plannedMs: z.number().optional(),
        note: z.string().optional(),
        /** 後から申告する除外区間の全体。渡すと申告ぶんを置き換える（観測された一時停止には触らない） */
        exclusions: z.array(TimeRangeSchema.strict()).optional(),
      }),
      segmentTaskId: IdSchema.optional(),
    }),
    result: z.null(),
  },
  'session:delete': { args: z.strictObject({ id: IdSchema }), result: z.null() },

  // ── 復旧
  'recovery:close': { args: NoArgs, result: z.null() },
  'recovery:resume': { args: NoArgs, result: z.null() },

  // ── ウィンドウ / 設定 / データ
  'window:open': { args: z.strictObject({ kind: WindowKindSchema }), result: z.null() },
  'window:close': { args: z.strictObject({ kind: WindowKindSchema }), result: z.null() },
  'window:toggle': { args: z.strictObject({ kind: WindowKindSchema }), result: z.null() },
  'window:minimize': { args: NoArgs, result: z.null() },
  'settings:update': {
    args: z.strictObject({
      patch: SettingsSchema.partial().strict().extend({ shortcuts: SettingsSchema.shape.shortcuts.strict().optional() }),
    }),
    result: z.null(),
  },
  'day:note': { args: z.strictObject({ key: z.string(), text: z.string() }), result: z.null() },
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

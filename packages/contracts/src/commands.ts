/**
 * 画面⇄メインプロセスの全コマンド契約。ここが両者の唯一の合意点。
 *
 * コマンドを増やす・変えるときは必ずこの表を先に変える（契約ファースト）。
 * メイン側の受け口は args をこのスキーマで検証してから処理へ渡す。
 * args を緩い object にすると、綴り違いのキーが zod に黙って捨てられ、無反応のまま成功が返る。
 */
import { z } from 'zod'
import { GoalCriteriaSchema } from './goal-criteria.js'
import { PRESENCE_COMMANDS } from './presence.js'
import { AgentPlanEntrySchema, TaskSuggestionSchema } from './agent.js'
import { NOTE_COMMANDS } from './notes.js'
import { TaskControlSchema } from './task-control.js'
import { PLANNING_COMMANDS } from './planning.js'
import {
  AppStateSchema,
  GoalIssueKindSchema,
  GoalIssueSchema,
  GoalNodeSchema,
  GoalUiSchema,
  IdSchema,
  OutcomeRecordSchema,
  LivePauseReasonSchema,
  PrioritySchema,
  ProgressChangeSchema,
  ProjectSchema,
  SessionSchema,
  SessionModeSchema,
  SettingsSchema,
  TaskSchema,
  TaskStatusSchema,
  TimeRangeSchema,
  WindowKindSchema,
} from './schemas.js'

const NoArgs = z.strictObject({})

export const COMMANDS = {
  ...PLANNING_COMMANDS,
  ...PRESENCE_COMMANDS,
  'agent:config': { args: NoArgs, result: z.string() },
  'agent:context': {
    args: z.strictObject({ projectId: z.string().optional() }),
    result: z.object({
      projects: z.array(ProjectSchema),
      tasks: z.array(TaskSchema),
      goals: z.array(GoalNodeSchema),
      sessions: z.array(z.object({ id: z.string(), startedAt: z.number(), endedAt: z.number().nullable(), taskIds: z.array(z.string()), focusMs: z.number() })),
    }),
  },
  'agent:applyPlan': {
    args: z.strictObject({ requestId: z.string().min(1).max(200).refine((id) => id !== '__proto__', 'requestIdが不正です'), tasks: z.array(AgentPlanEntrySchema).min(1).max(100) }),
    result: z.array(TaskSchema),
  },
  'agent:propose': {
    args: z.strictObject({ sessionId: z.string(), taskId: z.string().nullable().optional(), title: z.string().trim().min(1).max(500).optional(), reason: z.string().trim().min(1).max(2000), markDone: z.boolean().optional() }),
    result: TaskSuggestionSchema,
  },
  'agent:resolve': { args: z.strictObject({ id: z.string(), accept: z.boolean() }), result: z.null() },
  ...NOTE_COMMANDS,
  'state:get': { args: NoArgs, result: AppStateSchema },

  // ── Project
  'project:create': { args: z.strictObject({ name: z.string() }), result: ProjectSchema },
  'project:update': {
    args: z.strictObject({ id: IdSchema, patch: ProjectSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial().strict() }),
    result: z.null(),
  },
  'project:delete': { args: z.strictObject({ id: IdSchema }), result: z.null() },

  // ── Task
  'task:create': {
    args: z.strictObject({
      ...TaskControlSchema.shape,
      title: z.string(),
      projectId: IdSchema.nullable().optional(),
      parentId: IdSchema.nullable().optional(),
      status: TaskStatusSchema.optional(),
      priority: PrioritySchema.optional(),
      notes: z.string().optional(),
      problems: z.string().optional(),
      decisions: z.string().optional(),
      nextContext: z.string().optional(),
      sessionId: IdSchema.nullable().optional(),
      due: z.string().nullable().optional(),
      goalNodeId: IdSchema.nullable().optional(),
      remainingEffortMinutes: TaskSchema.shape.remainingEffortMinutes,
      safetyBufferMinutes: TaskSchema.shape.safetyBufferMinutes,
      /** true なら実行中セッションのログに「タスク追加」を残す */
      fromSession: z.boolean().optional(),
    }),
    result: TaskSchema,
  },
  'task:update': {
    args: z.strictObject({ id: IdSchema, patch: TaskSchema.omit({ id: true, createdAt: true, updatedAt: true, committedAt: true, lastProgressAt: true }).partial().strict() }),
    result: z.null(),
  },
  'task:move': {
    args: z.strictObject({ id: IdSchema, status: TaskStatusSchema, index: z.number().int() }),
    result: z.null(),
  },
  'task:delete': { args: z.strictObject({ id: IdSchema }), result: z.null() },
  'task:hasTime': { args: z.strictObject({ id: IdSchema }), result: z.boolean() },

  // ── 道標（目標・問題・改善）
  'goal:create': {
    args: z.strictObject({ goal: z.string(), reason: z.string().optional(), parentId: IdSchema.nullable().optional(), criteria: GoalCriteriaSchema.optional() }),
    result: GoalNodeSchema,
  },
  'goal:update': {
    args: z.strictObject({
      id: IdSchema,
      patch: z.strictObject({
        goal: z.string().optional(),
        reason: z.string().optional(),
        criteria: GoalCriteriaSchema.optional(),
        outcome: OutcomeRecordSchema.omit({ assessedAt: true }).partial().strict().optional(),
      }),
    }),
    result: z.null(),
  },
  'goal:merge': {
    args: z.strictObject({ ids: z.array(IdSchema), goal: z.string(), reason: z.string().optional() }),
    result: GoalNodeSchema,
  },
  'goal:hide': { args: z.strictObject({ id: IdSchema, reason: z.string().optional() }), result: z.null() },
  'goal:restore': { args: z.strictObject({ id: IdSchema }), result: z.null() },
  'goal:ui': {
    args: z.strictObject({ patch: GoalUiSchema.partial().strict().optional(), activeHeadId: IdSchema.nullable().optional() }),
    result: z.null(),
  },
  /** zod で形を縛らない: 参照・循環まで見る検証は取り込み処理（parseGoalMap）にしか書けない */
  'goal:import': {
    args: z.strictObject({ data: z.unknown() }),
    result: z.object({ nodes: z.number(), tasks: z.number(), issues: z.number(), history: z.number() }),
  },
  'issue:create': {
    args: z.strictObject({ kind: GoalIssueKindSchema, text: z.string(), nodeId: IdSchema.nullable().optional() }),
    result: GoalIssueSchema,
  },
  'issue:update': {
    args: z.strictObject({
      id: IdSchema,
      patch: z.strictObject({
        text: z.string().optional(),
        kind: GoalIssueKindSchema.optional(),
        resolved: z.boolean().optional(),
        nodeId: IdSchema.nullable().optional(),
      }),
    }),
    result: z.null(),
  },
  'issue:delete': { args: z.strictObject({ id: IdSchema }), result: z.null() },

  // ── Session
  'session:start': {
    args: z.strictObject({
      taskId: IdSchema.optional(),
      newTask: z.strictObject({ title: z.string(), projectId: IdSchema.nullable().optional() }).optional(),
      minutes: z.number().finite().min(1).max(1440).optional(),
      mode: SessionModeSchema.optional(),
      breakMinutes: z.number().int().min(1).max(180).optional(),
      autoResume: z.boolean().optional(),
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

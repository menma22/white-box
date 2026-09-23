/**
 * データ型の実行時スキーマ。型の正は @white-box/core/types の interface（Decision Record D-02）。
 * スキーマと型がずれると末尾の Exact 検査がコンパイルで落ちる。
 */
import { z } from 'zod'
import type {
  AppState,
  LiveTick,
  PauseInterval,
  Priority,
  ProgressChange,
  Project,
  Session,
  SessionEvent,
  SessionEventType,
  SessionState,
  Settings,
  Task,
  TaskSegment,
  TaskStatus,
  TimeRange,
  WindowKind,
} from '@white-box/core/types'

export const IdSchema = z.string()

export const TaskStatusSchema = z.enum(['inbox', 'todo', 'doing', 'done'])
export const PrioritySchema = z.enum(['low', 'normal', 'high'])
export const SessionStateSchema = z.enum(['running', 'paused', 'ended'])
export const WindowKindSchema = z.enum(['main', 'start', 'hud', 'expire', 'review', 'current'])
export const PauseReasonSchema = z.enum(['manual', 'suspend', 'lock', 'break', 'excluded'])
/** 'excluded' は終了後の申告なので session:pause では受けない。 */
export const LivePauseReasonSchema = z.enum(['manual', 'suspend', 'lock'])

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string(),
  hue: z.number(),
  archived: z.boolean(),
  order: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const TaskSchema = z.object({
  id: IdSchema,
  projectId: IdSchema.nullable(),
  parentId: IdSchema.nullable(),
  title: z.string(),
  notes: z.string(),
  status: TaskStatusSchema,
  progress: z.number(),
  priority: PrioritySchema,
  order: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  doneAt: z.number().nullable(),
  createdInSessionId: IdSchema.nullable(),
})

export const TaskSegmentSchema = z.object({
  id: IdSchema,
  taskId: IdSchema,
  startedAt: z.number(),
  endedAt: z.number().nullable(),
})

export const PauseIntervalSchema = z.object({
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  reason: PauseReasonSchema.nullable(),
  plannedEndAt: z.number().optional(),
  notifiedAt: z.number().nullable().optional(),
})

export const TimeRangeSchema = z.object({
  startedAt: z.number().int(),
  endedAt: z.number().int(),
})

export const SessionEventTypeSchema = z.enum([
  'session_started',
  'task_started',
  'task_switched',
  'task_created',
  'paused',
  'resumed',
  'extended',
  'timer_expired',
  'session_ended',
  'progress_updated',
  'session_edited',
])

export const SessionEventSchema = z.object({
  at: z.number(),
  type: SessionEventTypeSchema,
  label: z.string(),
  ref: z
    .object({
      taskId: IdSchema.optional(),
      minutes: z.number().optional(),
      from: z.number().optional(),
      to: z.number().optional(),
    })
    .optional(),
})

export const ProgressChangeSchema = z.object({
  taskId: IdSchema,
  from: z.number(),
  to: z.number(),
  markedDone: z.boolean(),
})

export const SessionSchema = z.object({
  id: IdSchema,
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  plannedMs: z.number(),
  state: SessionStateSchema,
  segments: z.array(TaskSegmentSchema),
  pauses: z.array(PauseIntervalSchema),
  events: z.array(SessionEventSchema),
  progressChanges: z.array(ProgressChangeSchema),
  note: z.string(),
  expiredNotifiedAt: z.number().nullable(),
  editedAt: z.number().nullable(),
  createdAt: z.number(),
})

export const SettingsSchema = z.object({
  displayName: z.string(),
  defaultSessionMinutes: z.number(),
  defaultExtendMinutes: z.number(),
  extendOptions: z.array(z.number()),
  shortcuts: z.object({
    startPause: z.string(),
    currentWork: z.string(),
    dashboard: z.string(),
  }),
  launchAtLogin: z.boolean(),
  autoPauseOnSuspend: z.boolean(),
  soundOnExpire: z.boolean(),
  dayStartHour: z.number(),
  lastWelcomeDate: z.string().nullable(),
  stallWarningDays: z.number(),
  showSessionCard: z.boolean(),
  onboardedAt: z.number().nullable(),
})

export const LiveTickSchema = z.object({
  sessionId: IdSchema,
  state: z.enum(['running', 'paused']),
  elapsedMs: z.number(),
  remainingMs: z.number(),
  plannedMs: z.number(),
  activeTaskId: IdSchema.nullable(),
})

export const AppStateSchema = z.object({
  revision: z.number(),
  projects: z.array(ProjectSchema),
  tasks: z.array(TaskSchema),
  sessions: z.array(SessionSchema),
  settings: SettingsSchema,
  dayNotes: z.record(z.string(), z.string()),
  live: LiveTickSchema.nullable(),
  breakTimer: z.object({ startedAt: z.number(), endsAt: z.number(), notifiedAt: z.number().nullable() }).nullable(),
  recovery: z.object({ sessionId: IdSchema, lastKnownAt: z.number() }).nullable(),
  pendingReview: z.object({ sessionId: IdSchema, thenStart: z.boolean() }).nullable(),
})

// ── スキーマ ⇄ core 型の等価性検査（ずれるとここがコンパイルエラーになる）──
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

const _exact: [
  Exact<z.infer<typeof TaskStatusSchema>, TaskStatus>,
  Exact<z.infer<typeof PrioritySchema>, Priority>,
  Exact<z.infer<typeof SessionStateSchema>, SessionState>,
  Exact<z.infer<typeof WindowKindSchema>, WindowKind>,
  Exact<z.infer<typeof ProjectSchema>, Project>,
  Exact<z.infer<typeof TaskSchema>, Task>,
  Exact<z.infer<typeof TaskSegmentSchema>, TaskSegment>,
  Exact<z.infer<typeof PauseIntervalSchema>, PauseInterval>,
  Exact<z.infer<typeof TimeRangeSchema>, TimeRange>,
  Exact<z.infer<typeof SessionEventTypeSchema>, SessionEventType>,
  Exact<z.infer<typeof SessionEventSchema>, SessionEvent>,
  Exact<z.infer<typeof ProgressChangeSchema>, ProgressChange>,
  Exact<z.infer<typeof SessionSchema>, Session>,
  Exact<z.infer<typeof SettingsSchema>, Settings>,
  Exact<z.infer<typeof LiveTickSchema>, LiveTick>,
  Exact<z.infer<typeof AppStateSchema>, AppState>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true]
void _exact

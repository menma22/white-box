/**
 * White Box — データモデル（v1 / MVP）
 *
 * 時刻はすべて epoch ミリ秒。ローカル時刻への変換は表示層だけで行う。
 * Session は「起きたこと」の記録なので、後から意味を変えない（編集は editedAt を残す）。
 */

export type ID = string

export type TaskStatus = 'inbox' | 'todo' | 'doing' | 'done'

export type Priority = 'low' | 'normal' | 'high'

export interface Project {
  id: ID
  name: string
  hue: number
  archived: boolean
  order: number
  createdAt: number
  updatedAt: number
}

export interface Task {
  id: ID
  projectId: ID | null
  parentId: ID | null
  title: string
  notes: string
  status: TaskStatus
  /** 人間が宣言する値。子タスクや実績から自動計算しない。 */
  progress: number
  priority: Priority
  order: number
  createdAt: number
  updatedAt: number
  doneAt: number | null
  createdInSessionId: ID | null
}

export type SessionState = 'running' | 'paused' | 'ended'

/** 同一瞬間に開いている区間は 1 つだけ（Foreground Task は常に 1 つ）。 */
export interface TaskSegment {
  id: ID
  taskId: ID
  startedAt: number
  endedAt: number | null
}

/** 'excluded' だけは観測ではなく、人間が後から「作業していなかった」と申告した区間。 */
export interface PauseInterval {
  startedAt: number
  endedAt: number | null
  reason: 'manual' | 'suspend' | 'lock' | 'excluded' | null
}

/** 閉じた時間の範囲。除外の申告と、除外できる範囲の計算に使う。 */
export interface TimeRange {
  startedAt: number
  endedAt: number
}

export type SessionEventType =
  | 'session_started'
  | 'task_started'
  | 'task_switched'
  | 'task_created'
  | 'paused'
  | 'resumed'
  | 'extended'
  | 'timer_expired'
  | 'session_ended'
  | 'progress_updated'
  | 'session_edited'

export interface SessionEvent {
  at: number
  type: SessionEventType
  label: string
  ref?: { taskId?: ID; minutes?: number; from?: number; to?: number }
}

export interface ProgressChange {
  taskId: ID
  from: number
  to: number
  markedDone: boolean
}

export interface Session {
  id: ID
  startedAt: number
  endedAt: number | null
  /** 「今から何分やるか」。タスク全体の所要見積もりとしては使わない。 */
  plannedMs: number
  state: SessionState
  segments: TaskSegment[]
  pauses: PauseInterval[]
  events: SessionEvent[]
  progressChanges: ProgressChange[]
  note: string
  expiredNotifiedAt: number | null
  editedAt: number | null
  createdAt: number
}

export interface Settings {
  /** 呼びかけに使う名前。 */
  displayName: string
  defaultSessionMinutes: number
  defaultExtendMinutes: number
  extendOptions: number[]
  shortcuts: {
    startPause: string
    currentWork: string
    dashboard: string
  }
  launchAtLogin: boolean
  autoPauseOnSuspend: boolean
  soundOnExpire: boolean
  /** 1 日の境界（時）。深夜作業を前日側に含めるために 0 以外を許す。 */
  dayStartHour: number
  lastWelcomeDate: string | null
  stallWarningDays: number
  /** セッション中の最前面カード（HUD）を表示するか。 */
  showSessionCard: boolean
  /** 初回オンボーディングを終えた時刻。null は未完了。 */
  onboardedAt: number | null
}

export interface Database {
  version: number
  projects: Project[]
  tasks: Task[]
  sessions: Session[]
  settings: Settings
  dayNotes: Record<string, string>
}

/** 毎秒流す軽い更新。状態全体の再送はミューテーション時だけに限る。 */
export interface LiveTick {
  sessionId: ID
  state: Exclude<SessionState, 'ended'>
  elapsedMs: number
  /** 満了後はマイナスになり、超過時間を表す。 */
  remainingMs: number
  plannedMs: number
  activeTaskId: ID | null
}

export interface AppState {
  revision: number
  projects: Project[]
  tasks: Task[]
  sessions: Session[]
  settings: Settings
  dayNotes: Record<string, string>
  live: LiveTick | null
  recovery: { sessionId: ID; lastKnownAt: number } | null
  pendingReview: { sessionId: ID; thenStart: boolean } | null
}

export type WindowKind = 'main' | 'start' | 'hud' | 'expire' | 'review' | 'current'

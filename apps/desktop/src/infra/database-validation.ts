import { ProjectSchema, SessionSchema, SettingsSchema, TaskSchema } from '@white-box/contracts'
import type { Database } from '@white-box/core/types'

export const DATABASE_VERSION = 1

const DATABASE_KEYS: Record<keyof Database, true> = {
  version: true, projects: true, tasks: true, sessions: true, settings: true, dayNotes: true,
  goalMap: true, goalMapImports: true, agentRequests: true, taskSuggestions: true, notes: true,
  presenceCandidates: true, weeklyBudgets: true, weeklyBudgetDefaults: true, fixedWork: true,
}

export function validateStoredDatabase(value: unknown): asserts value is Partial<Database> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('White Box のデータではありません')
  const raw = value as Record<string, unknown>
  if (raw.version !== DATABASE_VERSION) throw new Error('このデータのバージョンには対応していません')
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DATABASE_KEYS, key)) throw new Error(`未対応のデータ項目があります: ${key}`)
  }
  const projects = ProjectSchema.array().parse(raw.projects)
  const tasks = TaskSchema.array().parse(raw.tasks)
  const sessions = SessionSchema.array().parse(raw.sessions)
  if (raw.settings !== undefined) SettingsSchema.partial().parse(raw.settings)
  if (raw.dayNotes === null || typeof raw.dayNotes !== 'object' || Array.isArray(raw.dayNotes) || Object.values(raw.dayNotes).some((note) => typeof note !== 'string')) {
    throw new Error('一日のメモが不正です')
  }
  assertUniqueIds(projects, 'プロジェクト')
  assertUniqueIds(tasks, 'タスク')
  assertUniqueIds(sessions, 'セッション')
  for (const record of projects) assertDates(record.createdAt, record.updatedAt)
  for (const task of tasks) assertDates(task.createdAt, task.updatedAt, task.doneAt, task.committedAt, task.lastProgressAt)
  for (const session of sessions) {
    assertUniqueIds(session.segments, 'タスク区間')
    assertDates(session.startedAt, session.endedAt, session.createdAt, session.editedAt, session.expiredNotifiedAt)
    if ((session.state === 'ended') !== (session.endedAt !== null)) throw new Error('セッションの終了状態と終了時刻が一致していません')
    if (session.endedAt !== null && session.endedAt < session.startedAt) throw new Error('セッションの終了時刻が開始時刻より前です')
    if (session.state !== 'ended' && (session.state === 'paused') !== session.pauses.some((pause) => pause.endedAt === null)) {
      throw new Error('セッションの停止状態と停止区間が一致していません')
    }
    if (session.segments.filter((segment) => segment.endedAt === null).length !== (session.state === 'ended' ? 0 : 1)) {
      throw new Error('セッションの開いているタスク区間が不正です')
    }
    for (const segment of session.segments) assertDates(segment.startedAt, segment.endedAt)
    for (const pause of session.pauses) {
      assertDates(pause.startedAt, pause.endedAt, pause.plannedEndAt, pause.notifiedAt)
      if (session.state === 'ended' && pause.endedAt === null) throw new Error('終了済みセッションに開いた停止区間があります')
    }
    for (const event of session.events) assertDates(event.at)
  }
  if (sessions.filter((session) => session.state !== 'ended').length > 1) throw new Error('未終了のセッションが複数あります')
  for (const key of ['notes', 'taskSuggestions'] as const) {
    const records = raw[key]
    if (Array.isArray(records)) assertUniqueIds(records as { id: string }[], key)
  }
}

function assertDates(...values: (number | null | undefined)[]): void {
  if (values.some((value) => value != null && !Number.isFinite(new Date(value).getTime()))) throw new Error('記録日時が不正です')
}

function assertUniqueIds(records: { id: string }[], label: string): void {
  if (new Set(records.map((record) => record.id)).size !== records.length) throw new Error(`${label}のIDが重複しています`)
}

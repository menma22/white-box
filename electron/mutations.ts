/**
 * Project / Task の変更。Database を直接書き換え、保存は呼び出し側が行う。
 *
 * タスクを消してもセッションの記録は消さない（過去を書き換えないため）。
 */
import type { Database, ID, Priority, Project, Task, TaskStatus } from '@white-box/core/types'
import { newId } from '../shared/session-ops.js'

export function createProject(db: Database, input: { name: string; hue?: number }): Project {
  const now = Date.now()
  const used = db.projects.map((p) => p.hue)
  const palette = [18, 200, 150, 265, 42, 330, 96, 228]
  const hue = input.hue ?? (palette.find((h) => !used.includes(h)) ?? Math.floor(Math.random() * 360))
  const project: Project = {
    id: newId('prj'),
    name: input.name.trim() || '無題のプロジェクト',
    hue,
    archived: false,
    order: db.projects.length,
    createdAt: now,
    updatedAt: now,
  }
  db.projects.push(project)
  return project
}

export function updateProject(db: Database, id: ID, patch: Partial<Project>): void {
  const p = db.projects.find((x) => x.id === id)
  if (!p) return
  Object.assign(p, patch, { id: p.id, updatedAt: Date.now() })
}

export function deleteProject(db: Database, id: ID): void {
  db.projects = db.projects.filter((p) => p.id !== id)
  for (const t of db.tasks) {
    if (t.projectId === id) t.projectId = null
  }
}

export function createTask(
  db: Database,
  input: {
    title: string
    projectId?: ID | null
    parentId?: ID | null
    status?: TaskStatus
    priority?: Priority
    notes?: string
    sessionId?: ID | null
  },
): Task {
  const now = Date.now()
  const status = input.status ?? 'inbox'
  const siblings = db.tasks.filter((t) => t.status === status)
  const task: Task = {
    id: newId('tsk'),
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    title: input.title.trim() || '無題のタスク',
    notes: input.notes ?? '',
    status,
    progress: 0,
    priority: input.priority ?? 'normal',
    order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    createdInSessionId: input.sessionId ?? null,
  }
  db.tasks.push(task)
  return task
}

export function updateTask(db: Database, id: ID, patch: Partial<Task>): void {
  const t = db.tasks.find((x) => x.id === id)
  if (!t) return
  const nextStatus = patch.status ?? t.status
  Object.assign(t, patch, { id: t.id, updatedAt: Date.now() })
  if (nextStatus === 'done' && t.doneAt === null) {
    t.doneAt = Date.now()
    if (patch.progress === undefined) t.progress = 100
  }
  if (nextStatus !== 'done') t.doneAt = null
  t.progress = Math.max(0, Math.min(100, Math.round(t.progress)))
}

/** 列をまたぐ移動と並び替え。移動先の列だけ order を振り直す。 */
export function moveTask(db: Database, id: ID, status: TaskStatus, index: number): void {
  const task = db.tasks.find((t) => t.id === id)
  if (!task) return
  const from = task.status
  updateTask(db, id, { status })
  const column = db.tasks
    .filter((t) => t.status === status && t.id !== id)
    .sort((a, b) => a.order - b.order)
  const clamped = Math.max(0, Math.min(index, column.length))
  column.splice(clamped, 0, task)
  column.forEach((t, i) => {
    t.order = i
  })
  if (from !== status) {
    db.tasks
      .filter((t) => t.status === from)
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => {
        t.order = i
      })
  }
}

export function descendantIds(db: Database, id: ID): ID[] {
  const out: ID[] = []
  const walk = (parentId: ID) => {
    for (const t of db.tasks) {
      if (t.parentId === parentId) {
        out.push(t.id)
        walk(t.id)
      }
    }
  }
  walk(id)
  return out
}

export function deleteTask(db: Database, id: ID): void {
  const ids = new Set([id, ...descendantIds(db, id)])
  db.tasks = db.tasks.filter((t) => !ids.has(t.id))
}

/** タスクが実績時間を持つか（削除確認の材料）。 */
export function hasRecordedTime(db: Database, id: ID): boolean {
  return db.sessions.some((s) => s.segments.some((seg) => seg.taskId === id))
}

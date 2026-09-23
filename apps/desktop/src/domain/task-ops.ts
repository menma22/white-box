/**
 * Project / Task の変更。session-ops と同じく、すべて「新しい値を返す」純関数（テスト対象）。
 * 受け取った Database は読むだけで書き換えない。配列の差し替えは呼び出し側が行う。
 *
 * タスクを消してもセッションの記録は消さない（過去を書き換えないため）。
 */
import type { Database, ID, Priority, Project, Task, TaskStatus } from '@white-box/core/types'
import { newId } from './session-ops.js'

export function createProject(db: Database, input: { name: string; hue?: number }): { projects: Project[]; project: Project } {
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
  return { projects: [...db.projects, project], project }
}

export function updateProject(db: Database, id: ID, patch: Partial<Project>): Project[] {
  return db.projects.map((p) => (p.id === id ? { ...p, ...patch, id: p.id, updatedAt: Date.now() } : p))
}

export function deleteProject(db: Database, id: ID): { projects: Project[]; tasks: Task[] } {
  return {
    projects: db.projects.filter((p) => p.id !== id),
    tasks: db.tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
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
): { tasks: Task[]; task: Task } {
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
  return { tasks: [...db.tasks, task], task }
}

export function updateTask(db: Database, id: ID, patch: Partial<Task>): Task[] {
  return db.tasks.map((t) => {
    if (t.id !== id) return t
    const now = Date.now()
    const nextStatus = patch.status ?? t.status
    const merged: Task = { ...t, ...patch, id: t.id, updatedAt: now }
    if (nextStatus === 'done' && merged.doneAt === null) {
      merged.doneAt = now
      if (patch.progress === undefined) merged.progress = 100
    }
    if (nextStatus !== 'done') merged.doneAt = null
    merged.progress = Math.max(0, Math.min(100, Math.round(merged.progress)))
    return merged
  })
}

/** 列をまたぐ移動と並び替え。移動先の列（と、列が変わるときは移動元の列）の order を振り直す。 */
export function moveTask(db: Database, id: ID, status: TaskStatus, index: number): Task[] {
  const target = db.tasks.find((t) => t.id === id)
  if (!target) return db.tasks
  const from = target.status
  const tasks = updateTask(db, id, { status })
  const moved = tasks.find((t) => t.id === id)!

  const column = tasks.filter((t) => t.status === status && t.id !== id).sort((a, b) => a.order - b.order)
  const clamped = Math.max(0, Math.min(index, column.length))
  column.splice(clamped, 0, moved)
  const orderById = new Map(column.map((t, i) => [t.id, i]))

  if (from !== status) {
    tasks
      .filter((t) => t.status === from && t.id !== id)
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => orderById.set(t.id, i))
  }
  return tasks.map((t) => (orderById.has(t.id) ? { ...t, order: orderById.get(t.id)! } : t))
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

export function deleteTask(db: Database, id: ID): Task[] {
  const ids = new Set([id, ...descendantIds(db, id)])
  return db.tasks.filter((t) => !ids.has(t.id))
}

/** タスクが実績時間を持つか（削除確認の材料）。 */
export function hasRecordedTime(db: Database, id: ID): boolean {
  return db.sessions.some((s) => s.segments.some((seg) => seg.taskId === id))
}

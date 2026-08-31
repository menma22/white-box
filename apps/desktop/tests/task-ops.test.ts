import { describe, expect, it } from 'vitest'
import type { Database, Task } from '@white-box/core/types'
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  hasRecordedTime,
  moveTask,
  updateTask,
} from '../src/domain/task-ops.js'

function emptyDb(): Database {
  return {
    version: 1,
    projects: [],
    tasks: [],
    sessions: [],
    settings: {
      displayName: '',
      defaultSessionMinutes: 50,
      defaultExtendMinutes: 15,
      extendOptions: [5, 10, 15],
      shortcuts: { startPause: '', currentWork: '', dashboard: '' },
      launchAtLogin: false,
      autoPauseOnSuspend: true,
      soundOnExpire: true,
      dayStartHour: 4,
      lastWelcomeDate: null,
      stallWarningDays: 3,
      showSessionCard: true,
      onboardedAt: null,
    },
    dayNotes: {},
  }
}

function withTasks(...tasks: Task[]): Database {
  const db = emptyDb()
  db.tasks = tasks
  return db
}

function task(over: Partial<Task> & { id: string }): Task {
  return {
    projectId: null,
    parentId: null,
    title: over.id,
    notes: '',
    status: 'todo',
    progress: 0,
    priority: 'normal',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    doneAt: null,
    createdInSessionId: null,
    ...over,
  }
}

describe('task-ops は新しい値を返す（呼び出し元の Database を書き換えない）', () => {
  it('createTask は追加後の配列と作ったタスクを返し、元の配列を触らない', () => {
    const db = withTasks(task({ id: 'a', status: 'inbox', order: 0 }))
    const before = db.tasks
    const r = createTask(db, { title: '新しい仕事' })
    expect(db.tasks).toBe(before)
    expect(db.tasks).toHaveLength(1)
    expect(r.tasks).toHaveLength(2)
    expect(r.task.title).toBe('新しい仕事')
    expect(r.task.status).toBe('inbox')
    expect(r.task.order).toBe(1) // 同じ列の末尾（既存 order 0 の次）
  })

  it('updateTask で done にすると doneAt が入り、progress 未指定なら 100 になる', () => {
    const db = withTasks(task({ id: 'a', progress: 40 }))
    const tasks = updateTask(db, 'a', { status: 'done' })
    const a = tasks.find((t) => t.id === 'a')!
    expect(a.doneAt).not.toBeNull()
    expect(a.progress).toBe(100)
    expect(db.tasks[0]!.doneAt).toBeNull() // 元は不変
  })

  it('updateTask で done から戻すと doneAt が消える', () => {
    const db = withTasks(task({ id: 'a', status: 'done', progress: 100, doneAt: 123 }))
    const tasks = updateTask(db, 'a', { status: 'todo' })
    expect(tasks.find((t) => t.id === 'a')!.doneAt).toBeNull()
  })

  it('updateTask は progress を 0〜100 に丸める', () => {
    const db = withTasks(task({ id: 'a' }))
    expect(updateTask(db, 'a', { progress: 250 }).find((t) => t.id === 'a')!.progress).toBe(100)
    expect(updateTask(db, 'a', { progress: -5 }).find((t) => t.id === 'a')!.progress).toBe(0)
  })

  it('moveTask は移動先の列を挿入位置で振り直し、移動元の列も詰め直す', () => {
    const db = withTasks(
      task({ id: 't0', status: 'todo', order: 0 }),
      task({ id: 't1', status: 'todo', order: 1 }),
      task({ id: 'd0', status: 'doing', order: 0 }),
    )
    const tasks = moveTask(db, 't0', 'doing', 0)
    const byId = new Map(tasks.map((t) => [t.id, t]))
    expect(byId.get('t0')!.status).toBe('doing')
    expect(byId.get('t0')!.order).toBe(0)
    expect(byId.get('d0')!.order).toBe(1) // 先頭に割り込まれて 1 つ下がる
    expect(byId.get('t1')!.order).toBe(0) // 移動元は詰め直される
  })

  it('moveTask の挿入位置は列の長さでクランプされる', () => {
    const db = withTasks(task({ id: 'a', status: 'todo', order: 0 }), task({ id: 'b', status: 'doing', order: 0 }))
    const tasks = moveTask(db, 'a', 'doing', 999)
    expect(tasks.find((t) => t.id === 'a')!.order).toBe(1) // 末尾
  })

  it('deleteTask は子孫タスクごと消す', () => {
    const db = withTasks(
      task({ id: 'p' }),
      task({ id: 'c1', parentId: 'p' }),
      task({ id: 'gc', parentId: 'c1' }),
      task({ id: 'other' }),
    )
    const tasks = deleteTask(db, 'p')
    expect(tasks.map((t) => t.id)).toEqual(['other'])
    expect(db.tasks).toHaveLength(4) // 元は不変
  })

  it('createProject は未使用の色相を選び、deleteProject はタスクの紐付けだけ外す', () => {
    const db = emptyDb()
    const r1 = createProject(db, { name: 'A' })
    const r2 = createProject({ ...db, projects: r1.projects }, { name: 'B' })
    expect(r1.project.hue).not.toBe(r2.project.hue)

    const db2 = withTasks(task({ id: 'a', projectId: r1.project.id }))
    db2.projects = r2.projects
    const r3 = deleteProject(db2, r1.project.id)
    expect(r3.projects.map((p) => p.id)).toEqual([r2.project.id])
    expect(r3.tasks[0]!.projectId).toBeNull()
    expect(db2.tasks[0]!.projectId).toBe(r1.project.id) // 元は不変
  })

  it('hasRecordedTime はセッションの区間にタスクが現れるかで判定する', () => {
    const db = withTasks(task({ id: 'a' }))
    expect(hasRecordedTime(db, 'a')).toBe(false)
    db.sessions = [
      {
        id: 's',
        startedAt: 0,
        endedAt: 1,
        plannedMs: 1,
        state: 'ended',
        segments: [{ id: 'seg', taskId: 'a', startedAt: 0, endedAt: 1 }],
        pauses: [],
        events: [],
        progressChanges: [],
        note: '',
        expiredNotifiedAt: null,
        editedAt: null,
        createdAt: 0,
      },
    ]
    expect(hasRecordedTime(db, 'a')).toBe(true)
  })
})

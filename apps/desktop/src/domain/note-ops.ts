import type { Database } from '@white-box/core/types'
import type { Note, NoteCreateInput, NotePatch } from '@white-box/core/notes'

function requireNote(db: Database, id: string): Note {
  const note = db.notes?.find((item) => item.id === id)
  if (!note) throw new Error('ノートが見つからない')
  return note
}

function links(db: Database, input: NotePatch, previous?: Note): { projectId: string | null; taskId: string | null } {
  let projectId = input.projectId !== undefined ? input.projectId : previous?.projectId ?? null
  const taskId = input.taskId !== undefined ? input.taskId : previous?.taskId ?? null
  if (input.projectId != null && !db.projects.some((project) => project.id === input.projectId)) throw new Error('プロジェクトが見つからない')
  if (input.taskId != null) {
    const task = db.tasks.find((item) => item.id === input.taskId)
    if (!task) throw new Error('タスクが見つからない')
    if (input.projectId !== undefined && input.projectId !== task.projectId) throw new Error('タスクのプロジェクトと一致しない')
    projectId = task.projectId
  } else if (input.projectId !== undefined && taskId !== null) {
    const task = db.tasks.find((item) => item.id === taskId)
    if (task && task.projectId !== projectId) throw new Error('関連するタスクを外してからプロジェクトを変更する')
  }
  return { projectId, taskId }
}


export function createNote(db: Database, input: NoteCreateInput, now: number, id: string): { note: Note; notes: Note[] } {
  const note: Note = {
    id,
    title: input.title ?? '',
    body: input.body ?? '',
    ...links(db, input),
    pinned: input.pinned ?? false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  }
  return { note, notes: [...(db.notes ?? []), note] }
}

export function updateNote(db: Database, id: string, patch: NotePatch, now: number): Note[] {
  const previous = requireNote(db, id)
  const clean = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as NotePatch
  const next = {
    ...previous, ...clean, ...links(db, clean, previous), updatedAt: now,
  }
  return db.notes!.map((note) => note.id === id ? next : note)
}

export function archiveNote(db: Database, id: string, archived: boolean, now: number): Note[] {
  requireNote(db, id)
  return db.notes!.map((note) => note.id === id ? { ...note, archived, updatedAt: now } : note)
}

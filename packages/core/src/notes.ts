import type { ID } from './types.js'

export interface Note {
  id: ID
  title: string
  body: string
  projectId: ID | null
  taskId: ID | null
  pinned: boolean
  archived: boolean
  remindAt: number | null
  remindedAt: number | null
  createdAt: number
  updatedAt: number
}

export type NoteCreateInput = Partial<Pick<Note, 'title' | 'body' | 'projectId' | 'taskId' | 'pinned' | 'remindAt'>>
export type NotePatch = Partial<Pick<Note, 'title' | 'body' | 'projectId' | 'taskId' | 'pinned' | 'remindAt'>>

export interface NoteQuery {
  query?: string
  projectId?: ID | null
  pinnedOnly?: boolean
  archived?: boolean
}

export function noteTitle(note: Pick<Note, 'title' | 'body'>): string {
  return note.title.trim() || note.body.trim().split('\n')[0]?.slice(0, 80) || '無題のノート'
}

export function selectNotes(notes: readonly Note[] | undefined, filter: NoteQuery = {}): Note[] {
  const terms = (filter.query ?? '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return (notes ?? []).filter((note) => {
    if (note.archived !== (filter.archived ?? false)) return false
    if (filter.projectId !== undefined && note.projectId !== filter.projectId) return false
    if (filter.pinnedOnly && !note.pinned) return false
    const content = `${note.title}\n${note.body}`.normalize('NFKC').toLocaleLowerCase()
    return terms.every((term) => content.includes(term))
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

export function selectDueNotes(notes: readonly Note[] | undefined, now: number): Note[] {
  return (notes ?? []).filter((note) => !note.archived && note.remindAt !== null && note.remindAt <= now && note.remindedAt === null)
    .sort((a, b) => a.remindAt! - b.remindAt! || a.id.localeCompare(b.id))
}

export function selectVisibleReminders(notes: readonly Note[] | undefined, now: number): Note[] {
  const due = (note: Note) => note.remindAt !== null && note.remindAt <= now
  return (notes ?? []).filter((note) => !note.archived && (note.pinned || note.remindAt !== null))
    .sort((a, b) => Number(due(b)) - Number(due(a)) || Number(b.pinned) - Number(a.pinned)
      || (a.remindAt ?? Infinity) - (b.remindAt ?? Infinity) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

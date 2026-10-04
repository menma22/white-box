import type { ID } from './types.js'

export interface Note {
  id: ID
  title: string
  body: string
  projectId: ID | null
  taskId: ID | null
  pinned: boolean
  archived: boolean
  createdAt: number
  updatedAt: number
}

export type NoteCreateInput = Partial<Pick<Note, 'title' | 'body' | 'projectId' | 'taskId' | 'pinned'>>
export type NotePatch = Partial<Pick<Note, 'title' | 'body' | 'projectId' | 'taskId' | 'pinned'>>

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

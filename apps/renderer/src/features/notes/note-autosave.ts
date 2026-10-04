import type { Note, NotePatch } from '@white-box/core/notes'

export type NoteDraft = Required<NotePatch>
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export interface NoteDraftState { draft: NoteDraft; status: SaveStatus; error: string }

const fields = ['title', 'body', 'projectId', 'taskId', 'pinned', 'remindAt'] as const

export function noteDraft(note: Note): NoteDraft {
  return { title: note.title, body: note.body, projectId: note.projectId, taskId: note.taskId, pinned: note.pinned, remindAt: note.remindAt }
}

function difference(draft: NoteDraft, saved: NoteDraft): NotePatch {
  return Object.fromEntries(fields.filter((key) => draft[key] !== saved[key]).map((key) => [key, draft[key]])) as NotePatch
}

export class NoteAutosave {
  private draft: NoteDraft
  private saved: NoteDraft
  private status: SaveStatus = 'saved'
  private error = ''
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<boolean> | null = null
  private pending: NotePatch | null = null
  private listener: ((state: NoteDraftState) => void) | null = null

  constructor(note: Note, private save: (patch: NotePatch) => Promise<unknown>, private delay = 600) {
    this.draft = noteDraft(note)
    this.saved = noteDraft(note)
  }

  snapshot(): NoteDraftState { return { draft: { ...this.draft }, status: this.status, error: this.error } }

  subscribe(listener: (state: NoteDraftState) => void): () => void {
    this.listener = listener
    return () => { this.listener = null }
  }

  private emit(): void { this.listener?.(this.snapshot()) }

  receive(note: Note): void {
    const incoming = noteDraft(note)
    const clean = Object.fromEntries(fields.filter((key) => this.draft[key] === this.saved[key] && !(this.pending && key in this.pending)).map((key) => [key, incoming[key]]))
    this.draft = { ...this.draft, ...clean }
    this.saved = incoming
    if (!this.running && this.status !== 'error') this.status = Object.keys(difference(this.draft, this.saved)).length ? 'dirty' : 'saved'
    this.emit()
  }

  update(patch: NotePatch): void {
    this.draft = { ...this.draft, ...patch }
    this.error = ''
    this.status = this.running ? 'saving' : 'dirty'
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.delay)
    this.emit()
  }

  flush(): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.running) return this.running
    if (!Object.keys(difference(this.draft, this.saved)).length) {
      this.status = 'saved'
      this.error = ''
      this.emit()
      return Promise.resolve(true)
    }
    this.running = this.saveAll().finally(() => { this.running = null })
    return this.running
  }

  private async saveAll(): Promise<boolean> {
    this.status = 'saving'
    this.error = ''
    this.emit()
    try {
      let patch = difference(this.draft, this.saved)
      while (Object.keys(patch).length) {
        this.pending = patch
        await this.save(patch)
        this.saved = { ...this.saved, ...patch }
        this.pending = null
        patch = difference(this.draft, this.saved)
      }
      this.status = 'saved'
      this.emit()
      return true
    } catch (cause) {
      this.pending = null
      this.status = 'error'
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.emit()
      return false
    }
  }
}

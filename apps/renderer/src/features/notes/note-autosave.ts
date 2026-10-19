import type { Note, NotePatch } from '@white-box/core/notes'

export type NoteDraft = Required<NotePatch>
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'
export interface NoteDraftState { draft: NoteDraft; status: SaveStatus; error: string; conflicts: NotePatch }

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
  private pendingExpected: NotePatch | null = null
  private conflicts: NotePatch = {}
  private listener: ((state: NoteDraftState) => void) | null = null

  constructor(note: Note, private save: (patch: NotePatch) => Promise<unknown>, private delay = 600) {
    this.draft = noteDraft(note)
    this.saved = noteDraft(note)
  }

  snapshot(): NoteDraftState { return { draft: { ...this.draft }, status: this.status, error: this.error, conflicts: { ...this.conflicts } } }

  subscribe(listener: (state: NoteDraftState) => void): () => void {
    this.listener = listener
    return () => { this.listener = null }
  }

  private emit(): void { this.listener?.(this.snapshot()) }
  private stopTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }
  private hasConflicts(): boolean { return Object.keys(this.conflicts).length > 0 }
  private showConflict(): void {
    this.stopTimer()
    this.status = 'error'
    this.error = '別の画面で同じ項目が変更された。両方の内容を確認してから保存してください'
  }

  expected(patch: NotePatch): NotePatch {
    return Object.fromEntries(fields.filter((key) => key in patch).map((key) => [key, this.pendingExpected && key in this.pendingExpected ? this.pendingExpected[key] : this.saved[key]])) as NotePatch
  }

  receive(note: Note): void {
    const incoming = noteDraft(note)
    for (const key of fields) {
      const pending = this.pending && key in this.pending
      const own = pending && incoming[key] === this.pending![key]
      if (incoming[key] === this.draft[key]) Reflect.deleteProperty(this.conflicts, key)
      else if (incoming[key] !== this.saved[key] && !own && (this.draft[key] !== this.saved[key] || pending)) {
        this.conflicts = { ...this.conflicts, [key]: incoming[key] }
      }
    }
    const clean = Object.fromEntries(fields.filter((key) => this.draft[key] === this.saved[key] && !(this.pending && key in this.pending)).map((key) => [key, incoming[key]]))
    this.draft = { ...this.draft, ...clean }
    this.saved = incoming
    if (this.hasConflicts()) this.showConflict()
    else if (!this.running && this.status !== 'error') this.status = Object.keys(difference(this.draft, this.saved)).length ? 'dirty' : 'saved'
    this.emit()
  }

  update(patch: NotePatch): void {
    this.draft = { ...this.draft, ...patch }
    for (const key of fields) if (this.draft[key] === this.saved[key]) Reflect.deleteProperty(this.conflicts, key)
    this.error = ''
    this.status = this.running ? 'saving' : 'dirty'
    this.stopTimer()
    if (this.hasConflicts()) this.showConflict()
    else this.timer = setTimeout(() => { this.timer = null; void this.flush() }, this.delay)
    this.emit()
  }

  retry(): Promise<boolean> {
    if (this.running) return this.running.then(() => this.retry())
    this.conflicts = {}
    return this.flush()
  }

  acceptLatest(): Promise<boolean> {
    if (this.running) return this.running.then(() => this.acceptLatest())
    this.draft = { ...this.draft, ...Object.fromEntries(fields.filter((key) => key in this.conflicts).map((key) => [key, this.saved[key]])) }
    this.conflicts = {}
    return this.flush()
  }

  flush(): Promise<boolean> {
    this.stopTimer()
    if (this.running) return this.running
    if (this.hasConflicts()) { this.showConflict(); this.emit(); return Promise.resolve(false) }
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
        this.pendingExpected = this.expected(patch)
        const expected = this.pendingExpected
        await this.save(patch)
        this.saved = { ...this.saved, ...Object.fromEntries(fields.filter((key) => key in patch && (this.saved[key] === expected[key] || this.saved[key] === patch[key])).map((key) => [key, patch[key]])) }
        this.pending = null
        this.pendingExpected = null
        if (this.hasConflicts()) { this.showConflict(); this.emit(); return false }
        patch = difference(this.draft, this.saved)
      }
      this.status = 'saved'
      this.emit()
      return true
    } catch (cause) {
      this.pending = null
      this.pendingExpected = null
      this.status = 'error'
      this.error = cause instanceof Error ? cause.message : String(cause)
      this.emit()
      return false
    }
  }
}

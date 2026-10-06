export interface TaskTitleDraftState { draft: string; error: string; saving: boolean; flushing: boolean; conflict: string | null }

export class TaskTitleDraft {
  private saved: string
  private draft: string
  private error = ''
  private editing = false
  private conflict: string | null = null
  private pending: { title: string; expected: string } | null = null
  private running: Promise<boolean> | null = null
  private flushingRequest: Promise<boolean> | null = null
  private flushing = false
  private listener: ((state: TaskTitleDraftState) => void) | null = null

  constructor(value: string, private onSave: (title: string, expected: string) => Promise<unknown>) { this.saved = value; this.draft = value }
  snapshot(): TaskTitleDraftState { return { draft: this.draft, error: this.error, saving: this.running !== null, flushing: this.flushing, conflict: this.conflict } }
  subscribe(listener: (state: TaskTitleDraftState) => void): () => void { this.listener = listener; return () => { this.listener = null } }
  private emit() { this.listener?.(this.snapshot()) }
  private showConflict() { this.error = '別の画面でタスク名が変更された。両方の内容を確認してから保存してください' }

  receive(value: string): void {
    const dirty = this.draft.trim() !== this.saved
    const own = this.pending?.title === value
    if (value === this.draft.trim()) this.conflict = null
    else if (value !== this.saved && !own && (dirty || this.pending)) { this.conflict = value; this.showConflict() }
    if (!dirty && !this.pending) this.draft = value
    this.saved = value
    this.emit()
  }
  focus(editing: boolean): void {
    this.editing = editing
    if (!editing && !this.running && this.draft.trim() === this.saved) this.draft = this.saved
    this.emit()
  }
  update(draft: string): void {
    if (this.flushing) return
    this.draft = draft
    if (draft.trim() === this.saved) this.conflict = null
    this.error = ''
    if (this.conflict !== null) this.showConflict()
    this.emit()
  }

  save(): Promise<boolean> {
    if (this.running) return this.running
    if (this.conflict !== null) { this.showConflict(); this.emit(); return Promise.resolve(false) }
    if (this.draft === this.saved) { this.error = ''; this.emit(); return Promise.resolve(true) }
    if (!this.draft.trim()) { this.draft = this.saved; this.error = ''; this.emit(); return Promise.resolve(true) }
    if (this.draft.trim() === this.saved) { this.error = ''; this.emit(); return Promise.resolve(true) }
    this.running = this.saveAll().finally(() => { this.running = null; this.emit() })
    this.emit()
    return this.running
  }
  private async saveAll(): Promise<boolean> {
    this.error = ''
    try {
      for (let title = this.draft.trim(); title !== this.saved; title = this.draft.trim()) {
        if (!title) { this.draft = this.saved; this.error = ''; this.emit(); return true }
        const pending = { title, expected: this.saved }
        this.pending = pending
        if (await this.onSave(title, pending.expected) === false) throw new Error('タスク名を保存できなかった')
        if (this.saved === pending.expected || this.saved === title) this.saved = title
        this.pending = null
        if (this.conflict !== null) { this.showConflict(); return false }
        if (!this.editing && this.draft.trim() === title) this.draft = title
      }
      return true
    } catch (cause) { this.error = cause instanceof Error ? cause.message : String(cause); return false }
    finally { this.pending = null }
  }
  flush(): Promise<boolean> {
    if (this.flushingRequest) return this.flushingRequest
    this.flushing = true
    this.flushingRequest = this.save().finally(() => { this.flushingRequest = null; this.flushing = false; this.emit() })
    this.emit()
    return this.flushingRequest
  }
  retry(): Promise<boolean> {
    if (this.running) return this.running.then(() => this.retry())
    this.conflict = null
    return this.flush()
  }
  acceptLatest(): Promise<boolean> {
    if (this.running) return this.running.then(() => this.acceptLatest())
    this.draft = this.saved
    this.conflict = null
    return this.flush()
  }
}

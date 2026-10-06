export interface OptionalDurationDraftState { draft: string; unit: number; error: string; saving: boolean; flushing: boolean }

export class OptionalDurationDraft {
  private saved: number | null
  private draft: string
  private unit = 1
  private error = ''
  private editing = false
  private badInput = false
  private running: Promise<boolean> | null = null
  private flushingRequest: Promise<boolean> | null = null
  private flushing = false
  private listener: ((state: OptionalDurationDraftState) => void) | null = null

  constructor(value: number | null | undefined, private onSave: (minutes: number | null) => Promise<unknown>) {
    this.saved = value ?? null
    this.draft = value == null ? '' : String(value)
  }

  snapshot(): OptionalDurationDraftState { return { draft: this.draft, unit: this.unit, error: this.error, saving: this.running !== null, flushing: this.flushing } }
  subscribe(listener: (state: OptionalDurationDraftState) => void): () => void { this.listener = listener; return () => { this.listener = null } }
  private emit() { this.listener?.(this.snapshot()) }
  private minutes(): number | null | undefined {
    const value = this.draft.trim() === '' ? null : Number(this.draft) * this.unit
    return this.badInput || value !== null && (!Number.isFinite(value) || value < 0) ? undefined : value
  }

  receive(value: number | null | undefined): void {
    const clean = !this.editing && !this.running && !this.flushing && this.minutes() === this.saved
    this.saved = value ?? null
    if (clean) this.draft = value == null ? '' : String(value / this.unit)
    this.emit()
  }
  focus(editing: boolean) { this.editing = editing }
  update(draft: string, badInput = false): void {
    if (this.flushing) return
    this.draft = draft
    this.badInput = badInput
    this.error = ''
    this.emit()
  }
  changeUnit(unit: number): void {
    if (this.flushing) return
    const minutes = this.minutes()
    if (minutes === undefined) return
    this.unit = unit
    this.draft = minutes === null ? '' : String(minutes / unit)
    this.emit()
  }

  save(): Promise<boolean> {
    if (this.running) return this.running
    if (this.minutes() === undefined) { this.error = '0 以上の数値か、空欄にする'; this.emit(); return Promise.resolve(false) }
    if (this.minutes() === this.saved) { this.error = ''; this.emit(); return Promise.resolve(true) }
    this.running = this.saveAll().finally(() => { this.running = null; this.emit() })
    this.emit()
    return this.running
  }
  private async saveAll(): Promise<boolean> {
    this.error = ''
    try {
      for (let minutes = this.minutes(); minutes !== this.saved; minutes = this.minutes()) {
        if (minutes === undefined) throw new Error('0 以上の数値か、空欄にする')
        await this.onSave(minutes)
        this.saved = minutes
      }
      return true
    } catch (cause) { this.error = cause instanceof Error ? cause.message : String(cause); return false }
  }
  flush(): Promise<boolean> {
    if (this.flushingRequest) return this.flushingRequest
    this.flushing = true
    this.flushingRequest = this.save().finally(() => { this.flushingRequest = null; this.flushing = false; this.emit() })
    this.emit()
    return this.flushingRequest
  }
}

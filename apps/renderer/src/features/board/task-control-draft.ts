import type { ExternalBlock } from '@white-box/core/types'
import type { TaskControl } from '@white-box/core/task-control'

export interface TaskControlDraftState { reason: string; externalSaving: boolean; externalFailed: boolean; flushing: boolean }

export class TaskControlDraft {
  private savedReason: string
  private reason: string
  private reasonFailed = false
  private reasonRunning: Promise<boolean> | null = null
  private externalRunning: Promise<boolean> | null = null
  private externalFailed = false
  private flushing = false
  private flushingRequest: Promise<boolean> | null = null
  private listener: ((state: TaskControlDraftState) => void) | null = null

  constructor(reason: string | undefined, private onSave: (patch: TaskControl) => Promise<boolean>) {
    this.savedReason = this.reason = reason ?? ''
  }

  snapshot(): TaskControlDraftState { return { reason: this.reason, externalSaving: this.externalRunning !== null, externalFailed: this.externalFailed, flushing: this.flushing } }
  subscribe(listener: (state: TaskControlDraftState) => void): () => void { this.listener = listener; return () => { this.listener = null } }
  private emit() { this.listener?.(this.snapshot()) }

  receiveReason(reason: string | undefined): void {
    const clean = this.reason === this.savedReason && !this.reasonFailed && !this.reasonRunning
    this.savedReason = reason ?? ''
    if (clean) this.reason = this.savedReason
    this.emit()
  }
  updateReason(reason: string): void {
    if (this.flushing) return
    this.reason = reason
    this.reasonFailed = false
    this.emit()
  }
  saveReason(): Promise<boolean> {
    if (this.reasonRunning) return this.reasonRunning
    if (this.reason === this.savedReason) { this.reasonFailed = false; return Promise.resolve(true) }
    this.reasonRunning = this.saveReasons().finally(() => { this.reasonRunning = null; this.emit() })
    return this.reasonRunning
  }
  private async saveReasons(): Promise<boolean> {
    try {
      while (this.reason !== this.savedReason) {
        const reason = this.reason
        const before = this.savedReason
        if (!await this.onSave({ blockReason: reason })) { this.reasonFailed = true; return false }
        this.reasonFailed = false
        if (this.savedReason === before || this.savedReason === reason) this.savedReason = reason
      }
      return true
    } catch { this.reasonFailed = true; return false }
  }

  submitExternal(external: ExternalBlock): Promise<boolean> {
    if (this.externalRunning) return this.externalRunning
    this.externalFailed = false
    this.externalRunning = this.onSave({ externalBlock: external }).then((saved) => {
      this.externalFailed = !saved
      return saved
    }, () => { this.externalFailed = true; return false }).finally(() => { this.externalRunning = null; this.emit() })
    this.emit()
    return this.externalRunning
  }
  cancelExternal(): void {
    if (this.externalRunning || this.flushing) return
    this.externalFailed = false
    this.emit()
  }

  flush(): Promise<boolean> {
    if (this.flushingRequest) return this.flushingRequest
    this.flushing = true
    this.flushingRequest = Promise.all([this.saveReason(), this.externalRunning ?? Promise.resolve(!this.externalFailed)])
      .then((saved) => saved.every(Boolean)).finally(() => { this.flushingRequest = null; this.flushing = false; this.emit() })
    this.emit()
    return this.flushingRequest
  }
}

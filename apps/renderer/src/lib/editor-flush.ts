export interface EditorFlushState { frozen: boolean; error: string }

export class EditorFlush {
  private pending = new Set<string>()
  private error = ''
  constructor(private flush: () => Promise<boolean>, private changed: (state: EditorFlushState) => void) {}
  snapshot(): EditorFlushState { return { frozen: this.pending.size > 0, error: this.error } }
  private emit() { this.changed(this.snapshot()) }

  async prepare(id: string): Promise<boolean> {
    this.pending.add(id)
    this.error = ''
    this.emit()
    try {
      const ok = await this.flush()
      if (!ok) {
        this.pending.delete(id)
        this.error = '保存できなかった。入力を保持して、この画面を開いたままにしている。'
        this.emit()
      }
      return ok
    } catch (cause) {
      this.pending.delete(id)
      this.error = `保存できなかった。${cause instanceof Error ? cause.message : String(cause)} 入力は残っている。`
      this.emit()
      return false
    }
  }

  release(id: string) { this.pending.delete(id); this.emit() }

  async run(id: string, action: () => void | Promise<void>): Promise<boolean> {
    if (this.pending.size) return false
    try {
      if (!await this.prepare(id)) return false
      await action()
      return true
    } finally { this.release(id) }
  }
}

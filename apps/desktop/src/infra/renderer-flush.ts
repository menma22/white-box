import { randomUUID } from 'node:crypto'
import type { WindowKind } from '@white-box/core/types'

export type FlushReason = 'close' | 'quit' | 'end' | 'switch' | 'import'
export type ReleaseEditors = (closing?: WindowKind[]) => void
export interface FlushTarget {
  id: number
  kind: WindowKind
  send(channel: string, payload: unknown): void
  onClosed(callback: () => void): () => void
  focus(): void
}

export class RendererFlush {
  private ready = new Set<number>()
  private readyCleanup = new Map<number, () => void>()
  private pending = new Map<string, { target: FlushTarget; finish(ok: boolean, focus?: boolean): void }>()

  constructor(private targets: (kinds?: WindowKind[]) => FlushTarget[], private timeoutMs = 10_000) {}

  setReady(id: number, ready: boolean): void {
    if (ready) {
      if (this.ready.has(id)) return
      const target = this.targets().find((item) => item.id === id)
      if (!target) return
      this.ready.add(id)
      this.readyCleanup.set(id, target.onClosed(() => this.setReady(id, false)))
    } else {
      this.ready.delete(id)
      this.readyCleanup.get(id)?.()
      this.readyCleanup.delete(id)
    }
  }

  reply(senderId: number, value: unknown): void {
    if (!value || typeof value !== 'object') return
    const reply = value as { id?: unknown; ok?: unknown }
    if (typeof reply.id !== 'string' || typeof reply.ok !== 'boolean') return
    const pending = this.pending.get(reply.id)
    if (pending?.target.id === senderId) pending.finish(reply.ok)
  }

  async prepare(reason: FlushReason, kinds?: WindowKind[]): Promise<ReleaseEditors> {
    const tickets = this.targets(kinds).filter((target) => this.ready.has(target.id)).map((target) => ({ target, id: randomUUID() }))
    const release: ReleaseEditors = (closing = []) => {
      for (const { target, id } of tickets) {
        const unlock = () => target.send('whitebox:flush-release', id)
        if (closing.includes(target.kind)) target.onClosed(unlock)
        else unlock()
      }
    }
    try {
      await Promise.all(tickets.map(({ target, id }) => new Promise<void>((resolve, reject) => {
        let done = false
        let unsubscribe = () => {}
        const finish = (ok: boolean, focus = true) => {
          if (done) return
          done = true
          clearTimeout(timer)
          unsubscribe()
          this.pending.delete(id)
          if (ok) resolve()
          else {
            if (focus) target.focus()
            reject(new Error('入力を保存できなかったため、操作を取り消しました。入力のある画面で保存を確認してください。'))
          }
        }
        const timer = setTimeout(() => finish(false), this.timeoutMs)
        unsubscribe = target.onClosed(() => { this.ready.delete(target.id); finish(false) })
        this.pending.set(id, { target, finish })
        try { target.send('whitebox:flush-request', { id, reason }) }
        catch { finish(false) }
      })))
      return release
    } catch (cause) {
      for (const { id } of tickets) this.pending.get(id)?.finish(false, false)
      release()
      throw cause
    }
  }
}

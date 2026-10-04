import { Notification } from 'electron'
import { selectDueNotes } from '@white-box/core/notes'
import type { Ctx } from '../app/ports.js'
import { markNoteReminded } from '../domain/note-ops.js'

export function createNoteReminders(ctx: Ctx) {
  let stopped = false
  const notices = new Set<Notification>()
  const retries = new Map<string, { remindAt: number; after: number }>()
  const tick = () => {
    if (stopped || !Notification.isSupported()) return
    for (const note of selectDueNotes(ctx.store.data.notes, ctx.now())) {
      const retry = retries.get(note.id)
      if (retry?.remindAt === note.remindAt && ctx.now() < retry.after) continue
      const markedAt = ctx.now()
      let notice: Notification | undefined
      const failed = (error: unknown) => {
        if (stopped) return
        if (notice) notices.delete(notice)
        retries.set(note.id, { remindAt: note.remindAt!, after: ctx.now() + 60000 })
        const current = ctx.store.data.notes?.find((item) => item.id === note.id)
        if (current?.remindAt === note.remindAt && current.remindedAt === markedAt) {
          ctx.store.data.notes = ctx.store.data.notes!.map((item) => item === current ? { ...item, remindedAt: null } : item)
          try { ctx.publish() } catch (cause) { console.error('[white-box] 通知失敗の保存:', cause) }
        }
        console.error('[white-box] ノート通知:', error)
      }
      try {
        notice = new Notification({ title: note.title || 'White Box のリマインド', body: note.body.slice(0, 240) || '覚えておきたいことがあります。' })
        notices.add(notice)
        notice.on('click', () => { if (!stopped) ctx.windows.open('main') })
        notice.on('close', () => notices.delete(notice!))
        notice.once('failed', (_event, error) => failed(error))
        ctx.store.data.notes = markNoteReminded(ctx.store.data, note.id, note.remindAt!, markedAt)
        ctx.publish()
        notice.show()
      } catch (cause) { failed(cause); notice?.close() }
    }
  }
  const timer = setInterval(tick, 5000)
  tick()
  return {
    stop: () => { stopped = true; clearInterval(timer); for (const notice of notices) notice.close(); notices.clear(); retries.clear() },
  }
}

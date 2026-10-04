import { Notification } from 'electron'
import { selectDueNotes } from '@white-box/core/notes'
import type { Ctx } from '../app/ports.js'
import { markNoteReminded } from '../domain/note-ops.js'

export function createNoteReminders(ctx: Ctx) {
  let stopped = false
  const notices = new Set<Notification>()
  const tick = () => {
    if (stopped || !Notification.isSupported()) return
    for (const note of selectDueNotes(ctx.store.data.notes, ctx.now())) {
      ctx.store.data.notes = markNoteReminded(ctx.store.data, note.id, note.remindAt!, ctx.now())
      ctx.publish()
      const notice = new Notification({ title: note.title || 'White Box のリマインド', body: note.body.slice(0, 240) || '覚えておきたいことがあります。' })
      notices.add(notice)
      notice.on('click', () => ctx.windows.open('main'))
      notice.on('close', () => notices.delete(notice))
      notice.show()
    }
  }
  const timer = setInterval(tick, 5000)
  tick()
  return {
    stop: () => { stopped = true; clearInterval(timer); for (const notice of notices) notice.close() },
  }
}

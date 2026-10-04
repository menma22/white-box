import { Notification } from 'electron'
import { emptyInputActivity, recordInputActivity } from '../app/start-reminder.js'
import { liveSession } from '../app/state.js'
import type { Ctx } from '../app/ports.js'
import { watchInputActivity } from './input-activity.js'

export function createStartReminderService(ctx: Ctx) {
  let activity = emptyInputActivity()
  let stopInput: (() => void) | null = null
  let stopped = false
  const notices = new Set<Notification>()
  const refresh = () => {
    if (stopped) return
    if (ctx.store.data.settings.remindToStart && !stopInput) {
      stopInput = watchInputActivity((count) => {
        const result = recordInputActivity(activity, count, ctx.now(), liveSession(ctx.store.data) !== null, (ctx.store.data.settings.startReminderMinutes ?? 3) * 60_000)
        activity = result.activity
        if (!result.remind || !Notification.isSupported()) return
        const notice = new Notification({ title: '作業を記録しますか？', body: '入力が続いています。セッションを始めると、何に時間を使ったかが残ります。' })
        notices.add(notice)
        notice.on('click', () => ctx.windows.open('start'))
        notice.on('close', () => notices.delete(notice))
        notice.show()
      }, (error) => {
        console.error('[white-box] 入力活動の検知:', error)
        ctx.store.data.settings.remindToStart = false
        ctx.publish()
      })
    } else if (!ctx.store.data.settings.remindToStart && stopInput) {
      stopInput()
      stopInput = null
      activity = emptyInputActivity()
    }
  }
  refresh()
  return {
    refresh,
    stop: () => { stopped = true; stopInput?.(); stopInput = null; for (const notice of notices) notice.close() },
  }
}

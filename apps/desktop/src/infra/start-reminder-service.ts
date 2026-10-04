import { Notification } from 'electron'
import { emptyInputActivity, recordInputActivity } from '../app/start-reminder.js'
import { liveSession } from '../app/state.js'
import type { Ctx } from '../app/ports.js'
import { watchInputActivity } from './input-activity.js'

export function createStartReminderService(ctx: Ctx) {
  let activity = emptyInputActivity()
  let stopInput: (() => void) | null = null
  let stopped = false
  let generation = 0
  const notices = new Set<Notification>()
  const stopWatching = () => {
    generation++
    const stop = stopInput
    stopInput = null
    stop?.()
    activity = emptyInputActivity()
    for (const notice of notices) notice.close()
    notices.clear()
  }
  const refresh = () => {
    if (stopped) return
    if (ctx.store.data.settings.remindToStart && !stopInput) {
      const watching = ++generation
      const active = () => !stopped && watching === generation && ctx.store.data.settings.remindToStart
      const stop = watchInputActivity((count) => {
        if (!active()) return
        const result = recordInputActivity(activity, count, ctx.now(), liveSession(ctx.store.data) !== null, (ctx.store.data.settings.startReminderMinutes ?? 3) * 60_000)
        activity = result.activity
        if (!result.remind || !Notification.isSupported()) return
        const notice = new Notification({ title: '作業を記録しますか？', body: '入力が続いています。セッションを始めると、何に時間を使ったかが残ります。' })
        notices.add(notice)
        notice.on('click', () => { if (active() && liveSession(ctx.store.data) === null) ctx.windows.open('start') })
        notice.on('close', () => notices.delete(notice))
        notice.show()
      }, (error) => {
        if (!active()) return
        console.error('[white-box] 入力活動の検知:', error)
        stopWatching()
        ctx.store.data.settings.remindToStart = false
        ctx.publish()
      })
      if (active()) stopInput = stop
      else stop()
    } else if (!ctx.store.data.settings.remindToStart && stopInput) {
      stopWatching()
    }
  }
  refresh()
  return {
    refresh,
    stop: () => { stopped = true; stopWatching() },
  }
}

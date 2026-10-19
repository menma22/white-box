import { describe, expect, it } from 'vitest'
import { emptyInputActivity, recordInputActivity } from '../src/app/start-reminder.js'
import { liveSession } from '../src/app/state.js'
import { emptyDb } from './helpers.js'

describe('入力活動の開始リマインド', () => {
  it('時間と12回の押下の両方を満たした瞬間に知らせる', () => {
    let activity = recordInputActivity(emptyInputActivity(), 5, 100000, false, 60000).activity
    activity = recordInputActivity(activity, 5, 130000, false, 60000).activity
    expect(recordInputActivity(activity, 1, 160000, false, 60000).remind).toBe(false)
    const result = recordInputActivity(activity, 2, 160000, false, 60000)
    expect(result.remind).toBe(true)
    expect(result.activity.lastReminderAt).toBe(160000)
  })

  it('1分超の無操作は継続時間と押下回数をリセットする', () => {
    const first = recordInputActivity(emptyInputActivity(), 20, 100000, false, 60000)
    const reset = recordInputActivity(first.activity, 1, 160001, false, 60000)
    expect(reset).toMatchObject({ remind: false, activity: { startedAt: 160001, lastInputAt: 160001, presses: 1 } })
  })

  it('無操作・負の回数は開始や通知を作らない', () => {
    const activity = emptyInputActivity()
    expect(recordInputActivity(activity, 0, 100000, false, 0)).toEqual({ activity, remind: false })
    expect(recordInputActivity(activity, -1, 100000, false, 0)).toEqual({ activity, remind: false })
  })

  it('通知を無視しても30分未満は繰り返さず、30分の境界で再通知できる', () => {
    const activity = { startedAt: 0, lastInputAt: 1790000, presses: 100, lastReminderAt: 0 }
    expect(recordInputActivity(activity, 1, 1799999, false, 60000).remind).toBe(false)
    expect(recordInputActivity(activity, 1, 1800000, false, 60000).remind).toBe(true)
  })

  it.each([
    { label: '実行中', state: 'running' as const, reason: null },
    { label: '一時停止中', state: 'paused' as const, reason: 'manual' as const },
    { label: '休憩中', state: 'paused' as const, reason: 'break' as const },
  ])('$labelのセッションがある間は入力をリセットし、通知の間隔だけ保持する', ({ state, reason }) => {
    const db = emptyDb()
    db.sessions = [{ id: 'live', state, startedAt: 0, endedAt: null, plannedMs: 60000, segments: [], pauses: reason ? [{ startedAt: 60000, endedAt: null, reason }] : [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: 0 }]
    const activity = { startedAt: 0, lastInputAt: 60000, presses: 100, lastReminderAt: 50000 }
    expect(liveSession(db)).not.toBeNull()
    expect(recordInputActivity(activity, 20, 90000, liveSession(db) !== null, 60000)).toEqual({ activity: { startedAt: null, lastInputAt: null, presses: 0, lastReminderAt: 50000 }, remind: false })
  })
})

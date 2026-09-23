import { describe, expect, it } from 'vitest'
import type { LiveTick } from '@white-box/core/types'
import { liveTimerPresentation } from '../src/lib/liveTimer.js'

const tick: LiveTick = {
  sessionId: 'session',
  state: 'paused',
  elapsedMs: 50 * 60_000,
  remainingMs: -60_000,
  plannedMs: 50 * 60_000,
  activeTaskId: 'task',
}

describe('休憩タイマー表示', () => {
  it('休憩中は作業タイマーではなく休憩の残り時間を表示する', () => {
    const timer = liveTimerPresentation(tick, { startedAt: 1_000, endsAt: 301_000, notifiedAt: null }, 61_000)
    expect(timer).toMatchObject({
      elapsedMs: 60_000,
      plannedMs: 300_000,
      remainingMs: 240_000,
      label: '休憩',
      status: '休憩中',
      isBreak: true,
      isPaused: false,
      isOver: false,
    })
  })

  it('休憩終了後は0秒と休憩終了を表示する', () => {
    const timer = liveTimerPresentation(tick, { startedAt: 1_000, endsAt: 301_000, notifiedAt: 301_000 }, 361_000)
    expect(timer).toMatchObject({ remainingMs: 0, label: '休憩終了', status: '休憩終了' })
  })
})

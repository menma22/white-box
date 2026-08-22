import { describe, expect, it } from 'vitest'
import { dayKey } from '../src/engine.js'

describe('一日の境目', () => {
  it('境目より前の時刻は前日に入る', () => {
    const lateNight = new Date(2026, 7, 21, 2, 30).getTime()
    expect(dayKey(lateNight, 4)).toBe('2026-08-20')
    expect(dayKey(lateNight, 0)).toBe('2026-08-21')
  })

  it('境目ちょうどはその日に入る', () => {
    expect(dayKey(new Date(2026, 7, 21, 4, 0).getTime(), 4)).toBe('2026-08-21')
  })
})

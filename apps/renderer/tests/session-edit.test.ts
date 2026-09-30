import { describe, expect, it } from 'vitest'
import { changedSessionTimes, toLocalInput } from '../src/lib/session-edit.js'

describe('記録編集で送る時刻', () => {
  const start = new Date(2026, 8, 24, 9, 0, 15).getTime()
  const end = new Date(2026, 8, 24, 10, 0, 30).getTime()

  it('表示上は分単位でも、未変更の開始と終了は送らない', () => {
    expect(changedSessionTimes({ startedAt: start, endedAt: end }, toLocalInput(start), toLocalInput(end))).toEqual({})
  })

  it('ユーザーが変えた時刻だけ送る', () => {
    const changedEnd = '2026-09-24T10:05'
    expect(changedSessionTimes({ startedAt: start, endedAt: end }, toLocalInput(start), changedEnd)).toEqual({
      endedAt: new Date(changedEnd).getTime(),
    })
  })
})

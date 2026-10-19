import { describe, expect, it } from 'vitest'
import { MINUTE } from '@white-box/core/engine'
import { slackLabel } from '../src/lib/task-risk.js'

describe('Slack の表示', () => {
  it('不明・0・正負の余裕を混同しない', () => {
    expect(slackLabel(null)).toBe('不明')
    expect(slackLabel(0)).toBe('0m')
    expect(slackLabel(90 * MINUTE)).toBe('1h 30m')
    expect(slackLabel(-90 * MINUTE)).toBe('−1h 30m')
    expect(slackLabel(500)).toBe('<1m')
    expect(slackLabel(-500)).toBe('−<1m')
  })
})

import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/commands.js'

describe('任意見積と警告の厳密な契約', () => {
  it('任意の時間を保持し、省略と null と明示した 0 を区別する', () => {
    expect(parseArgs('task:create', { title: '未入力' })).toEqual({ title: '未入力' })
    expect(parseArgs('task:create', { title: '仕事', remainingEffortMinutes: 90, safetyBufferMinutes: 0 })).toEqual({ title: '仕事', remainingEffortMinutes: 90, safetyBufferMinutes: 0 })
    expect(parseArgs('task:update', { id: 'task', patch: { remainingEffortMinutes: null, safetyBufferMinutes: 1.5 } })).toEqual({ id: 'task', patch: { remainingEffortMinutes: null, safetyBufferMinutes: 1.5 } })
  })
  it.each([-1, NaN, Infinity, '1', {}])('不正な見積・安全余裕を create/update 両方で拒否する: %j', (value) => {
    for (const field of ['remainingEffortMinutes', 'safetyBufferMinutes']) {
      expect(() => parseArgs('task:create', { title: '仕事', [field]: value })).toThrow()
      expect(() => parseArgs('task:update', { id: 'task', patch: { [field]: value } })).toThrow()
    }
  })
  it('綴り違いと管理された Aging 起点の上書きを拒否する', () => {
    for (const key of ['remainingEffortMinute', 'committedAt', 'lastProgressAt']) expect(() => parseArgs('task:update', { id: 'task', patch: { [key]: 1 } })).toThrow()
  })
  it.each([0, -1, NaN, Infinity])('不正な閾値を設定できない: %j', (stallWarningDays) => {
    expect(() => parseArgs('settings:update', { patch: { stallWarningDays } })).toThrow()
  })
})

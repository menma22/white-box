import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/commands.js'
import { WeeklyBudgetPlanSchema } from '../src/planning.js'

const plan = { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 60, allocations: [{ projectId: 'p', mode: 'minimum', minutes: 120 }] }
describe('strict phase 2 planning commands', () => {
  it('preserves separate project priority and structured context', () => {
    expect(parseArgs('project:update', { id: 'p', patch: { priority: 'high' } })).toEqual({ id: 'p', patch: { priority: 'high' } })
    expect(parseArgs('project:update', { id: 'p', patch: { priority: undefined } }).patch).toHaveProperty('priority', undefined)
    expect(parseArgs('task:update', { id: 't', patch: { notes: 'legacy', problems: 'issue', decisions: 'decision', nextContext: 'restart here' } }).patch).toEqual({ notes: 'legacy', problems: 'issue', decisions: 'decision', nextContext: 'restart here' })
  })
  it('rejects unknown keys and caller-controlled timestamps', () => {
    expect(() => parseArgs('weeklyBudget:set', { weekStart: '2026-10-05', plan: { ...plan, typo: 1 } })).toThrow()
    expect(() => parseArgs('fixedWork:update', { id: 'x', patch: { createdAt: 0 } })).toThrow()
    expect(() => parseArgs('fixedWork:create', { taskId: 't', startedAt: 1, endedAt: 2, externalReason: 'meeting', sessionId: 'fake' })).toThrow()
    for (const command of ['project:update', 'task:update'] as const) {
      for (const field of ['id', 'createdAt', 'updatedAt']) expect(() => parseArgs(command, { id: 'x', patch: { [field]: field === 'id' ? 'evil' : 0 } })).toThrow()
    }
  })
  it('rejects contradictory allocation modes and budgets', () => {
    expect(() => WeeklyBudgetPlanSchema.parse({ ...plan, allocations: [{ projectId: 'p', mode: 'unlimited', minutes: 100 }] })).toThrow()
    expect(() => WeeklyBudgetPlanSchema.parse({ ...plan, allocations: [{ projectId: 'p', mode: 'range', minimumMinutes: 50, maximumMinutes: 40 }] })).toThrow()
    expect(() => WeeklyBudgetPlanSchema.parse({ ...plan, sleepMinutes: 10080 })).toThrow()
  })
  it('rejects invalid fixed ranges while permitting cancellation patches', () => {
    expect(() => parseArgs('fixedWork:create', { taskId: 't', startedAt: 100, endedAt: 100, externalReason: 'meeting' })).toThrow()
    expect(() => parseArgs('fixedWork:create', { taskId: 't', startedAt: 100, endedAt: 101, externalReason: ' ' })).toThrow()
    expect(parseArgs('fixedWork:update', { id: 'x', patch: { cancelled: true } })).toEqual({ id: 'x', patch: { cancelled: true } })
  })
})

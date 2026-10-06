import { describe, expect, it } from 'vitest'
import { allocationBounds, fixedWorkMinutes, validateBudgetPlan, validateFixedWork, weekBounds, weeklyBudgetSummary, WEEK_MINUTES } from '../src/weekly-budget.js'
import type { FixedWork, ProjectAllocation, WeeklyBudgetPlan } from '../src/types.js'

const weekStart = '2026-10-05'
const monday = weekBounds(weekStart).startedAt
const minute = 60_000
const plan: WeeklyBudgetPlan = { sleepMinutes: 7 * 8 * 60, mealMinutes: 7 * 2 * 60, fixedMinutes: 60, allocations: [] }
const work = (id: string, start: number, end: number, cancelled = false): FixedWork => ({ id, taskId: 't', startedAt: start, endedAt: end, cancelled, externalReason: '外部会議', createdAt: 0, updatedAt: 0 })

describe('weekly planned resources', () => {
  it('keeps an unconfigured budget unknown', () => {
    expect(weeklyBudgetSummary({}, weekStart)).toBeNull()
  })
  it('subtracts 168h deductions and scheduled external work independently of achievements', () => {
    const summary = weeklyBudgetSummary({ weeklyBudgets: [{ ...plan, weekStart, createdAt: 0, updatedAt: 0 }], fixedWork: [work('a', monday, monday + 120 * minute)] }, weekStart)!
    expect(summary.availableMinutes).toBe(WEEK_MINUTES - plan.sleepMinutes - plan.mealMinutes - plan.fixedMinutes - 120)
    expect(summary.fixedWorkMinutes).toBe(120)
  })
  it('unions overlapping fixed work, clips week boundaries and ignores cancelled/outside events', () => {
    expect(fixedWorkMinutes([
      work('a', monday - 60 * minute, monday + 60 * minute),
      work('b', monday + 30 * minute, monday + 90 * minute),
      work('c', monday + 90 * minute, monday + 150 * minute, true),
      work('d', monday - 120 * minute, monday - 60 * minute),
    ], weekStart)).toBe(90)
  })
  it.each([
    [{ projectId: 'p', mode: 'minimum', minutes: 120 }, 120, null],
    [{ projectId: 'p', mode: 'maximum', minutes: 120 }, 0, 120],
    [{ projectId: 'p', mode: 'range', minimumMinutes: 60, maximumMinutes: 120 }, 60, 120],
    [{ projectId: 'p', mode: 'unlimited' }, 0, null],
  ] as [ProjectAllocation, number, number | null][])('preserves allocation bounds for %j', (allocation, min, max) => {
    expect(allocationBounds(allocation)).toEqual({ minimumMinutes: min, maximumMinutes: max })
  })
  it('reports minimum overcommit without rewriting allocations or manufacturing achievement', () => {
    const budget = { ...plan, weekStart, createdAt: 0, updatedAt: 0, allocations: [{ projectId: 'p', mode: 'minimum' as const, minutes: WEEK_MINUTES }] }
    const snapshot = structuredClone(budget)
    expect(weeklyBudgetSummary({ weeklyBudgets: [budget] }, weekStart)).toMatchObject({ minimumMinutes: WEEK_MINUTES, maximumMinutes: null, overcommitted: true })
    expect(budget).toEqual(snapshot)
  })
  it('reports exhaustion from external time even with no minimum allocations', () => {
    expect(weeklyBudgetSummary({ weeklyBudgets: [{ ...plan, weekStart, createdAt: 0, updatedAt: 0 }], fixedWork: [work('full', monday, weekBounds(weekStart).endedAt)] }, weekStart)).toMatchObject({ overcommitted: true })
  })
  it.each([-1, Infinity, NaN, WEEK_MINUTES + 1])('rejects invalid minute amount %s', (value) => {
    expect(() => validateBudgetPlan({ ...plan, sleepMinutes: value })).toThrow()
  })
  it('rejects totals beyond 168h, inverted ranges and duplicate projects', () => {
    expect(() => validateBudgetPlan({ ...plan, sleepMinutes: WEEK_MINUTES })).toThrow()
    expect(() => validateBudgetPlan({ ...plan, allocations: [{ projectId: 'p', mode: 'range', minimumMinutes: 20, maximumMinutes: 10 }] })).toThrow()
    expect(() => validateBudgetPlan({ ...plan, allocations: [{ projectId: 'p', mode: 'unlimited' }, { projectId: 'p', mode: 'unlimited' }] })).toThrow()
    expect(() => validateBudgetPlan({ sleepMinutes: WEEK_MINUTES, mealMinutes: 0, fixedMinutes: 0, allocations: [] })).not.toThrow()
  })
  it.each(['2026-10-06', '2026-02-30', 'bad', '2026-1-5'])('rejects non-Monday or impossible week %s', (value) => {
    expect(() => weekBounds(value)).toThrow()
  })
  it('rejects zero-length, reversed or invalid fixed time and missing external reason', () => {
    for (const patch of [{ endedAt: monday }, { endedAt: monday - 1 }, { startedAt: NaN }, { externalReason: ' ' }]) {
      expect(() => validateFixedWork({ startedAt: monday, endedAt: monday + minute, externalReason: 'meeting', ...patch })).toThrow()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { calendarOccurrences, calendarProjectUsage, validateCalendarBlock } from '../src/calendar.js'
import { weeklyBudgetSummary, weekBounds, WEEK_MINUTES } from '../src/weekly-budget.js'
import type { CalendarBlock, CalendarBlockInput, FixedWork, Session, Task } from '../src/types.js'

const minute = 60_000
const at = (day: number, hour = 0, minutes = 0) => new Date(2026, 9, day, hour, minutes).getTime()
const monday = at(5)
const block = (over: Partial<CalendarBlock> = {}): CalendarBlock => ({ id: 'b', title: 'Plan', category: 'work', taskId: null, projectId: 'p', startedAt: at(5, 9), endedAt: at(5, 10), repeat: 'none', weekdays: [], until: null, cancelled: false, createdAt: 0, updatedAt: 0, ...over })
const routine = (id: string, category: 'sleep' | 'meal' | 'fixed', start: number, end: number): CalendarBlock => block({ id, category, projectId: null, startedAt: start, endedAt: end })
const fixed = (id: string, start: number, end: number, cancelled = false): FixedWork => ({ id, taskId: 't', startedAt: start, endedAt: end, externalReason: 'Meeting', cancelled, createdAt: 0, updatedAt: 0 })
const task = (id: string, projectId: string): Task => ({ id, projectId, parentId: null, title: id, notes: '', status: 'todo', progress: 0, priority: 'normal', order: 0, createdAt: 0, updatedAt: 0, doneAt: null, createdInSessionId: null })
const session = (id: string, taskId: string, start: number, end: number): Session => ({ id, startedAt: start, endedAt: end, plannedMs: end - start, state: 'ended', segments: [{ id: `${id}-segment`, taskId, startedAt: start, endedAt: end }], pauses: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: start })

describe('calendar occurrence boundaries', () => {
  it('preserves complete original ranges and excludes touching or cancelled single events', () => {
    const period = { startedAt: at(5), endedAt: at(6) }
    const input = [block({ id: 'across', startedAt: at(4, 23), endedAt: at(6, 1) }), block({ id: 'before', startedAt: at(4, 22), endedAt: at(5) }), block({ id: 'after', startedAt: at(6), endedAt: at(6, 1) }), block({ id: 'cancelled', cancelled: true })]
    const original = structuredClone(input)
    expect(calendarOccurrences(input, period)).toEqual([{ blockId: 'across', title: 'Plan', category: 'work', taskId: null, projectId: 'p', startedAt: at(4, 23), endedAt: at(6, 1), repeat: 'none', weekdays: [], until: null }])
    expect(input).toEqual(original)
  })
  it('expands Sunday/Monday over midnight, includes both period edges and honours inclusive until', () => {
    const input = block({ startedAt: at(2, 23), endedAt: at(3, 1), repeat: 'weekly', weekdays: [0, 1], until: '2026-10-05' })
    const occurrences = calendarOccurrences([input], { startedAt: at(5), endedAt: at(6) })
    expect(occurrences.map(({ startedAt, endedAt }) => [startedAt, endedAt])).toEqual([[at(4, 23), at(5, 1)], [at(5, 23), at(6, 1)]])
    expect(calendarOccurrences([input], weekBounds('2026-10-12'))).toEqual([])
  })
  it('never emits a recurring start before the anchor and preserves minute/second precision', () => {
    const anchor = at(5, 9, 15) + 12_345
    const input = block({ startedAt: anchor, endedAt: anchor + minute, repeat: 'weekly', weekdays: [0, 1, 2] })
    expect(calendarOccurrences([input], { startedAt: at(4), endedAt: at(7) }).map((item) => item.startedAt)).toEqual([anchor, at(6, 9, 15) + 12_345])
    input.cancelled = true
    expect(calendarOccurrences([input], weekBounds('2026-10-05'))).toEqual([])
  })
  it('keeps recurring local start time across daylight-saving changes', () => {
    const script = `
      import { calendarOccurrences } from ${JSON.stringify(new URL('../dist/calendar.js', import.meta.url).href)};
      const start = new Date(2026, 9, 25, 9).getTime();
      const input = ${JSON.stringify(block())};
      Object.assign(input, { startedAt: start, endedAt: start + 3600000, repeat: 'weekly', weekdays: [0], until: '2026-11-01' });
      const results = calendarOccurrences([input], { startedAt: start, endedAt: new Date(2026, 10, 2).getTime() });
      console.log(JSON.stringify({ hours: results.map(item => new Date(item.startedAt).getHours()), gap: results[1].startedAt - results[0].startedAt, durations: results.map(item => item.endedAt - item.startedAt) }));
    `
    const results = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }))
    expect(results).toEqual({ hours: [9, 9], gap: 169 * 60 * minute, durations: [60 * minute, 60 * minute] })
  })
  it.each([
    { title: ' ' }, { category: 'bad' }, { startedAt: NaN }, { endedAt: at(5, 9) }, { endedAt: at(5, 8) },
    { repeat: 'none', weekdays: [1] }, { repeat: 'none', until: '2026-10-12' },
    { repeat: 'weekly', weekdays: [] }, { repeat: 'weekly', weekdays: [1, 1] }, { repeat: 'weekly', weekdays: [7] },
    { repeat: 'weekly', weekdays: [1], endedAt: at(6, 10) }, { repeat: 'weekly', weekdays: [1], until: '2026-02-30' },
    { repeat: 'weekly', weekdays: [1], until: '2026-10-04' }, { category: 'sleep', projectId: 'p' }, { category: 'meal', taskId: 't', projectId: null },
  ])('rejects inconsistent input %j', (patch) => {
    expect(() => validateCalendarBlock({ ...block(), ...patch } as CalendarBlockInput)).toThrow()
  })
  it('permits a 24-hour recurring block and a longer single event', () => {
    expect(() => validateCalendarBlock(block({ repeat: 'weekly', weekdays: [1], endedAt: at(6, 9) }))).not.toThrow()
    expect(() => validateCalendarBlock(block({ endedAt: at(7, 9) }))).not.toThrow()
  })
})

describe('calendar reservation budget', () => {
  it('unions known life and fixed work while adding only each category manual remainder', () => {
    const budget = { sleepMinutes: 120, mealMinutes: 30, fixedMinutes: 60, allocations: [], weekStart: '2026-10-05', createdAt: 0, updatedAt: 0 }
    const blocks = [routine('sleep1', 'sleep', monday, monday + 60 * minute), routine('sleep2', 'sleep', monday + 30 * minute, monday + 90 * minute), routine('fixed', 'fixed', monday + 60 * minute, monday + 120 * minute), routine('meal', 'meal', monday + 180 * minute, monday + 240 * minute), block({ id: 'work', startedAt: monday, endedAt: monday + 8 * 60 * minute }), routine('cancelled', 'sleep', monday, monday + 8 * 60 * minute)]
    blocks[5]!.cancelled = true
    const state = { weeklyBudgets: [budget], calendarBlocks: blocks, fixedWork: [fixed('f', monday + 90 * minute, monday + 150 * minute), fixed('cancelled', monday, monday + 300 * minute, true)] }
    const snapshot = structuredClone(state)
    expect(weeklyBudgetSummary(state, '2026-10-05')).toMatchObject({ sleepMinutes: 120, mealMinutes: 60, fixedMinutes: 60, fixedWorkMinutes: 60, calendarRoutineMinutes: 180, reservedMinutes: 210, additionalLifeMinutes: 30, availableMinutes: WEEK_MINUTES - 240 })
    expect(state).toEqual(snapshot)
  })
  it('ensures repeated routine minima even when all manual categories are zero and clips only for accounting', () => {
    const sleep = routine('night', 'sleep', at(4, 23), at(5, 7))
    Object.assign(sleep, { repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], until: null })
    const result = weeklyBudgetSummary({ weeklyBudgets: [{ sleepMinutes: 0, mealMinutes: 0, fixedMinutes: 0, allocations: [], weekStart: '2026-10-05', createdAt: 0, updatedAt: 0 }], calendarBlocks: [sleep] }, '2026-10-05')!
    expect(result.sleepMinutes).toBe(7 * 8 * 60)
    expect(result.availableMinutes).toBe(WEEK_MINUTES - 7 * 8 * 60)
    expect(calendarOccurrences([sleep], weekBounds('2026-10-05'))[0]!.startedAt).toBe(at(4, 23))
  })
})

describe('planned and actual project usage', () => {
  it('unions project plans, removes observed pauses/exclusions/duplicate actual time, and keeps flexible meaning', () => {
    const first = session('a', 't', monday, monday + 180 * minute)
    first.pauses = [{ startedAt: monday + 30 * minute, endedAt: monday + 60 * minute, reason: 'manual' }, { startedAt: monday + 90 * minute, endedAt: monday + 120 * minute, reason: 'excluded' }]
    const second = session('b', 'other', monday + 60 * minute, monday + 240 * minute)
    const usage = calendarProjectUsage({ tasks: [task('t', 'p'), task('other', 'q')], sessions: [second, first], fixedWork: [fixed('f', monday + 60 * minute, monday + 150 * minute), fixed('cancelled', monday, monday + 240 * minute, true)], calendarBlocks: [block({ startedAt: monday, endedAt: monday + 90 * minute }), block({ id: 'overlap', startedAt: monday + 30 * minute, endedAt: monday + 120 * minute }), routine('life', 'sleep', monday, monday + 8 * 60 * minute)] }, '2026-10-05', at(12))
    expect(usage.get('p')).toEqual({ plannedMinutes: 150, actualMinutes: 120, flexibleActualMinutes: 60 })
    expect(usage.get('q')).toEqual({ plannedMinutes: 0, actualMinutes: 90, flexibleActualMinutes: 60 })
  })
  it('omits projects whose fixed work is outside or only touches the selected week', () => {
    const entries = [
      { ...fixed('past', at(3, 9), at(3, 10)), taskId: 'past' },
      { ...fixed('future', at(13, 9), at(13, 10)), taskId: 'future' },
      { ...fixed('touch-before', at(4, 23), at(5)), taskId: 'before' },
      { ...fixed('touch-after', at(12), at(12, 1)), taskId: 'after' },
      { ...fixed('crossing', at(5) - minute, at(5) + minute), taskId: 'crossing' },
    ]
    const usage = calendarProjectUsage({ tasks: entries.map((entry) => task(entry.taskId, entry.taskId)), sessions: [], fixedWork: entries }, '2026-10-05', at(12))
    expect([...usage.keys()]).toEqual(['crossing'])
    expect(usage.get('crossing')).toEqual({ plannedMinutes: 1, actualMinutes: 0, flexibleActualMinutes: 0 })
  })
  it('keeps missing-task activity and project-less plans in the null bucket', () => {
    const usage = calendarProjectUsage({ tasks: [], sessions: [session('deleted', 'missing', monday - minute, monday + minute)], calendarBlocks: [block({ projectId: null, startedAt: monday - minute, endedAt: monday + minute })], fixedWork: [] }, '2026-10-05', at(12))
    expect(usage.get(null)).toEqual({ plannedMinutes: 1, actualMinutes: 1, flexibleActualMinutes: 1 })
  })
})

import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/commands.js'
import { CalendarBlockSchema } from '../src/calendar.js'

const input = { title: ' Plan ', category: 'work', taskId: 't', projectId: 'p', startedAt: new Date(2026, 9, 5, 9).getTime(), endedAt: new Date(2026, 9, 5, 10).getTime(), repeat: 'none', weekdays: [], until: null }
describe('strict calendar contracts', () => {
  it('trims names, accepts repeat/cancellation patches, and preserves all calendar inputs', () => {
    expect(parseArgs('calendar:create', input)).toEqual({ ...input, title: 'Plan' })
    expect(parseArgs('calendar:update', { id: 'b', patch: { cancelled: true } })).toEqual({ id: 'b', patch: { cancelled: true } })
    expect(parseArgs('calendar:create', { ...input, repeat: 'weekly', weekdays: [0, 1], until: '2026-10-12' }).weekdays).toEqual([0, 1])
  })
  it('rejects caller-controlled identifiers/timestamps and typo fields at every input layer', () => {
    for (const key of ['id', 'createdAt', 'updatedAt', 'cancelled', 'endAt']) expect(() => parseArgs('calendar:create', { ...input, [key]: 1 })).toThrow()
    for (const key of ['id', 'createdAt', 'updatedAt', 'endAt']) expect(() => parseArgs('calendar:update', { id: 'b', patch: { [key]: 1 } })).toThrow()
    expect(() => parseArgs('calendar:update', { id: 'b', patch: {}, typo: 1 })).toThrow()
    expect(() => CalendarBlockSchema.parse({ ...input, id: 'b', cancelled: false, createdAt: 0, updatedAt: 0, typo: 1 })).toThrow()
  })
  it.each([
    { title: '' }, { repeat: 'weekly', weekdays: [1, 1] }, { repeat: 'weekly', weekdays: [] },
    { repeat: 'weekly', weekdays: [1], until: '2026-02-30' }, { repeat: 'none', weekdays: [1] },
    { category: 'sleep' }, { endedAt: input.startedAt }, { startedAt: Infinity }, { startedAt: 1.5 },
  ])('rejects structurally inconsistent creation %j', (patch) => {
    expect(() => parseArgs('calendar:create', { ...input, ...patch })).toThrow()
  })
})

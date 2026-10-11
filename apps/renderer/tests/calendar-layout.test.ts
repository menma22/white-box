import { describe, expect, it } from 'vitest'
import { layoutDayEvents, selectionMinutes, type CalendarEvent } from '../src/features/today/calendar-layout.js'
import { dayRange } from '@white-box/core/activity'

const period = dayRange('2026-10-12', 0)
const at = (hour: number, minute = 0) => new Date(2026, 9, 12, hour, minute).getTime()
function event(key: string, start: number, end: number): CalendarEvent { return { key, startedAt: start, endedAt: end, kind: 'planned', title: key } }
describe('calendar overlap layout', () => {
  it('gives overlapping planned and recorded events separate clickable lanes', () => {
    const positions = layoutDayEvents([event('plan', at(9), at(11)), { ...event('actual', at(9, 30), at(10, 30)), kind: 'actual' }, event('later', at(12), at(13))], period)
    expect(positions.slice(0, 2).map((item) => item.lane)).toEqual([0, 1])
    expect(positions.slice(0, 2).map((item) => item.lanes)).toEqual([2, 2])
    expect(positions[2]!.lanes).toBe(1)
  })
  it('uses half-open boundaries and reuses available lanes in a connected cluster', () => {
    const positions = layoutDayEvents([event('long', at(9), at(12)), event('one', at(10), at(11)), event('two', at(11), at(12)), event('next', at(12), at(13))], period)
    expect(positions.map((item) => [item.lane, item.lanes])).toEqual([[0, 2], [1, 2], [1, 2], [0, 1]])
  })
  it('clips overnight display without changing the original event timestamps', () => {
    const overnight = event('night', at(-1), at(1))
    const position = layoutDayEvents([overnight, event('outside', at(24), at(25))], period)[0]!
    expect([position.startMinute, position.endMinute]).toEqual([0, 60])
    expect(position.event).toBe(overnight)
  })
  it('keeps short records operable and separates visually overlapping hit areas', () => {
    const positions = layoutDayEvents([event('short', at(9), at(9, 1)), event('near', at(9, 10), at(9, 11)), event('end', at(23, 59), at(24))], period, 30)
    expect(positions[0]!.endMinute - positions[0]!.startMinute).toBe(30)
    expect(positions[0]!.lanes).toBe(2)
    expect(positions[2]!.endMinute).toBe(1440)
    expect(positions[2]!.startMinute).toBe(1410)
  })
})
describe('calendar drag selection', () => {
  it('snaps both drag directions to quarter hours', () => {
    expect(selectionMinutes(557, 601)).toEqual([555, 600])
    expect(selectionMinutes(601, 557)).toEqual([555, 600])
  })
  it('does not add a quarter hour for a floating point value just past the boundary', () => {
    expect(selectionMinutes(900, 960.00000001)).toEqual([900, 960])
  })
  it('keeps selection in the day with at least one quarter hour', () => {
    expect(selectionMinutes(-1, 0)).toEqual([0, 15])
    expect(selectionMinutes(1500, 1500)).toEqual([1425, 1440])
  })
})

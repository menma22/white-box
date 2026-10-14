import type { TimeRange } from '@white-box/core/types'

export interface CalendarEvent extends TimeRange {
  key: string
  kind: 'planned' | 'actual' | 'routine' | 'fixed'
  title: string
  color?: string
  blockId?: string
  sessionId?: string
  taskId?: string | null
  live?: boolean
  recurring?: boolean
}
export interface CalendarPosition {
  event: CalendarEvent
  startMinute: number
  endMinute: number
  lane: number
  lanes: number
}

function minute(at: number, period: TimeRange): number {
  if (at <= period.startedAt) return 0
  if (at >= period.endedAt) return 1440
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

export function layoutDayEvents(events: CalendarEvent[], period: TimeRange, minimumMinutes = 0): CalendarPosition[] {
  const items = events.filter((event) => event.startedAt < period.endedAt && event.endedAt > period.startedAt).map((event) => {
    const actualStart = minute(event.startedAt, period)
    const startMinute = Math.min(actualStart, 1440 - minimumMinutes)
    const endMinute = Math.min(1440, Math.max(minute(event.endedAt, period), startMinute + minimumMinutes))
    return { event, startMinute, endMinute, lane: 0, lanes: 1 }
  }).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.event.key.localeCompare(b.event.key))
  let group: CalendarPosition[] = []
  let ends: number[] = []
  let groupEnd = -1
  function finish() { for (const item of group) item.lanes = ends.length }
  for (const item of items) {
    if (item.startMinute >= groupEnd) { finish(); group = []; ends = [] }
    const free = ends.findIndex((end) => end <= item.startMinute)
    item.lane = free < 0 ? ends.length : free
    ends[item.lane] = item.endMinute
    group.push(item)
    groupEnd = Math.max(groupEnd, item.endMinute)
  }
  finish()
  return items
}

export function selectionMinutes(start: number, end: number): [number, number] {
  const first = Math.max(0, Math.min(1425, Math.floor(Math.min(start, end) / 15) * 15))
  const last = Math.min(1440, Math.max(first + 15, Math.round(Math.max(start, end) / 15) * 15))
  return [first, last]
}

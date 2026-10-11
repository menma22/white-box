import { describe, expect, it } from 'vitest'
import { dayRange } from '@white-box/core/activity'
import { GoogleCreateRequest, googleCalendarEvent, selectedGoogleEvents, writableCalendars, type GoogleCalendarState, type GoogleEvent } from '../src/features/google-calendar/google-calendar.js'
import { layoutDayEvents } from '../src/features/today/calendar-layout.js'

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
const event: GoogleEvent = { id: 'event', calendarId: 'main', title: '打ち合わせ', startedAt: at(12, 9), endedAt: at(12, 10), allDay: false }
const state: GoogleCalendarState = { configured: true, connected: true, account: 'me@example.com', calendars: [], selectedCalendarIds: ['main'], events: [event], syncing: false, lastSyncedAt: null, error: null }

describe('Google calendar display', () => {
  it('shows only connected selected calendars within the half-open displayed range', () => {
    const period = dayRange('2026-10-12', 4)
    expect(selectedGoogleEvents({ ...state, events: [event, { ...event, calendarId: 'hidden' }, { ...event, id: 'after', startedAt: period.endedAt, endedAt: at(13, 5) }] }, period)).toEqual([event])
    expect(selectedGoogleEvents({ ...state, connected: false }, period)).toEqual([])
    expect(selectedGoogleEvents({ ...state, selectedCalendarIds: [] }, period)).toEqual([])
  })
  it('keeps Google source, all-day identity and identical ids from different calendars separate', () => {
    const mapped = googleCalendarEvent({ ...event, allDay: true })
    expect(mapped.kind).toBe('google')
    expect(mapped.allDay).toBe(true)
    expect(mapped.googleEvent?.id).toBe(event.id)
    expect(mapped.key).not.toBe(googleCalendarEvent({ ...event, calendarId: 'other' }).key)
  })
  it('clips across the configured day boundary and separates overlaps without changing source times', () => {
    const period = dayRange('2026-10-12', 4)
    const overnight = { ...event, id: 'night', startedAt: at(12, 3), endedAt: at(12, 5) }
    const nextMorning = { ...event, id: 'morning', startedAt: at(13, 3), endedAt: at(13, 5) }
    const positions = layoutDayEvents([overnight, { ...overnight, id: 'overlap', startedAt: at(12, 4) }, nextMorning].map(googleCalendarEvent), period)
    expect(positions.map((item) => [item.startMinute, item.endMinute])).toEqual([[0, 60], [0, 60], [1380, 1440]])
    expect(positions.slice(0, 2).map((item) => item.lanes)).toEqual([2, 2])
    expect(positions[0]!.event.startedAt).toBe(at(12, 3))
  })
  it('offers creation only for owner and writer calendars', () => {
    const calendars = ['owner', 'writer', 'reader', 'freeBusyReader'].map((accessRole) => ({ id: accessRole, title: accessRole, accessRole, primary: false }))
    expect(writableCalendars(calendars).map((calendar) => calendar.id)).toEqual(['owner', 'writer'])
  })
})

describe('Google create retries', () => {
  it('reuses both request identity and the original write after an ambiguous failure', () => {
    const request = new GoogleCreateRequest('request-id')
    const input = { calendarId: event.calendarId, title: event.title, startedAt: event.startedAt, endedAt: event.endedAt }
    const first = request.prepare(input)
    expect(request.prepare({ ...input, title: 'changed', calendarId: 'other' })).toEqual(first)
    first.title = 'external mutation'
    expect(request.prepare(input).title).toBe(event.title)
    expect(request.prepare(input).requestId).toBe('request-id')
  })
})

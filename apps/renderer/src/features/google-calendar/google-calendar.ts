import type { AppState, TimeRange } from '@white-box/core/types'
import { GOOGLE_CALENDAR_COMMANDS } from '@white-box/contracts'
import type { CalendarEvent } from '../today/calendar-layout.js'

export type GoogleCalendarState = NonNullable<AppState['googleCalendar']>
export type GoogleEvent = GoogleCalendarState['events'][number]
export type GoogleCalendarInfo = GoogleCalendarState['calendars'][number]

export function writableCalendars(calendars: GoogleCalendarInfo[]): GoogleCalendarInfo[] {
  return calendars.filter((calendar) => calendar.accessRole === 'owner' || calendar.accessRole === 'writer')
}

export function selectedGoogleEvents(state: GoogleCalendarState | undefined, period: TimeRange): GoogleEvent[] {
  if (!state?.connected) return []
  const selected = new Set(state.selectedCalendarIds)
  return state.events.filter((event) => selected.has(event.calendarId) && event.startedAt < period.endedAt && event.endedAt > period.startedAt)
}

export function googleCalendarEvent(event: GoogleEvent): CalendarEvent {
  return { key: JSON.stringify(['google', event.calendarId, event.id]), kind: 'google', title: event.title, startedAt: event.startedAt,
    endedAt: event.endedAt, allDay: event.allDay, googleEvent: event }
}

export interface GoogleCreateInput { calendarId: string; title: string; startedAt: number; endedAt: number; requestId: string }

export class GoogleCreateRequest {
  private input: GoogleCreateInput | null = null
  constructor(private readonly requestId: string) {}
  prepare(input: Omit<GoogleCreateInput, 'requestId'>): GoogleCreateInput {
    if (!this.input) this.input = GOOGLE_CALENDAR_COMMANDS['googleCalendar:create'].args.parse({ ...input, requestId: this.requestId })
    return { ...this.input }
  }
}

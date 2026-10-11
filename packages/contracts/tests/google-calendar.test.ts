import { describe, expect, it } from 'vitest'
import { AppStateSchema, GOOGLE_CALENDAR_COMMANDS, GoogleCalendarStateSchema } from '../src/index.js'

describe('Google Calendar IPC contract', () => {
  it('keeps arguments strict and rejects reversed or unbounded periods', () => {
    expect(GOOGLE_CALENDAR_COMMANDS['googleCalendar:connect'].args.safeParse({ token: 'secret' }).success).toBe(false)
    const sync = GOOGLE_CALENDAR_COMMANDS['googleCalendar:sync'].args
    expect(sync.safeParse({ startedAt: 1, endedAt: 0 }).success).toBe(false)
    expect(sync.safeParse({ startedAt: 0, endedAt: 91 * 86400000 }).success).toBe(false)
    expect(sync.safeParse({ startedAt: 0, endedAt: 86400000 }).success).toBe(true)
    expect(sync.safeParse({ startedAt: Infinity, endedAt: 1 }).success).toBe(false)
    const create = GOOGLE_CALENDAR_COMMANDS['googleCalendar:create'].args
    expect(create.safeParse({ calendarId: 'primary', title: 'Event', startedAt: 0, endedAt: 1, requestId: 'request' }).success).toBe(true)
    expect(create.safeParse({ calendarId: 'primary', title: ' ', startedAt: 0, endedAt: 1, requestId: 'request' }).success).toBe(false)
  })
  it('rejects credentials in public state and allows preexisting app state without Google state', () => {
    const state = { configured: true, connected: true, account: 'me@example.com', calendars: [], selectedCalendarIds: [], events: [], syncing: false, lastSyncedAt: null, error: null }
    expect(GoogleCalendarStateSchema.safeParse(state).success).toBe(true)
    expect(GoogleCalendarStateSchema.safeParse({ ...state, refreshToken: 'private' }).success).toBe(false)
    expect(AppStateSchema.shape.googleCalendar.safeParse(undefined).success).toBe(true)
    expect(AppStateSchema.shape.googleCalendar.safeParse(state).success).toBe(true)
  })
})

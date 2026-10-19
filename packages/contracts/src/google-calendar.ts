import { z } from 'zod'

const Timestamp = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000)
const Range = z.strictObject({ startedAt: Timestamp, endedAt: Timestamp }).refine((v) => v.endedAt > v.startedAt && v.endedAt - v.startedAt <= 90 * 86400000, '期間は90日以内で終了を開始より後にしてください')
export const GoogleCalendarInfoSchema = z.strictObject({ id: z.string().min(1), title: z.string(), accessRole: z.string(), primary: z.boolean() })
export const GoogleCalendarEventSchema = z.strictObject({ id: z.string().min(1), calendarId: z.string().min(1), title: z.string(), startedAt: Timestamp, endedAt: Timestamp, allDay: z.boolean(), htmlLink: z.string().url().optional(), location: z.string().optional() }).refine((v) => v.endedAt > v.startedAt)
export const GoogleCalendarStateSchema = z.strictObject({ configured: z.boolean(), connected: z.boolean(), account: z.string().nullable(), calendars: z.array(GoogleCalendarInfoSchema), selectedCalendarIds: z.array(z.string()), events: z.array(GoogleCalendarEventSchema), syncing: z.boolean(), lastSyncedAt: Timestamp.nullable(), error: z.string().nullable() })
const Empty = z.strictObject({})
export const GOOGLE_CALENDAR_COMMANDS = {
  'googleCalendar:configure': { args: z.strictObject({ clientId: z.string().trim().min(1).max(1000), clientSecret: z.string().trim().min(1).max(1000) }), result: z.null() },
  'googleCalendar:connect': { args: Empty, result: z.null() },
  'googleCalendar:cancelConnect': { args: Empty, result: z.null() },
  'googleCalendar:disconnect': { args: Empty, result: z.null() },
  'googleCalendar:select': { args: z.strictObject({ calendarIds: z.array(z.string().min(1).max(1000)).max(100) }), result: z.null() },
  'googleCalendar:sync': { args: Range, result: z.null() },
  'googleCalendar:create': { args: z.strictObject({ calendarId: z.string().min(1).max(1000), title: z.string().trim().min(1).max(1000), startedAt: Timestamp, endedAt: Timestamp, requestId: z.string().min(1).max(200) }).refine((v) => v.endedAt > v.startedAt && v.endedAt - v.startedAt <= 90 * 86400000), result: GoogleCalendarEventSchema },
} as const

import { z } from 'zod'

export const GoogleCalendarProfileSchema = z.strictObject({
  clientId: z.string().min(1), clientSecret: z.string().min(1),
  refreshToken: z.string().min(1).optional(), account: z.string().optional(),
  selectedCalendarIds: z.array(z.string()).nullable(),
})
export type GoogleCalendarProfile = ReturnType<typeof GoogleCalendarProfileSchema.parse>

export const GoogleCalendarTokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive(), refresh_token: z.string().min(1).optional(), scope: z.string().optional() })
export const GoogleCalendarListPageSchema = z.object({ items: z.array(z.object({ id: z.string().min(1), summary: z.string().optional(), accessRole: z.string(), primary: z.boolean().optional(), deleted: z.boolean().optional() })).default([]), nextPageToken: z.string().optional() })
const DateValue = z.object({ date: z.string().optional(), dateTime: z.string().optional() })
export const GoogleCalendarApiEventSchema = z.object({ id: z.string().min(1), status: z.string().optional(), summary: z.string().optional(), start: DateValue.optional(), end: DateValue.optional(), htmlLink: z.string().optional(), location: z.string().optional(), extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional() })
export const GoogleCalendarEventPageSchema = z.object({ items: z.array(GoogleCalendarApiEventSchema).default([]), nextPageToken: z.string().optional() })

export const GoogleCalendarAccountSchema = z.object({ email: z.string().email() })

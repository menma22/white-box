import { z } from 'zod'
import type { CalendarBlock, CalendarBlockInput } from '@white-box/core/types'
import { validateCalendarBlock } from '@white-box/core/calendar'

const Timestamp = z.number().int().min(0).max(8_640_000_000_000_000)
const InputShape = {
  title: z.string().trim().min(1),
  category: z.enum(['work', 'sleep', 'meal', 'fixed']),
  taskId: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  repeat: z.enum(['none', 'weekly']),
  weekdays: z.array(z.number().int().min(0).max(6)),
  until: z.string().nullable(),
}
function validInput(input: CalendarBlockInput): boolean {
  try { validateCalendarBlock(input); return true } catch { return false }
}
export const CalendarBlockInputSchema = z.strictObject(InputShape).refine(validInput, '予定の日時・繰り返し・関連付けが不正です')
export const CalendarBlockSchema = z.strictObject({ ...InputShape, id: z.string().min(1), cancelled: z.boolean(), createdAt: Timestamp, updatedAt: Timestamp }).refine(validInput, '予定が不正です')

export const CALENDAR_COMMANDS = {
  'calendar:create': { args: CalendarBlockInputSchema, result: CalendarBlockSchema },
  'calendar:update': { args: z.strictObject({ id: z.string().min(1), patch: z.strictObject({ ...InputShape, cancelled: z.boolean() }).partial() }), result: z.null() },
} as const

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _exact: [Exact<z.infer<typeof CalendarBlockInputSchema>, CalendarBlockInput>, Exact<z.infer<typeof CalendarBlockSchema>, CalendarBlock>] = [true, true]
void _exact

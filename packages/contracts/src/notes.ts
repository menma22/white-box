import { z } from 'zod'
import type { Note } from '@white-box/core/notes'

const Timestamp = z.number().int().min(0).max(8_640_000_000_000_000)

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  projectId: z.string().nullable(),
  taskId: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  remindAt: Timestamp.nullable().default(null),
  remindedAt: Timestamp.nullable().default(null),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})

export const NoteCreateArgsSchema = z.strictObject({
  title: z.string().optional(),
  body: z.string().optional(),
  projectId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  remindAt: Timestamp.nullable().optional(),
})
export const NotePatchSchema = NoteCreateArgsSchema

export const NOTE_COMMANDS = {
  'note:create': { args: NoteCreateArgsSchema, result: NoteSchema },
  'note:update': { args: z.strictObject({ id: z.string(), patch: NotePatchSchema }), result: z.null() },
  'note:archive': { args: z.strictObject({ id: z.string(), archived: z.boolean() }), result: z.null() },
  'note:markReminded': { args: z.strictObject({ id: z.string(), remindAt: Timestamp }), result: z.null() },
} as const

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _exact: Exact<z.infer<typeof NoteSchema>, Note> = true
void _exact

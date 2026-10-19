import { z } from 'zod'
import type { PresenceCandidate } from '@white-box/core/presence'

const Timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Id = z.string().refine((value) => Boolean(value.trim()) && !['__proto__', 'constructor', 'prototype'].includes(value), 'IDが不正です')

export const PresenceCandidateSchema = z.strictObject({
  id: Id, sessionId: Id, startedAt: Timestamp, endedAt: Timestamp,
  status: z.enum(['pending', 'accepted', 'dismissed']), createdAt: Timestamp, reviewedAt: Timestamp.nullable(),
}).refine((item) => item.endedAt - item.startedAt >= 10_000, '離席候補は10秒以上で指定してください')
  .refine((item) => (item.status === 'pending') === (item.reviewedAt === null), '確認日時が不正です')

export const PresenceCandidatesSchema = z.array(PresenceCandidateSchema)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, '離席候補のIDが重複しています')

export const PRESENCE_COMMANDS = {
  'presence:resolve': { args: z.strictObject({ id: Id, decision: z.enum(['accept', 'dismiss']) }), result: z.null() },
} as const

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const exact: Exact<z.infer<typeof PresenceCandidateSchema>, PresenceCandidate> = true
void exact

import { z } from 'zod'
import { validControlDate } from '@white-box/core/task-control'

const ControlDateSchema = z.string().refine(validControlDate, '日付は有効な YYYY-MM-DD にする')
const TaskLinksSchema = z.array(z.string().trim().min(1)).max(100).refine((ids) => new Set(ids).size === ids.length, '同じタスクを重複してリンクできない')

export const ExternalBlockSchema = z.strictObject({
  who: z.string().trim().min(1).max(500),
  what: z.string().trim().min(1).max(2000),
  since: ControlDateSchema,
  lastContactOn: ControlDateSchema.nullable(),
  nextFollowUpOn: ControlDateSchema.nullable(),
})

export const TaskControlSchema = z.strictObject({
  blocked: z.boolean().optional(),
  blockReason: z.string().max(2000).optional(),
  hardDependencies: TaskLinksSchema.optional(),
  recommendedPredecessors: TaskLinksSchema.optional(),
  externalBlock: ExternalBlockSchema.nullable().optional(),
})

import { z } from 'zod'
import type { GoalCriterion } from '@white-box/core/goal-criteria'

const nonempty = z.string().refine((value) => Boolean(value.trim()), '入力してください')
const base = {
  id: nonempty.refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value), 'IDが不正です'),
  title: nonempty,
  evidence: z.string(),
}

export const GoalCriterionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...base, kind: z.literal('number'), target: z.number().finite(),
    current: z.number().finite().nullable(), unit: nonempty,
    comparison: z.enum(['at-least', 'at-most', 'equal']),
  }),
  z.strictObject({ ...base, kind: z.literal('observation'), confirmed: z.boolean() })
    .refine((item) => !item.confirmed || Boolean(item.evidence.trim()), '確認した証拠を記入してください'),
])

export const GoalCriteriaSchema = z.array(GoalCriterionSchema)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, '成功条件のIDが重複しています')

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const exact: Exact<z.infer<typeof GoalCriterionSchema>, GoalCriterion> = true
void exact
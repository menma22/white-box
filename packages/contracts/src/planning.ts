import { z } from 'zod'
import type { FixedWork, ProjectAllocation, WeeklyBudgetPlan, WeeklyTimeBudget } from '@white-box/core/types'
import { validateBudgetPlan, validateFixedWork, weekBounds, WEEK_MINUTES } from '@white-box/core/weekly-budget'

const Minutes = z.number().finite().min(0).max(WEEK_MINUTES)
const Timestamp = z.number().int().min(0).max(8_640_000_000_000_000)

export const ProjectAllocationSchema = z.union([
  z.strictObject({ projectId: z.string().min(1), mode: z.enum(['minimum', 'maximum']), minutes: Minutes }),
  z.strictObject({ projectId: z.string().min(1), mode: z.literal('range'), minimumMinutes: Minutes, maximumMinutes: Minutes }),
  z.strictObject({ projectId: z.string().min(1), mode: z.literal('unlimited') }),
])

const PlanShape = {
  sleepMinutes: Minutes,
  mealMinutes: Minutes,
  fixedMinutes: Minutes,
  allocations: z.array(ProjectAllocationSchema),
}

function validPlan(plan: WeeklyBudgetPlan): boolean {
  try { validateBudgetPlan(plan); return true } catch { return false }
}

export const WeekStartSchema = z.string().refine((value) => {
  try { weekBounds(value); return true } catch { return false }
}, '週の開始日は実在する月曜日の日付で指定してください')
export const WeeklyBudgetPlanSchema = z.strictObject(PlanShape).refine(validPlan, '週の生活時間またはプロジェクト配分が不正です')
export const WeeklyTimeBudgetSchema = z.strictObject({ ...PlanShape, weekStart: WeekStartSchema, createdAt: Timestamp, updatedAt: Timestamp }).refine(validPlan, '週の予算が不正です')

const FixedInputShape = {
  taskId: z.string().min(1),
  startedAt: Timestamp,
  endedAt: Timestamp,
  externalReason: z.string().trim().min(1),
}
function validFixed(work: Pick<FixedWork, 'startedAt' | 'endedAt' | 'externalReason'>): boolean {
  try { validateFixedWork(work); return true } catch { return false }
}
export const FixedWorkSchema = z.strictObject({ ...FixedInputShape, id: z.string().min(1), cancelled: z.boolean(), createdAt: Timestamp, updatedAt: Timestamp }).refine(validFixed, '固定予定の時間が不正です')

export const PLANNING_COMMANDS = {
  'weeklyBudget:set': { args: z.strictObject({ weekStart: WeekStartSchema, plan: WeeklyBudgetPlanSchema, reuseAsDefault: z.boolean().optional() }), result: WeeklyTimeBudgetSchema },
  'weeklyBudget:reuseDefaults': { args: z.strictObject({ weekStart: WeekStartSchema }), result: WeeklyTimeBudgetSchema },
  'fixedWork:create': { args: z.strictObject(FixedInputShape).refine(validFixed, '固定予定の終了は開始より後にしてください'), result: FixedWorkSchema },
  'fixedWork:update': { args: z.strictObject({ id: z.string(), patch: z.strictObject({ ...FixedInputShape, cancelled: z.boolean() }).partial() }), result: z.null() },
} as const

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _exact: [Exact<z.infer<typeof ProjectAllocationSchema>, ProjectAllocation>, Exact<z.infer<typeof WeeklyBudgetPlanSchema>, WeeklyBudgetPlan>, Exact<z.infer<typeof WeeklyTimeBudgetSchema>, WeeklyTimeBudget>, Exact<z.infer<typeof FixedWorkSchema>, FixedWork>] = [true, true, true, true]
void _exact

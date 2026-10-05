import type { Database, FixedWork, ProjectAllocation, TimeRange, WeeklyBudgetPlan } from './types.js'
import { pausedMsWithin } from './engine.js'
import { weekRange } from './activity.js'

export const WEEK_MINUTES = 7 * 24 * 60

export function weekBounds(weekStart: string): TimeRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error('週の開始日は月曜日の日付で指定してください')
  const date = new Date(`${weekStart}T00:00:00`)
  if (!Number.isFinite(date.getTime()) || date.getDay() !== 1 ||
      date.getFullYear() !== Number(weekStart.slice(0, 4)) || date.getMonth() + 1 !== Number(weekStart.slice(5, 7)) || date.getDate() !== Number(weekStart.slice(8, 10))) {
    throw new Error('週の開始日は実在する月曜日の日付で指定してください')
  }
  return weekRange(weekStart, 0)
}

function validMinutes(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > WEEK_MINUTES) throw new Error('時間は0〜168時間の範囲で指定してください')
}

export function validateBudgetPlan(plan: WeeklyBudgetPlan): void {
  for (const value of [plan.sleepMinutes, plan.mealMinutes, plan.fixedMinutes]) validMinutes(value)
  if (plan.sleepMinutes + plan.mealMinutes + plan.fixedMinutes > WEEK_MINUTES) throw new Error('生活・固定時間の合計は168時間以内にしてください')
  const projects = new Set<string>()
  for (const allocation of plan.allocations) {
    if (!allocation.projectId || projects.has(allocation.projectId)) throw new Error('プロジェクト配分を重複させないでください')
    projects.add(allocation.projectId)
    if (allocation.mode === 'minimum' || allocation.mode === 'maximum') validMinutes(allocation.minutes)
    else if (allocation.mode === 'range') {
      validMinutes(allocation.minimumMinutes)
      validMinutes(allocation.maximumMinutes)
      if (allocation.minimumMinutes > allocation.maximumMinutes) throw new Error('配分の最小時間は最大時間以下にしてください')
    } else if (allocation.mode !== 'unlimited') throw new Error('配分の方式が不正です')
  }
}

export function validateFixedWork(work: Pick<FixedWork, 'startedAt' | 'endedAt' | 'externalReason'>): void {
  for (const value of [work.startedAt, work.endedAt]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Error('固定予定の日時が不正です')
  }
  if (work.endedAt <= work.startedAt) throw new Error('固定予定の終了は開始より後にしてください')
  if (!work.externalReason.trim()) throw new Error('外部要因で時刻が固定される理由を入力してください')
}

export function fixedWorkMinutes(work: FixedWork[], weekStart: string): number {
  const period = weekBounds(weekStart)
  const ranges = work.filter((item) => !item.cancelled).map((item) => ({
    startedAt: Math.max(period.startedAt, item.startedAt),
    endedAt: Math.min(period.endedAt, item.endedAt),
  })).filter((range) => range.endedAt > range.startedAt)
  return pausedMsWithin(ranges.map((range) => ({ ...range, reason: null })), period.startedAt, period.endedAt, period.endedAt) / 60_000
}

export function allocationBounds(allocation: ProjectAllocation): { minimumMinutes: number; maximumMinutes: number | null } {
  switch (allocation.mode) {
    case 'minimum': return { minimumMinutes: allocation.minutes, maximumMinutes: null }
    case 'maximum': return { minimumMinutes: 0, maximumMinutes: allocation.minutes }
    case 'range': return { minimumMinutes: allocation.minimumMinutes, maximumMinutes: allocation.maximumMinutes }
    case 'unlimited': return { minimumMinutes: 0, maximumMinutes: null }
  }
}

export interface WeeklyBudgetSummary {
  availableMinutes: number
  fixedWorkMinutes: number
  minimumMinutes: number
  maximumMinutes: number | null
  unallocatedMinutes: number
  overcommitted: boolean
}

export function weeklyBudgetSummary(db: Pick<Database, 'weeklyBudgets' | 'fixedWork'>, weekStart: string): WeeklyBudgetSummary | null {
  weekBounds(weekStart)
  const plan = db.weeklyBudgets?.find((budget) => budget.weekStart === weekStart)
  if (!plan) return null
  validateBudgetPlan(plan)
  const fixedMinutes = fixedWorkMinutes(db.fixedWork ?? [], weekStart)
  const availableMinutes = WEEK_MINUTES - plan.sleepMinutes - plan.mealMinutes - plan.fixedMinutes - fixedMinutes
  const bounds = plan.allocations.map(allocationBounds)
  const minimumMinutes = bounds.reduce((sum, bound) => sum + bound.minimumMinutes, 0)
  const maximumMinutes = bounds.some((bound) => bound.maximumMinutes === null) ? null : bounds.reduce((sum, bound) => sum + bound.maximumMinutes!, 0)
  return { availableMinutes, fixedWorkMinutes: fixedMinutes, minimumMinutes, maximumMinutes,
    unallocatedMinutes: availableMinutes - minimumMinutes, overcommitted: minimumMinutes > availableMinutes }
}

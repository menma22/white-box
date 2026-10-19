import type { Database, FixedWork, WeeklyBudgetPlan, WeeklyTimeBudget } from '@white-box/core/types'
import { validateBudgetPlan, validateFixedWork, weekBounds } from '@white-box/core/weekly-budget'
import { newId } from './session-ops.js'

function requireTask(db: Database, taskId: string): void {
  const task = db.tasks.find((item) => item.id === taskId)
  if (!task || task.status === 'done') throw new Error('未完了の作業タスクを選択してください')
  if (db.projects.some((project) => project.id === task.projectId && project.archived)) throw new Error('保管されたプロジェクトの作業は登録できません')
}

function requireAllocations(db: Database, plan: WeeklyBudgetPlan): void {
  validateBudgetPlan(plan)
  for (const allocation of plan.allocations) {
    if (!db.projects.some((project) => project.id === allocation.projectId)) throw new Error('配分先のプロジェクトが見つからない')
  }
}

export function setWeeklyBudget(db: Database, weekStart: string, plan: WeeklyBudgetPlan, now: number): { weeklyBudgets: WeeklyTimeBudget[]; budget: WeeklyTimeBudget } {
  weekBounds(weekStart)
  requireAllocations(db, plan)
  const previous = db.weeklyBudgets?.find((budget) => budget.weekStart === weekStart)
  const budget: WeeklyTimeBudget = { ...structuredClone(plan), weekStart, createdAt: previous?.createdAt ?? now, updatedAt: now }
  return { weeklyBudgets: [...(db.weeklyBudgets ?? []).filter((item) => item.weekStart !== weekStart), budget], budget }
}

export function reuseWeeklyDefaults(db: Database, weekStart: string, now: number): ReturnType<typeof setWeeklyBudget> {
  if (!db.weeklyBudgetDefaults) throw new Error('再利用する既定配分がありません')
  return setWeeklyBudget(db, weekStart, db.weeklyBudgetDefaults, now)
}

export function createFixedWork(db: Database, input: Pick<FixedWork, 'taskId' | 'startedAt' | 'endedAt' | 'externalReason'>, now: number): { fixedWork: FixedWork[]; work: FixedWork } {
  requireTask(db, input.taskId)
  validateFixedWork(input)
  if (input.startedAt <= now) throw new Error('外部固定作業は開始前に登録してください')
  const work: FixedWork = { ...input, externalReason: input.externalReason.trim(), id: newId('fixed'), cancelled: false, createdAt: now, updatedAt: now }
  return { fixedWork: [...(db.fixedWork ?? []), work], work }
}

export function updateFixedWork(db: Database, id: string, patch: Partial<Pick<FixedWork, 'taskId' | 'startedAt' | 'endedAt' | 'externalReason' | 'cancelled'>>, now: number): FixedWork[] {
  const previous = db.fixedWork?.find((work) => work.id === id)
  if (!previous) throw new Error('固定予定が見つからない')
  const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  const next: FixedWork = { ...previous, ...changes, id: previous.id, createdAt: previous.createdAt, updatedAt: now }
  validateFixedWork(next)
  const scheduling = ['taskId', 'startedAt', 'endedAt', 'externalReason'].some((key) => Object.hasOwn(changes, key)) || (previous.cancelled && next.cancelled === false)
  if (scheduling) {
    if (previous.startedAt <= now || next.startedAt <= now) throw new Error('開始後の固定予定を変更できません')
    requireTask(db, next.taskId)
  }
  next.externalReason = next.externalReason.trim()
  return db.fixedWork!.map((work) => work.id === id ? next : work)
}

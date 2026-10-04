export type GoalCriterion = {
  id: string
  title: string
  evidence: string
} & ({
  kind: 'number'
  target: number
  current: number | null
  unit: string
  comparison: 'at-least' | 'at-most' | 'equal'
} | {
  kind: 'observation'
  confirmed: boolean
})

export type CriterionState = 'unmeasured' | 'reached' | 'not-reached' | 'confirmed' | 'unconfirmed'

function text(value: unknown, label: string, required = false): string {
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${label}を入力してください`)
  return value
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('成功条件の数値は有限の数で指定してください')
  return value
}

export function parseGoalCriteria(value: unknown): GoalCriterion[] {
  if (!Array.isArray(value)) throw new Error('成功条件の形式が不正です')
  const ids = new Set<string>()
  return value.map((entry): GoalCriterion => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('成功条件の形式が不正です')
    const raw = entry as Record<string, unknown>
    const id = text(raw.id, '成功条件のID', true)
    if (['__proto__', 'constructor', 'prototype'].includes(id) || ids.has(id)) throw new Error('成功条件のIDが不正または重複しています')
    ids.add(id)
    const base = { id, title: text(raw.title, '成功条件', true), evidence: text(raw.evidence, '証拠') }
    if (raw.kind === 'number') {
      if (!['at-least', 'at-most', 'equal'].includes(raw.comparison as string)) throw new Error('成功条件の比較方法が不正です')
      return { ...base, kind: 'number', target: number(raw.target), current: raw.current === null ? null : number(raw.current), unit: text(raw.unit, '単位', true), comparison: raw.comparison as 'at-least' | 'at-most' | 'equal' }
    }
    if (raw.kind !== 'observation' || typeof raw.confirmed !== 'boolean') throw new Error('成功条件の種別または確認状態が不正です')
    if (raw.confirmed && !base.evidence.trim()) throw new Error('確認した証拠を記入してください')
    return { ...base, kind: 'observation', confirmed: raw.confirmed }
  })
}

export function criterionState(criterion: GoalCriterion): CriterionState {
  if (criterion.kind === 'observation') return criterion.confirmed ? 'confirmed' : 'unconfirmed'
  if (criterion.current === null) return 'unmeasured'
  const reached = criterion.comparison === 'at-least' ? criterion.current >= criterion.target
    : criterion.comparison === 'at-most' ? criterion.current <= criterion.target : criterion.current === criterion.target
  return reached ? 'reached' : 'not-reached'
}

export function summarizeGoalCriteria(criteria: readonly GoalCriterion[] = []): {
  count: number; numericReached: number; observationConfirmed: number; evidenceCount: number
} {
  return {
    count: criteria.length,
    numericReached: criteria.filter((item) => criterionState(item) === 'reached').length,
    observationConfirmed: criteria.filter((item) => criterionState(item) === 'confirmed').length,
    evidenceCount: criteria.filter((item) => item.evidence.trim()).length,
  }
}
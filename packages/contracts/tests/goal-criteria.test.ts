import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/index.js'
import { GoalCriteriaSchema, GoalCriterionSchema } from '../src/goal-criteria.js'

const numeric = { id: 'readers', title: '協力者が読む', evidence: '', kind: 'number', target: 10, current: null, unit: '人', comparison: 'at-least' }

describe('成功条件のIPC契約', () => {
  it('createとupdateが数値・観測条件を落とさず通す', () => {
    const criteria = [numeric, { id: 'approval', title: '協力者が合意する', evidence: '議事録', kind: 'observation', confirmed: true }]
    expect(parseArgs('goal:create', { goal: '成果を得る', criteria })).toEqual({ goal: '成果を得る', criteria })
    expect(parseArgs('goal:update', { id: 'goal', patch: { criteria } })).toEqual({ id: 'goal', patch: { criteria } })
  })

  it('誤ったキーや単位欠落・非有限値を黙って捨てない', () => {
    expect(GoalCriterionSchema.safeParse({ ...numeric, currnet: 3 }).success).toBe(false)
    expect(GoalCriterionSchema.safeParse({ ...numeric, unit: ' ' }).success).toBe(false)
    expect(GoalCriterionSchema.safeParse({ ...numeric, current: Infinity }).success).toBe(false)
    expect(GoalCriterionSchema.safeParse({ id: 'x', title: '合意', evidence: '', kind: 'observation', confirmed: true }).success).toBe(false)
    expect(GoalCriteriaSchema.safeParse([numeric, numeric]).success).toBe(false)
    expect(() => parseArgs('goal:update', { id: 'goal', patch: { criteria: [{ ...numeric, targte: 4 }] } })).toThrow()
  })
})
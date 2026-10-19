import { describe, expect, it } from 'vitest'
import { criterionState, parseGoalCriteria, summarizeGoalCriteria, type GoalCriterion } from '../src/goal-criteria.js'

const numeric: GoalCriterion = { id: 'readers', title: '協力者が読む', evidence: '', kind: 'number', target: 10, current: null, unit: '人', comparison: 'at-least' }

describe('成功条件の判定材料', () => {
  it('未測定を0として扱わず、比較方向とゼロの目標値を守る', () => {
    expect(criterionState(numeric)).toBe('unmeasured')
    expect(criterionState({ ...numeric, current: 9 })).toBe('not-reached')
    expect(criterionState({ ...numeric, current: 10 })).toBe('reached')
    expect(criterionState({ ...numeric, comparison: 'at-most', target: 0, current: 1 })).toBe('not-reached')
    expect(criterionState({ ...numeric, comparison: 'at-most', target: 0, current: 0 })).toBe('reached')
    expect(criterionState({ ...numeric, comparison: 'equal', current: 11 })).toBe('not-reached')
    expect(criterionState({ ...numeric, comparison: 'equal', current: 10 })).toBe('reached')
  })

  it('数値到達と本人確認を別々に集計し、目標達成の判定は返さない', () => {
    const items: GoalCriterion[] = [
      { ...numeric, current: 10 },
      { id: 'approval', title: '協力者が次の方針に合意する', kind: 'observation', evidence: '議事録', confirmed: true },
      { id: 'report', title: '成果物を公開する', kind: 'observation', evidence: '', confirmed: false },
    ]
    expect(summarizeGoalCriteria(items)).toEqual({ count: 3, numericReached: 1, observationConfirmed: 1, evidenceCount: 1 })
    expect(summarizeGoalCriteria()).toEqual({ count: 0, numericReached: 0, observationConfirmed: 0, evidenceCount: 0 })
    expect(parseGoalCriteria(items)).toEqual(items)
  })

  it.each([
    { ...numeric, target: Infinity }, { ...numeric, current: NaN }, { ...numeric, current: undefined },
    { ...numeric, title: ' ' }, { ...numeric, unit: '' }, { ...numeric, comparison: 'more' }, { ...numeric, id: '__proto__' },
    { id: 'approval', title: '合意する', kind: 'observation', evidence: '', confirmed: true },
  ])('不正な成功条件は拒否する: %j', (invalid) => {
    expect(() => parseGoalCriteria([invalid])).toThrow()
  })

  it('重複IDと配列でない形式を拒否する', () => {
    expect(() => parseGoalCriteria([numeric, numeric])).toThrow('重複')
    expect(() => parseGoalCriteria(null)).toThrow()
    expect(() => parseGoalCriteria([null])).toThrow()
  })
})
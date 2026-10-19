import { describe, expect, it, vi } from 'vitest'
import { normalizeDatabase } from '../src/infra/store.js'
import { task } from './helpers.js'
import { taskExecutionProblem } from '@white-box/core/task-control'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

describe('task control persistence normalization', () => {
  it('preserves legacy task shape, progress, status and session records', () => {
    const legacy = task({ id: 'legacy', progress: 70 })
    const normalized = normalizeDatabase({ tasks: [legacy], sessions: [] })
    expect(normalized.tasks).toEqual([legacy])
    expect(normalized.tasks[0]).not.toHaveProperty('blocked')
    expect(taskExecutionProblem(normalized, legacy.id)).toBeNull()
  })
  it('retains deleted hard references across load and keeps them blocked', () => {
    const dependent = task({ id: 'dependent', hardDependencies: ['deleted'] })
    const normalized = normalizeDatabase({ tasks: [dependent] })
    expect(normalized.tasks[0]!.hardDependencies).toEqual(['deleted'])
    expect(taskExecutionProblem(normalized, dependent.id)).toContain('リンク解除')
  })
  it.each([
    [task({ id: 'a', hardDependencies: ['a'] })],
    [task({ id: 'a', hardDependencies: ['b'] }), task({ id: 'b', recommendedPredecessors: ['a'] })],
    [task({ id: 'a', hardDependencies: ['b'], recommendedPredecessors: ['b'] }), task({ id: 'b' })],
  ])('rejects corrupt imported graphs %j', (...tasks) => {
    expect(() => normalizeDatabase({ tasks })).toThrow()
  })
})

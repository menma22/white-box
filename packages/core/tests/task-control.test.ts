import { describe, expect, it } from 'vitest'
import type { Task } from '../src/types.js'
import { followUpDue, normalizeTaskControl, taskBlockReasons, taskExecutionProblem, unfinishedPredecessors, validateTaskGraph, validateTaskLinks } from '../src/task-control.js'

const task = (id: string, over: Partial<Task> = {}): Task => ({ id, title: id, projectId: null, parentId: null, notes: '', status: 'todo', progress: 70, priority: 'normal', order: 0, createdAt: 0, updatedAt: 0, doneAt: null, createdInSessionId: null, ...over })

describe('task control', () => {
  it('validates deep prerequisite graphs without rejecting readable acyclic data', () => {
    const tasks = Array.from({ length: 20_000 }, (_, index) => task(String(index), { hardDependencies: index < 19_999 ? [String(index + 1)] : [] }))
    expect(() => validateTaskGraph(tasks)).not.toThrow()
    tasks[19_999]!.recommendedPredecessors = ['0']
    expect(() => validateTaskGraph(tasks)).toThrow('循環')
  })
  it('legacy defaults and manual unblock preserve status and progress', () => {
    const legacy = task('a')
    const normalized = normalizeTaskControl(legacy)
    expect(normalized).toMatchObject({ status: 'todo', progress: 70, blocked: false, hardDependencies: [], recommendedPredecessors: [], externalBlock: null })
    expect(legacy).not.toHaveProperty('blocked')
    expect(taskBlockReasons({ tasks: [legacy], projects: [] }, { ...legacy, blocked: true, blockReason: '確認中' })).toEqual(['確認中'])
  })
  it('100% progress is not predecessor completion; recommendations never prevent execution', () => {
    const a = task('a', { progress: 100 })
    const b = task('b', { recommendedPredecessors: ['a'] })
    const context = { tasks: [a, b], projects: [] }
    expect(unfinishedPredecessors(context, b, 'recommended')).toHaveLength(1)
    expect(taskExecutionProblem(context, b.id)).toBeNull()
    b.hardDependencies = ['a']; b.recommendedPredecessors = []
    expect(taskExecutionProblem(context, b.id)).toContain('完了待ち')
    a.status = 'done'
    expect(taskExecutionProblem(context, b.id)).toBeNull()
  })
  it('missing references remain blocking until their hard link is removed', () => {
    const b = task('b', { hardDependencies: ['deleted'] })
    const context = { tasks: [b], projects: [] }
    expect(taskExecutionProblem(context, b.id)).toContain('リンク解除')
    expect(() => validateTaskLinks(context.tasks, b, b)).not.toThrow()
    expect(() => validateTaskLinks(context.tasks, b)).toThrow('見つからない')
    b.hardDependencies = []
    expect(taskExecutionProblem(context, b.id)).toBeNull()
  })
  it('rejects self links, combined graph cycles and duplicate kinds', () => {
    const a = task('a', { hardDependencies: ['b'] })
    const b = task('b', { recommendedPredecessors: ['a'] })
    expect(() => validateTaskLinks([a, b], a)).toThrow('循環')
    expect(() => validateTaskLinks([task('a', { hardDependencies: ['a'] })], task('a', { hardDependencies: ['a'] }))).toThrow('自身')
    expect(() => validateTaskLinks([a, task('b')], { ...a, recommendedPredecessors: ['b'] })).toThrow('重複')
  })
  it('follow-up becomes due on the selected local calendar day, and remains due afterward', () => {
    const block = { who: 'person', what: 'reply', since: '2026-10-01', lastContactOn: null, nextFollowUpOn: '2026-10-05' }
    expect(followUpDue(block, '2026-10-04')).toBe(false)
    expect(followUpDue(block, '2026-10-05')).toBe(true)
    expect(followUpDue(block, '2026-10-06')).toBe(true)
    expect(followUpDue({ ...block, nextFollowUpOn: null }, '2026-10-06')).toBe(false)
  })
})

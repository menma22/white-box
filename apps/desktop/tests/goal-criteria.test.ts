import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type GoalCriterion } from '@white-box/core/goal-criteria'
import { parseGoalMap } from '@white-box/core/goal-map'
import { createGoal, importGoals, updateGoal } from '../src/domain/goal-ops.js'
import { createTask, updateTask } from '../src/domain/task-ops.js'
import { normalizeDatabase, Store } from '../src/infra/store.js'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
const numeric: GoalCriterion = { id: 'readers', title: '協力者が読む', evidence: '', kind: 'number', target: 10, current: null, unit: '人', comparison: 'at-least' }

describe('目標の成功条件の保存境界', () => {
  it('抽象的な目標を作成でき、条件更新・数値到達・タスク完了はoutcomeを変えない', () => {
    const db = normalizeDatabase({})
    const created = createGoal(db, { goal: '社会に役立つ' })
    db.goalMap = created.goalMap
    const before = structuredClone(db)
    const criteria: GoalCriterion[] = [{ ...numeric, current: 10 }, { id: 'approval', title: '合意する', evidence: '議事録', kind: 'observation', confirmed: true }]
    db.goalMap = updateGoal(db, created.goal.id, { criteria })
    expect(db.goalMap.nodes[created.goal.id]!.outcome).toEqual(before.goalMap.nodes[created.goal.id]!.outcome)
    expect(before.goalMap.nodes[created.goal.id]!.criteria).toBeUndefined()
    const task = createTask(db, { title: '作業', goalNodeId: created.goal.id })
    db.tasks = task.tasks
    db.tasks = updateTask(db, task.task.id, { status: 'done' })
    expect(db.goalMap.nodes[created.goal.id]!.outcome!.status).toBe('pending')
    expect(parseGoalMap(db.goalMap).nodes[created.goal.id]!.criteria).toEqual(criteria)
    expect(parseGoalMap(before.goalMap).nodes[created.goal.id]!.criteria).toBeUndefined()
  })

  it('不正な条件の追加・更新は元データを部分更新しない', () => {
    const db = normalizeDatabase({})
    const created = createGoal(db, { goal: '成果', criteria: [numeric] })
    db.goalMap = created.goalMap
    const before = structuredClone(db)
    expect(() => updateGoal(db, created.goal.id, { goal: '変更されない', criteria: [{ ...numeric, current: Infinity }] })).toThrow()
    expect(() => createGoal(db, { goal: '子', parentId: created.goal.id, criteria: [{ ...numeric, unit: '' }] })).toThrow()
    expect(db).toEqual(before)
  })

  it('保存・再読込・DB書き出し/置換で条件を保持する', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-criteria-'))
    dirs.push(dir)
    const store = new Store(dir)
    const created = createGoal(store.data, { goal: '成果', criteria: [numeric] })
    store.data.goalMap = created.goalMap
    store.save()
    const reopened = new Store(dir)
    expect(reopened.data.goalMap.nodes[created.goal.id]!.criteria).toEqual([numeric])
    reopened.replace(JSON.parse(JSON.stringify(reopened.data)))
    expect(new Store(dir).data.goalMap.nodes[created.goal.id]!.criteria).toEqual([numeric])
  })

  it('道標の追加取り込みも条件を保持し、不正な条件を拒否する', () => {
    const db = normalizeDatabase({})
    const source = { version: 1, nodes: { n: { id: 'n', goal: '成果', reason: '', parentId: null, children: [], criteria: [numeric] } }, heads: ['n'], activeHeadId: 'n' }
    const imported = importGoals(db, source)
    expect(imported.goalMap.nodes[imported.goalMap.heads[0]!]!.criteria).toEqual([numeric])
    const before = structuredClone(db)
    expect(() => importGoals(db, { ...source, nodes: { n: { ...source.nodes.n, criteria: [{ ...numeric, current: '10' }] } } })).toThrow()
    expect(db).toEqual(before)
  })
})
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseArgs } from '@white-box/contracts'
import { goalHead, isGoalHidden, parseGoalMap } from '@white-box/core/goal-map'
import type { Database } from '@white-box/core/types'
import { createGoal, createIssue, hideGoal, importGoals, insertGoal, reparentGoal, updateGoal } from '../src/domain/goal-ops.js'
import { createTask } from '../src/domain/task-ops.js'
import { normalizeDatabase, Store } from '../src/infra/store.js'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

function add(db: Database, goal: string, parentId: string | null = null) {
  const result = createGoal(db, { goal, parentId })
  db.goalMap = result.goalMap
  return result.goal.id
}

function tree() {
  const db = normalizeDatabase({})
  const a = add(db, 'A')
  const before = add(db, 'Before', a)
  const branch = add(db, 'Branch', a)
  const leaf = add(db, 'Leaf', branch)
  const after = add(db, 'After', a)
  const b = add(db, 'B')
  const other = add(db, 'Other', b)
  db.goalMap.activeHeadId = a
  return { db, a, before, branch, leaf, after, b, other }
}

describe('goal branch reparenting', () => {
  it('moves the whole subtree and preserves node data, remaining sibling order, tasks and issues', () => {
    const { db, a, before, branch, leaf, after, b, other } = tree()
    db.goalMap = updateGoal(db, leaf, {
      outcome: { status: 'achieved', result: 'Verified' },
      criteria: [{ id: 'proof', title: 'Observed', evidence: 'Evidence', kind: 'observation', confirmed: true }],
    })
    db.goalMap = hideGoal(db, leaf, 'Keep hidden')
    const task = createTask(db, { title: 'Linked task', goalNodeId: leaf })
    db.tasks = task.tasks
    const issue = createIssue(db, { text: 'Linked issue', kind: 'problem', nodeId: branch })
    db.goalMap = issue.goalMap
    const original = structuredClone(db)
    const result = reparentGoal(db, { id: branch, parentId: b })
    expect(db).toEqual(original)
    expect(result.goal).toEqual({ ...original.goalMap.nodes[branch], parentId: b })
    expect(result.goalMap.nodes[a]!.children).toEqual([before, after])
    expect(result.goalMap.nodes[b]!.children).toEqual([other, branch])
    expect(result.goalMap.nodes[leaf]).toEqual(original.goalMap.nodes[leaf])
    expect(isGoalHidden(result.goalMap, leaf)).toBe(true)
    expect(result.goalMap.heads).toEqual([a, b])
    expect(result.goalMap.activeHeadId).toBe(a)
    expect(result.goalMap.issues).toEqual(original.goalMap.issues)
    expect(db.tasks).toEqual(original.tasks)
    expect(result.goalMap.history.slice(0, -1)).toEqual(original.goalMap.history)
    expect(result.goalMap.history.at(-1)).toMatchObject({ type: 'reparent', nodeId: branch, parentId: b, withIds: [a] })
    expect(parseGoalMap(result.goalMap)).toEqual(result.goalMap)
  })

  it('moves roots across heads, follows an active moved root, and appends a detached branch as a head', () => {
    const { db, a, branch, leaf, b, other } = tree()
    const c = add(db, 'C')
    db.goalMap.activeHeadId = a
    db.goalMap = reparentGoal(db, { id: a, parentId: other }).goalMap
    expect(db.goalMap.heads).toEqual([b, c])
    expect(db.goalMap.activeHeadId).toBe(b)
    expect(goalHead(db.goalMap, leaf)).toBe(b)
    expect(db.goalMap.history.at(-1)).toMatchObject({ parentId: other, withIds: [] })
    db.goalMap = reparentGoal(db, { id: branch, parentId: null }).goalMap
    expect(db.goalMap.heads).toEqual([b, c, branch])
    expect(db.goalMap.nodes[a]!.children).not.toContain(branch)
    expect(db.goalMap.nodes[branch]!.children).toEqual([leaf])
    expect(db.goalMap.nodes[branch]!.parentId).toBeNull()
    expect(db.goalMap.activeHeadId).toBe(b)
    expect(parseGoalMap(db.goalMap)).toEqual(db.goalMap)
  })

  it('preserves an unrelated active head and chooses the destination if no head is active', () => {
    const { db, a, branch, b } = tree()
    db.goalMap.activeHeadId = b
    db.goalMap = reparentGoal(db, { id: a, parentId: b }).goalMap
    expect(db.goalMap.activeHeadId).toBe(b)
    db.goalMap.activeHeadId = null
    db.goalMap = reparentGoal(db, { id: branch, parentId: null }).goalMap
    expect(db.goalMap.activeHeadId).toBe(branch)
  })

  it('treats the current parent and an existing head detach as no-ops without adding history', () => {
    const { db, a, branch } = tree()
    for (const [id, parentId] of [[branch, a], [a, null]] as const) {
      const original = structuredClone(db)
      const result = reparentGoal(db, { id, parentId })
      expect(result.goalMap).toBe(db.goalMap)
      expect(result.goal).toBe(db.goalMap.nodes[id])
      expect(db).toEqual(original)
    }
  })

  it('rejects self, descendants, missing nodes, and hidden ancestors atomically', () => {
    const { db, a, branch, leaf, b, other } = tree()
    db.goalMap = hideGoal(db, b, '')
    db.goalMap.ui.showHidden = true
    const original = structuredClone(db)
    for (const [id, parentId] of [[branch, branch], [a, leaf], ['missing', a], [branch, 'missing'], ['toString', a], [branch, other], [other, a], [other, null]] as const) {
      expect(() => reparentGoal(db, { id, parentId })).toThrow()
      expect(db).toEqual(original)
    }
  })
})

describe('intermediate goal insertion', () => {
  it('replaces exactly the target sibling position without changing its subtree or linked records', () => {
    const { db, a, before, branch, leaf, after } = tree()
    const task = createTask(db, { title: 'Linked', goalNodeId: leaf })
    db.tasks = task.tasks
    const issue = createIssue(db, { text: 'Question', kind: 'question', nodeId: branch })
    db.goalMap = issue.goalMap
    const original = structuredClone(db)
    const result = insertGoal(db, { id: branch, goal: 'Intermediate', reason: 'Required step' })
    expect(db).toEqual(original)
    expect(result.goal).toMatchObject({ goal: 'Intermediate', reason: 'Required step', parentId: a, children: [branch], hidden: false })
    expect(result.goalMap.nodes[a]!.children).toEqual([before, result.goal.id, after])
    expect(result.goalMap.nodes[branch]).toEqual({ ...original.goalMap.nodes[branch], parentId: result.goal.id })
    expect(result.goalMap.nodes[leaf]).toEqual(original.goalMap.nodes[leaf])
    expect(Object.keys(result.goalMap.nodes)).toHaveLength(Object.keys(original.goalMap.nodes).length + 1)
    expect(result.goalMap.heads).toEqual(original.goalMap.heads)
    expect(result.goalMap.activeHeadId).toBe(original.goalMap.activeHeadId)
    expect(result.goalMap.issues).toEqual(original.goalMap.issues)
    expect(db.tasks).toEqual(original.tasks)
    expect(result.goalMap.history.at(-1)).toMatchObject({ type: 'insert', nodeId: result.goal.id, parentId: a, withIds: [branch] })
    expect(parseGoalMap(result.goalMap)).toEqual(result.goalMap)
  })

  it('rejects roots, missing nodes, hidden branches, and invalid text without a partial insertion', () => {
    const { db, a, branch, leaf } = tree()
    db.goalMap = hideGoal(db, branch, '')
    db.goalMap.ui.showHidden = true
    const original = structuredClone(db)
    for (const id of [a, 'missing', 'valueOf', branch, leaf]) {
      expect(() => insertGoal(db, { id, goal: 'Rejected' })).toThrow()
      expect(db).toEqual(original)
    }
    const visible = add(db, 'Visible', a)
    const before = structuredClone(db)
    expect(() => insertGoal(db, { id: visible, goal: 42 as never })).toThrow()
    expect(() => insertGoal(db, { id: visible, goal: 'Valid', reason: 42 as never })).toThrow()
    expect(db).toEqual(before)
  })

  it('keeps both operations and their history through save, reload, replacement, and goal import', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-branch-'))
    dirs.push(dir)
    const store = new Store(dir)
    const a = add(store.data, 'A')
    const child = add(store.data, 'Child', a)
    const b = add(store.data, 'B')
    store.data.goalMap = reparentGoal(store.data, { id: child, parentId: b }).goalMap
    store.data.goalMap = insertGoal(store.data, { id: child, goal: 'Intermediate' }).goalMap
    store.save()
    const reopened = new Store(dir)
    expect(reopened.data.goalMap).toEqual(store.data.goalMap)
    reopened.replace(JSON.parse(JSON.stringify(reopened.data)))
    expect(new Store(dir).data.goalMap).toEqual(store.data.goalMap)
    const imported = importGoals(normalizeDatabase({}), { version: 1, ...store.data.goalMap })
    expect(imported.goalMap.history.slice(-2).map((entry) => entry.type)).toEqual(['reparent', 'insert'])
    expect(parseGoalMap(imported.goalMap)).toEqual(imported.goalMap)
  })
})

describe('branch command argument validation', () => {
  it('requires an explicit nullable parent and strictly typed insertion text', () => {
    expect(parseArgs('goal:reparent', { id: 'a', parentId: null })).toEqual({ id: 'a', parentId: null })
    expect(parseArgs('goal:insert', { id: 'a', goal: 'Intermediate', reason: 'Reason' })).toEqual({ id: 'a', goal: 'Intermediate', reason: 'Reason' })
    for (const args of [{ id: 'a' }, { id: 'a', parentId: 42 }, { id: 'a', parentId: null, parent: 'b' }]) {
      expect(() => parseArgs('goal:reparent', args)).toThrow()
    }
    for (const args of [{ id: 'a' }, { id: 'a', goal: 42 }, { id: 'a', goal: 'Intermediate', reason: null }]) {
      expect(() => parseArgs('goal:insert', args)).toThrow()
    }
  })
})
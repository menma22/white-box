import { describe, expect, it } from 'vitest'
import { createTask, deleteTask, descendantIds, updateTask } from '../src/domain/task-ops.js'
import { validateTaskHierarchy } from '../src/domain/task-hierarchy.js'
import { createSession, endSession } from '../src/domain/session-ops.js'
import { emptyDb, task } from './helpers.js'

describe('task parent integrity', () => {
  it('rejects self and indirect parent cycles without changing the input', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'parent' }), task({ id: 'child', parentId: 'parent' })]
    const before = structuredClone(db)
    expect(() => updateTask(db, 'parent', { parentId: 'parent' })).toThrow('循環')
    expect(() => updateTask(db, 'parent', { parentId: 'child' })).toThrow('循環')
    expect(db).toEqual(before)
  })

  it('rejects new missing-parent links while preserving a retained historical link', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'orphan', parentId: 'removed' })]
    expect(() => createTask(db, { title: 'New', parentId: 'missing' })).toThrow('親タスク')
    expect(() => updateTask(db, 'orphan', { parentId: 'another-missing' })).toThrow('親タスク')
    expect(updateTask(db, 'orphan', { title: 'Renamed' })[0]!.parentId).toBe('removed')
    expect(updateTask(db, 'orphan', { parentId: null })[0]!.parentId).toBeNull()
  })

  it('walks deep valid trees iteratively and preserves all historical sessions on deletion', () => {
    const db = emptyDb()
    db.tasks = Array.from({ length: 8000 }, (_, index) => task({ id: `node-${index}`, parentId: index === 0 ? null : `node-${index - 1}` }))
    db.sessions = [endSession(createSession({ taskId: 'node-7000', taskTitle: 'Historical', plannedMs: 60_000, now: 1000 }), 2000)]
    const recorded = structuredClone(db.sessions)
    expect(() => validateTaskHierarchy(db.tasks)).not.toThrow()
    expect(descendantIds(db, 'node-0')).toHaveLength(7999)
    expect(deleteTask(db, 'node-0')).toEqual([])
    expect(db.tasks).toHaveLength(8000)
    expect(db.sessions).toEqual(recorded)
  })

  it('fails with an explicit cycle error rather than a stack overflow while traversing corrupt trees', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a', parentId: 'b' }), task({ id: 'b', parentId: 'a' })]
    expect(() => descendantIds(db, 'a')).toThrow('循環')
    expect(() => deleteTask(db, 'a')).toThrow('循環')
    expect(db.tasks).toHaveLength(2)
  })
})

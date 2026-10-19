import { describe, expect, it } from 'vitest'
import { createHandlers } from '../src/app/handlers.js'
import { buildState } from '../src/app/state.js'
import { createCalendarBlock, updateCalendarBlock } from '../src/domain/calendar-ops.js'
import type { CalendarBlockInput } from '@white-box/core/types'
import { emptyDb, fakeCtx, task } from './helpers.js'

const project = { id: 'p', name: 'P', hue: 18, archived: false, order: 0, createdAt: 0, updatedAt: 0 }
const input: CalendarBlockInput = { title: ' Plan ', category: 'work', taskId: 't', projectId: 'p', startedAt: 100, endedAt: 200, repeat: 'none', weekdays: [], until: null }
function context() {
  const db = emptyDb()
  db.projects = [project]
  db.tasks = [task({ id: 't', projectId: 'p', status: 'done', doneAt: 10 })]
  db.dayNotes = { '2026-10-05': 'keep this' }
  return fakeCtx(db)
}

describe('calendar transactions', () => {
  it('allows freely scheduled past/done work and preserves tasks, sessions, notes, and fixed work', () => {
    const ctx = context()
    ctx.store.data.fixedWork = [{ id: 'legacy', taskId: 't', startedAt: 20, endedAt: 30, externalReason: 'Meeting', cancelled: false, createdAt: 0, updatedAt: 0 }]
    const original = structuredClone(ctx.store.data)
    const result = createHandlers(ctx)['calendar:create'](input)
    expect(result).toMatchObject({ title: 'Plan', cancelled: false, createdAt: ctx.now(), updatedAt: ctx.now() })
    expect(ctx.store.data).toEqual({ ...original, calendarBlocks: [result] })
    expect(ctx.calls).toEqual(['publish'])
    expect(buildState(ctx.store.data, ctx.runtime, ctx.now()).calendarBlocks).toEqual([result])
  })
  it('requires existing and consistent task/project associations and permits project-only/free work', () => {
    const ctx = context()
    expect(() => createCalendarBlock(ctx.store.data, { ...input, taskId: 'missing' }, ctx.now())).toThrow('タスク')
    expect(() => createCalendarBlock(ctx.store.data, { ...input, projectId: 'missing' }, ctx.now())).toThrow('プロジェクト')
    expect(() => createCalendarBlock(ctx.store.data, { ...input, projectId: null }, ctx.now())).toThrow('一致')
    expect(() => createCalendarBlock(ctx.store.data, { ...input, taskId: null }, ctx.now())).not.toThrow()
    expect(() => createCalendarBlock(ctx.store.data, { ...input, taskId: null, projectId: null }, ctx.now())).not.toThrow()
    expect(() => createCalendarBlock(ctx.store.data, { ...input, category: 'meal' }, ctx.now())).toThrow('生活予定')
  })
  it('edits the complete recurring series, keeps immutable fields, and validates merged partial patches', () => {
    const ctx = context()
    const created = createCalendarBlock(ctx.store.data, { ...input, repeat: 'weekly', weekdays: [1, 3] }, ctx.now())
    ctx.store.data.calendarBlocks = created.calendarBlocks
    ctx.advance(100)
    const result = updateCalendarBlock(ctx.store.data, created.block.id, { title: ' Next ', weekdays: [2, 4], createdAt: 1, id: 'hijack' } as never, ctx.now())
    expect(result[0]).toMatchObject({ id: created.block.id, title: 'Next', createdAt: created.block.createdAt, updatedAt: ctx.now(), weekdays: [2, 4] })
    expect(ctx.store.data.calendarBlocks[0]).toEqual(created.block)
    expect(() => updateCalendarBlock(ctx.store.data, created.block.id, { endedAt: 99 }, ctx.now())).toThrow('終了')
    expect(() => updateCalendarBlock(ctx.store.data, created.block.id, { repeat: 'none' }, ctx.now())).toThrow('単発')
    expect(() => updateCalendarBlock(ctx.store.data, created.block.id, { taskId: 'missing' }, ctx.now())).toThrow('タスク')
    expect(() => updateCalendarBlock(ctx.store.data, created.block.id, { category: 'sleep' }, ctx.now())).toThrow('生活予定')
    expect(updateCalendarBlock(ctx.store.data, created.block.id, { repeat: 'none', weekdays: [], until: null }, ctx.now())[0]!.repeat).toBe('none')
    expect(() => updateCalendarBlock(ctx.store.data, 'missing', {}, ctx.now())).toThrow('見つからない')
  })
  it('keeps cancellation records and permits cancellation/title edits after the linked task disappears', () => {
    const ctx = context()
    const handlers = createHandlers(ctx)
    const created = handlers['calendar:create'](input)
    if (created instanceof Promise) throw new Error('expected synchronous create')
    ctx.store.data.tasks = []
    ctx.store.data.projects = []
    handlers['calendar:update']({ id: created.id, patch: { cancelled: true, title: 'Cancelled' } })
    expect(ctx.store.data.calendarBlocks).toHaveLength(1)
    expect(ctx.store.data.calendarBlocks![0]).toMatchObject({ id: created.id, taskId: 't', projectId: 'p', cancelled: true, title: 'Cancelled' })
    handlers['calendar:update']({ id: created.id, patch: { cancelled: false } })
    expect(ctx.store.data.calendarBlocks![0]!.cancelled).toBe(false)
  })
  it('rolls back a new optional collection and updates exactly when save fails', () => {
    const ctx = context()
    const handlers = createHandlers(ctx)
    const original = structuredClone(ctx.store.data)
    ctx.publish = () => { throw new Error('save failure') }
    expect(() => handlers['calendar:create'](input)).toThrow('save failure')
    expect(ctx.store.data).toEqual(original)
    expect(ctx.store.data).not.toHaveProperty('calendarBlocks')
    ctx.publish = () => {}
    const created = handlers['calendar:create'](input)
    if (created instanceof Promise) throw new Error('expected synchronous create')
    const beforeUpdate = structuredClone(ctx.store.data)
    ctx.publish = () => { throw new Error('save failure') }
    expect(() => handlers['calendar:update']({ id: created.id, patch: { title: 'Unsaved', cancelled: true } })).toThrow('save failure')
    expect(ctx.store.data).toEqual(beforeUpdate)
  })
  it('permits editor flushing during shutdown preparation and rejects writes after quit starts', () => {
    const ctx = context()
    ctx.runtime.preparingQuit = true
    const handlers = createHandlers(ctx)
    const created = handlers['calendar:create'](input)
    if (created instanceof Promise) throw new Error('expected synchronous create')
    expect(() => handlers['calendar:update']({ id: created.id, patch: { title: 'Flushed' } })).not.toThrow()
    ctx.runtime.quitting = true
    expect(() => handlers['calendar:update']({ id: created.id, patch: { title: 'Too late' } })).toThrow('終了中')
  })
})

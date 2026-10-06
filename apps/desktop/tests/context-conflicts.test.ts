import { describe, expect, it, vi } from 'vitest'
import { createHandlers } from '../src/app/handlers.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

describe('task context concurrent edits', () => {
  it('rejects a stale same-field save and retains the first committed text', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't', notes: 'original' })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    const publish = vi.spyOn(ctx, 'publish')
    handlers['task:update']({ id: 't', patch: { notes: 'first editor' }, expectedContext: { notes: 'original' } })
    expect(() => handlers['task:update']({ id: 't', patch: { notes: 'second editor' }, expectedContext: { notes: 'original' } })).toThrow('別の画面')
    expect(ctx.store.data.tasks[0]!.notes).toBe('first editor')
    expect(publish).toHaveBeenCalledTimes(1)
    handlers['task:update']({ id: 't', patch: { notes: 'second editor' }, expectedContext: { notes: 'first editor' } })
    expect(ctx.store.data.tasks[0]!.notes).toBe('second editor')
  })

  it('permits independent fields and legacy missing context without changing progress', () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't', progress: 70 })]
    const ctx = fakeCtx(db)
    const handlers = createHandlers(ctx)
    handlers['task:update']({ id: 't', patch: { nextContext: 'next step' }, expectedContext: { nextContext: '' } })
    handlers['task:update']({ id: 't', patch: { problems: 'open issue' }, expectedContext: { problems: '' } })
    expect(ctx.store.data.tasks[0]).toMatchObject({ nextContext: 'next step', problems: 'open issue', progress: 70 })
  })
})

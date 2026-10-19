import { describe, expect, it } from 'vitest'
import { emptyDb, fakeCtx, task } from '../../apps/desktop/tests/helpers.js'
import { createHandlers, dispatch } from '../../apps/desktop/src/app/handlers.js'
import { createSession } from '../../apps/desktop/src/domain/session-ops.js'
import { validateStoredDatabase } from '../../apps/desktop/src/infra/database-validation.js'
import { focusMs } from '@white-box/core/engine'

describe('independent final safety boundary probes', () => {
  it('rejects a live future start and leaves the subsequent ended database readable', async () => {
    const ctx = fakeCtx()
    ctx.store.data.tasks = [task({ id: 'active', status: 'doing' })]
    const session = createSession({ taskId: 'active', taskTitle: 'Active', mode: 'stopwatch', plannedMs: 60_000, now: ctx.now() })
    ctx.store.data.sessions = [session]
    const handlers = createHandlers(ctx)
    const before = structuredClone(ctx.store.data)
    await expect(dispatch(handlers, 'session:update', { id: session.id, patch: { startedAt: ctx.now() + 86_400_000 } })).rejects.toThrow('未来')
    expect(ctx.store.data).toEqual(before)
    await dispatch(handlers, 'session:end', {})
    const persisted = JSON.parse(JSON.stringify(ctx.store.data))
    expect(() => validateStoredDatabase(persisted)).not.toThrow()
  })

  it('stops imported recent work while the current-work window remains open', async () => {
    const ctx = fakeCtx()
    ctx.runtime.currentWorkOpen = true
    const imported = emptyDb()
    imported.tasks = [task({ id: 'imported', status: 'doing' })]
    const session = createSession({ taskId: 'imported', taskTitle: 'Imported', mode: 'stopwatch', plannedMs: 60_000, now: ctx.now() })
    imported.sessions = [session]
    ctx.dataIO.importData = async () => { ctx.store.replace(imported); return 'fixture.json' }
    await dispatch(createHandlers(ctx), 'data:import', {})
    const initial = focusMs(ctx.store.data.sessions[0]!, ctx.now())
    ctx.advance(60_000)
    expect(ctx.runtime.currentWorkOpen).toBe(true)
    expect(ctx.store.data.sessions[0]!.state).toBe('paused')
    expect(focusMs(ctx.store.data.sessions[0]!, ctx.now()) - initial).toBe(0)
    expect(() => validateStoredDatabase(JSON.parse(JSON.stringify(ctx.store.data)))).not.toThrow()
  })

  it('preserves a valid close after the system clock goes backwards', async () => {
    const ctx = fakeCtx()
    ctx.store.data.tasks = [task({ id: 'active', status: 'doing' })]
    const session = createSession({ taskId: 'active', taskTitle: 'Active', mode: 'stopwatch', plannedMs: 60_000, now: ctx.now() })
    ctx.store.data.sessions = [session]
    ctx.advance(-60_000)
    await dispatch(createHandlers(ctx), 'session:end', {})
    const persisted = JSON.parse(JSON.stringify(ctx.store.data))
    expect(persisted.sessions[0].endedAt).toBeGreaterThanOrEqual(session.startedAt)
    expect(() => validateStoredDatabase(persisted)).not.toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { RendererFlush, type FlushTarget, type ReleaseEditors } from '../src/infra/renderer-flush.js'
import { createHandlers } from '../src/app/handlers.js'
import { fakeCtx, task } from './helpers.js'

function target(id: number, kind: FlushTarget['kind'] = 'current') {
  const closed = new Set<() => void>()
  return { id, kind, send: vi.fn(), focus: vi.fn(),
    onClosed(callback: () => void) { closed.add(callback); return () => { closed.delete(callback) } },
    close() { for (const callback of [...closed]) callback() },
  }
}

afterEach(() => vi.useRealTimers())

describe('renderer flush acknowledgement', () => {
  it('waits for the matching sender and keeps a closing window locked until native close', async () => {
    const current = target(10)
    let open = true
    current.onClosed(() => { open = false })
    const manager = new RendererFlush(() => open ? [current] : [])
    manager.setReady(10, true)
    const prepared = manager.prepare('end')
    const request = current.send.mock.calls[0]![1] as { id: string }
    manager.reply(11, { id: request.id, ok: true })
    manager.reply(10, { id: 'wrong', ok: true })
    let finished = false
    void prepared.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    manager.reply(10, { id: request.id, ok: true })
    const release = await prepared
    release(['current'])
    expect(current.send).not.toHaveBeenCalledWith('whitebox:flush-release', request.id)
    current.close()
    expect(current.send).toHaveBeenCalledWith('whitebox:flush-release', request.id)
    current.send.mockClear()
    await manager.prepare('quit')
    expect(current.send).not.toHaveBeenCalled()
  })

  it('vetoes on a failed save and releases all windows without accepting late replies', async () => {
    const current = target(10)
    const main = target(20, 'main')
    const manager = new RendererFlush(() => [current, main])
    manager.setReady(10, true)
    manager.setReady(20, true)
    const prepared = manager.prepare('switch')
    const requests = [current, main].map((item) => item.send.mock.calls[0]![1] as { id: string })
    manager.reply(10, { id: requests[0]!.id, ok: false })
    await expect(prepared).rejects.toThrow('操作を取り消しました')
    for (const [index, item] of [current, main].entries()) expect(item.send).toHaveBeenCalledWith('whitebox:flush-release', requests[index]!.id)
    manager.reply(20, { id: requests[1]!.id, ok: true })
  })

  it('vetoes a missing acknowledgement rather than closing after a timeout', async () => {
    vi.useFakeTimers()
    const current = target(10)
    const manager = new RendererFlush(() => [current], 100)
    manager.setReady(10, true)
    const prepared = manager.prepare('close')
    const assertion = expect(prepared).rejects.toThrow('操作を取り消しました')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(current.focus).toHaveBeenCalledOnce()
    expect(current.send.mock.calls.map((call) => call[0])).toEqual(['whitebox:flush-request', 'whitebox:flush-release'])
  })

  it('includes a loading window and waits for its editor readiness and acknowledgement', async () => {
    const current = target(10)
    const manager = new RendererFlush(() => [current])
    const prepared = manager.prepare('quit')
    let finished = false
    void prepared.then(() => { finished = true })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(current.send).not.toHaveBeenCalled()
    manager.setReady(10, true)
    const request = current.send.mock.calls[0]![1] as { id: string; reason: string }
    expect(request.reason).toBe('quit')
    manager.reply(10, { id: request.id, ok: true })
    const release = await prepared
    expect(finished).toBe(true)
    release()
    expect(current.send).toHaveBeenCalledWith('whitebox:flush-release', request.id)
  })

  it('vetoes when an existing window never becomes ready', async () => {
    vi.useFakeTimers()
    const current = target(10)
    const manager = new RendererFlush(() => [current], 100)
    const prepared = manager.prepare('quit')
    const assertion = expect(prepared).rejects.toThrow('操作を取り消しました')
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(current.focus).toHaveBeenCalledOnce()
    expect(current.send.mock.calls.map((call) => call[0])).toEqual(['whitebox:flush-release'])
  })
})

describe('commands originating outside the editor window', () => {
  function context() {
    const ctx = fakeCtx()
    ctx.store.data.tasks = [task({ id: 'first' }), task({ id: 'next' })]
    const handlers = createHandlers(ctx)
    handlers['session:start']({ taskId: 'first', minutes: 50 })
    ctx.calls.length = 0
    return { ctx, handlers }
  }

  it('waits for the context save before ending, then holds Current Work through delayed close', async () => {
    const { ctx, handlers } = context()
    const release = vi.fn()
    let saveFinished!: () => void
    ctx.windows.prepareEditors = vi.fn(() => new Promise<ReleaseEditors>((resolve) => { saveFinished = () => resolve(release) }))
    const ending = handlers['session:end']({})
    expect(ctx.store.data.sessions[0]!.endedAt).toBeNull()
    await handlers['task:update']({ id: 'first', patch: { nextContext: '保存した再開の手がかり' } })
    saveFinished()
    await ending
    expect(ctx.store.data.tasks[0]!.nextContext).toBe('保存した再開の手がかり')
    expect(ctx.store.data.sessions[0]!.endedAt).not.toBeNull()
    expect(release).toHaveBeenCalledWith(['current'])
    expect(ctx.calls).toContain('closeLater:expire,hud,current')
  })

  it('retains session and task state when an external end or switch cannot save input', async () => {
    const { ctx, handlers } = context()
    const before = structuredClone(ctx.store.data)
    ctx.windows.prepareEditors = async () => { throw new Error('文脈の保存に失敗') }
    await expect(handlers['session:end']({})).rejects.toThrow('文脈の保存に失敗')
    await expect(handlers['session:switchTask']({ taskId: 'next' })).rejects.toThrow('文脈の保存に失敗')
    expect(ctx.store.data).toEqual(before)
    expect(ctx.calls).toEqual([])
  })

  it('rejects late mutation after the quit save, including a switch already waiting for a flush', async () => {
    const { ctx, handlers } = context()
    let acknowledge!: () => void
    ctx.windows.prepareEditors = () => new Promise((resolve) => { acknowledge = () => resolve(() => {}) })
    const switchTask = handlers['session:switchTask']({ taskId: 'next' })
    ctx.runtime.quitting = true
    acknowledge()
    await expect(switchTask).rejects.toThrow('終了中')
    expect(() => handlers['task:update']({ id: 'first', patch: { title: 'late' } })).toThrow('終了中')
    expect(ctx.store.data.tasks[0]!.title).not.toBe('late')
    expect(ctx.calls).toEqual([])
  })

  it('allows draft saves while preparing to quit and blocks new work, windows and waiting transitions', async () => {
    const { ctx, handlers } = context()
    let acknowledge!: () => void
    ctx.windows.prepareEditors = () => new Promise((resolve) => { acknowledge = () => resolve(() => {}) })
    const switchTask = handlers['session:switchTask']({ taskId: 'next' })
    ctx.runtime.preparingQuit = true
    const before = structuredClone(ctx.store.data)
    expect(() => handlers['session:start']({ taskId: 'next', minutes: 50 })).toThrow('終了中')
    expect(() => handlers['window:open']({ kind: 'current' })).toThrow('終了中')
    expect(() => handlers['task:create']({ title: 'late' })).toThrow('終了中')
    expect(ctx.store.data).toEqual(before)
    expect(ctx.calls).toEqual([])
    await handlers['task:update']({ id: 'first', patch: { nextContext: '終了前に保存する文脈' } })
    expect(ctx.store.data.tasks[0]!.nextContext).toBe('終了前に保存する文脈')
    acknowledge()
    await expect(switchTask).rejects.toThrow('終了中')
    expect(ctx.store.data.sessions).toEqual(before.sessions)
    ctx.runtime.preparingQuit = false
    expect(() => handlers['window:open']({ kind: 'current' })).not.toThrow()
  })
})

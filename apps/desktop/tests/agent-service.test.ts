import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAgentServer } from '../src/infra/agent-api.js'
import { createAgentService } from '../src/infra/agent-service.js'
import { fakeCtx } from './helpers.js'
import type { Handlers } from '../src/app/handlers.js'

vi.mock('../src/infra/agent-api.js', () => ({ startAgentServer: vi.fn() }))

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks() })

describe('AI連携の待受け状態', () => {
  it.each([false, true])('起動失敗が遅れて届いても終了後は設定を書き換えない（停止=%s）', async (stopped) => {
    let fail!: (error: Error) => void
    vi.mocked(startAgentServer).mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = fakeCtx()
    ctx.store.data.settings.enableAgentApi = true
    const before = structuredClone(ctx.store.data)
    const service = createAgentService(ctx, '.', {} as Handlers)
    if (stopped) service.stop()
    fail(new Error('listen failed'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (stopped) {
      expect(ctx.store.data).toEqual(before)
      expect(ctx.calls).toEqual([])
    } else {
      expect(ctx.store.data.settings.enableAgentApi).toBe(false)
      expect(ctx.calls).toEqual(['publish'])
    }
    service.stop()
  })

  it('起動直後の無効化・再有効化でも設定に合うサーバを残す', async () => {
    let finish!: (server: Awaited<ReturnType<typeof startAgentServer>>) => void
    const close = vi.fn()
    vi.mocked(startAgentServer).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const ctx = fakeCtx()
    ctx.store.data.settings.enableAgentApi = true
    const service = createAgentService(ctx, '.', {} as Handlers)
    ctx.store.data.settings.enableAgentApi = false
    service.refresh()
    finish({ port: 1, close })
    await Promise.resolve()
    expect(close).toHaveBeenCalledOnce()
    ctx.store.data.settings.enableAgentApi = true
    vi.mocked(startAgentServer).mockResolvedValueOnce({ port: 2, close: vi.fn() })
    service.refresh()
    await vi.waitFor(() => expect(startAgentServer).toHaveBeenCalledTimes(2))
    service.stop()
  })
})

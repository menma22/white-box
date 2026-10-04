import { describe, expect, it, vi } from 'vitest'
import { startAgentServer } from '../src/infra/agent-api.js'
import { createAgentService } from '../src/infra/agent-service.js'
import { fakeCtx } from './helpers.js'
import type { Handlers } from '../src/app/handlers.js'

vi.mock('../src/infra/agent-api.js', () => ({ startAgentServer: vi.fn() }))

describe('AI連携の待受け状態', () => {
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

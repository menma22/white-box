import type { Ctx } from '../app/ports.js'
import type { Handlers } from '../app/handlers.js'
import { startAgentServer } from './agent-api.js'

export function createAgentService(ctx: Ctx, directory: string, handlers: Handlers) {
  let agent: Awaited<ReturnType<typeof startAgentServer>> | null = null
  let startingAgent = false
  let stopped = false
  const refresh = () => {
    if (stopped) return
    if (ctx.store.data.settings.enableAgentApi && !agent && !startingAgent) {
      startingAgent = true
      void startAgentServer(directory, handlers).then((server) => {
        if (stopped || !ctx.store.data.settings.enableAgentApi) server.close()
        else agent = server
      }).catch((error: unknown) => {
        if (stopped) return
        console.error('[white-box] AI連携を開始できません:', error)
        ctx.store.data.settings.enableAgentApi = false
        ctx.publish()
      }).finally(() => { startingAgent = false; refresh() })
    } else if (!ctx.store.data.settings.enableAgentApi && agent) { agent.close(); agent = null }
  }
  refresh()
  return {
    refresh,
    stop: () => { stopped = true; agent?.close() },
  }
}

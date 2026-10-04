import type { ArgsOf } from '@white-box/contracts'
import type { Ctx } from './ports.js'
import { resolvePresenceCandidate } from '../domain/presence-ops.js'

export function createPresenceHandlers(ctx: Ctx) {
  return {
    'presence:resolve': (args: ArgsOf<'presence:resolve'>): null => {
      const result = resolvePresenceCandidate(ctx.store.data, args.id, args.decision, ctx.now())
      ctx.store.data.presenceCandidates = result.presenceCandidates
      ctx.store.data.sessions = result.sessions
      ctx.publish()
      return null
    },
  }
}

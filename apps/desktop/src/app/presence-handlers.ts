import type { ArgsOf } from '@white-box/contracts'
import type { Ctx } from './ports.js'
import { resolvePresenceCandidate } from '../domain/presence-ops.js'
import { commitChanges } from './commit.js'

export function createPresenceHandlers(ctx: Ctx) {
  return {
    'presence:resolve': (args: ArgsOf<'presence:resolve'>): null => {
      const result = resolvePresenceCandidate(ctx.store.data, args.id, args.decision, ctx.now())
      commitChanges(ctx, result)
      return null
    },
  }
}

import { describe, expect, it } from 'vitest'
import { PresenceCandidatesSchema, PRESENCE_COMMANDS } from '../src/presence.js'
const candidate = { id: 'c', sessionId: 's', startedAt: 0, endedAt: 10_000, createdAt: 10_000, status: 'pending', reviewedAt: null }
describe('presence contracts', () => {
  it('validates stored candidates strictly', () => {
    expect(PresenceCandidatesSchema.parse([candidate])).toEqual([candidate])
    for (const value of [{ ...candidate, image: 'pixels' }, { ...candidate, endedAt: 9_999 }, { ...candidate, reviewedAt: 10_000 }, { ...candidate, status: 'accepted' }]) expect(PresenceCandidatesSchema.safeParse([value]).success).toBe(false)
    expect(PresenceCandidatesSchema.safeParse([candidate, candidate]).success).toBe(false)
  })
  it('limits resolution to explicit accept or dismiss', () => {
    expect(PRESENCE_COMMANDS['presence:resolve'].args.safeParse({ id: 'c', decision: 'accept' }).success).toBe(true)
    expect(PRESENCE_COMMANDS['presence:resolve'].args.safeParse({ id: 'c', decision: 'automatic' }).success).toBe(false)
  })
})
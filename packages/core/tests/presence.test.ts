import { describe, expect, it } from 'vitest'
import type { Session } from '../src/types.js'
import { candidateExclusions, parsePresenceCandidates } from '../src/presence.js'

const candidate = { id: 'c', sessionId: 's', startedAt: 1_000, endedAt: 11_000, createdAt: 12_000, status: 'pending', reviewedAt: null }
function session(): Session {
  return { id: 's', startedAt: 0, endedAt: 60_000, plannedMs: 60_000, state: 'ended', segments: [], pauses: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: 0 }
}

describe('candidate storage and exclusion', () => {
  it('validates status, ten seconds, ID uniqueness and safe timestamps', () => {
    expect(parsePresenceCandidates([candidate])).toEqual([candidate])
    for (const invalid of [{ ...candidate, endedAt: 10_999 }, { ...candidate, id: '__proto__' }, { ...candidate, status: 'accepted' }, { ...candidate, createdAt: 1.5 }]) expect(() => parsePresenceCandidates([invalid])).toThrow()
    expect(() => parsePresenceCandidates([candidate, candidate])).toThrow()
  })
  it('subtracts all overlapping pause reasons and clips to the edited session range', () => {
    const base = session()
    base.startedAt = 5_000
    base.endedAt = 55_000
    base.pauses = [
      { startedAt: 10_000, endedAt: 20_000, reason: 'manual' },
      { startedAt: 15_000, endedAt: 25_000, reason: 'excluded' },
      { startedAt: 30_000, endedAt: 35_000, reason: 'lock' },
      { startedAt: 40_000, endedAt: 45_000, reason: 'suspend' },
      { startedAt: 45_000, endedAt: 50_000, reason: 'break' },
    ]
    expect(candidateExclusions(base, { startedAt: 0, endedAt: 60_000 }, 70_000)).toEqual([
      { startedAt: 5_000, endedAt: 10_000 }, { startedAt: 25_000, endedAt: 30_000 },
      { startedAt: 35_000, endedAt: 40_000 }, { startedAt: 50_000, endedAt: 55_000 },
    ])
    expect(candidateExclusions(base, { startedAt: 56_000, endedAt: 60_000 }, 70_000)).toEqual([])
  })
  it('requires an ended session for acceptance', () => {
    expect(() => candidateExclusions({ ...session(), state: 'running', endedAt: null }, candidate, 60_000)).toThrow(/終了/)
  })
})
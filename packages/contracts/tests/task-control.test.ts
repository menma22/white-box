import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/commands.js'

const external = { who: '担当者', what: '回答', since: '2026-10-01', lastContactOn: null, nextFollowUpOn: '2026-10-05' }

describe('task control contracts', () => {
  it.each([
    { blocked: 'yes' }, { blockReason: 1 }, { hardDependencies: 'a' }, { hardDependencies: ['a', 'a'] },
    { recommendedPredecessors: [''] }, { externalBlock: { ...external, who: ' ' } },
    { externalBlock: { ...external, since: '2026-02-30' } }, { externalBlock: { ...external, nextFollowUpOn: '2026-13-01' } },
    { externalBlock: { ...external, lastContactOn: 'tomorrow' } }, { externalBlock: { ...external, extra: true } },
    { hardDependancies: ['a'] },
  ])('rejects malformed control patch %j', (patch) => {
    expect(() => parseArgs('task:update', { id: 'task', patch })).toThrow()
    expect(() => parseArgs('task:create', { title: 'task', ...patch })).toThrow()
  })

  it('supports atomic control fields and explicit removal without requiring legacy fields', () => {
    expect(parseArgs('task:update', { id: 'task', patch: { blocked: false, hardDependencies: [], externalBlock: null } })).toEqual({ id: 'task', patch: { blocked: false, hardDependencies: [], externalBlock: null } })
    expect(parseArgs('task:create', { title: 'task', externalBlock: external }).externalBlock).toEqual(external)
    expect(parseArgs('task:create', { title: 'task', externalBlock: { ...external, lastContactOn: '2026-09-30' } }).externalBlock?.lastContactOn).toBe('2026-09-30')
    expect(parseArgs('task:create', { title: 'legacy' })).toEqual({ title: 'legacy' })
  })
})

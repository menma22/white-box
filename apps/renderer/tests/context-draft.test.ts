import { describe, expect, it } from 'vitest'
import { acknowledgeContext, receiveContext, type ContextDraft } from '../src/features/board/context-draft.js'

const original: ContextDraft = { notes: 'original', problems: '', decisions: '', nextContext: '' }

describe('task context broadcast conflicts', () => {
  it('retains local text and reports a conflicting remote edit', () => {
    const local = { ...original, notes: 'local text' }
    const incoming = { ...original, notes: 'remote text', nextContext: 'remote next step' }
    expect(receiveContext(local, original, incoming, null)).toEqual({ draft: { ...local, nextContext: 'remote next step' }, conflict: true })
  })

  it('recognizes its own pending save even after additional typing', () => {
    expect(receiveContext({ ...original, notes: 'newer local' }, original, { ...original, notes: 'submitted local' }, { notes: 'submitted local' })).toEqual({ draft: { ...original, notes: 'newer local' }, conflict: false })
  })

  it('updates clean fields without inventing a conflict', () => {
    const incoming = { ...original, decisions: 'remote decision' }
    expect(receiveContext(original, original, incoming, null)).toEqual({ draft: incoming, conflict: false })
  })

  it('a delayed reply cannot replace a newer broadcast with its older text', () => {
    const own = { notes: 'own submitted text' }
    const newer = { ...original, notes: 'newer remote text', nextContext: 'new remote step' }
    expect(acknowledgeContext(newer, { notes: original.notes }, own)).toEqual(newer)
    expect(acknowledgeContext(original, { notes: original.notes }, own)).toEqual({ ...original, ...own })
  })
})

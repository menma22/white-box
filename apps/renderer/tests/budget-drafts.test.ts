import { describe, expect, it } from 'vitest'
import { BudgetDraftStorage, type BudgetDraft } from '../src/features/today/budget-drafts.js'

const draft: BudgetDraft = { sleep: '56', meal: '', fixed: '', allocations: [], error: '', reuseAsDefault: false }
function storage() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('BudgetDraftStorage', () => {
  it('restores an incomplete draft after restart without converting it to a plan', () => {
    const local = storage()
    const store = new BudgetDraftStorage(local, 'qa-profile')
    expect(store.persist({ '2026-10-05': draft })).toBe(true)
    expect(new BudgetDraftStorage(local, 'qa-profile').drafts).toEqual({ '2026-10-05': draft })
  })

  it('separates drafts for each database profile', () => {
    const local = storage()
    new BudgetDraftStorage(local, 'qa-profile').persist({ '2026-10-05': draft })
    expect(new BudgetDraftStorage(local, 'other-profile').drafts).toEqual({})
  })

  it('an unchanged cache does not overwrite unreadable saved bytes or veto closing', () => {
    const local = storage()
    local.values.set('whitebox.weekly-budget-drafts.v1:qa-profile', '{invalid')
    const store = new BudgetDraftStorage(local, 'qa-profile')
    expect(store.persist({})).toBe(true)
    expect(store.error).toContain('既存の保存内容は保持')
    expect(local.values.get('whitebox.weekly-budget-drafts.v1:qa-profile')).toBe('{invalid')
  })

  it('backs up unreadable bytes before persisting a new draft', () => {
    const local = storage()
    local.values.set('whitebox.weekly-budget-drafts.v1:qa-profile', '{invalid')
    const store = new BudgetDraftStorage(local, 'qa-profile')
    expect(store.persist({ '2026-10-05': draft })).toBe(true)
    const backup = [...local.values].find(([key]) => key.includes(':unreadable-backup:'))
    expect(backup?.[1]).toBe('{invalid')
    expect(new BudgetDraftStorage(local, 'qa-profile').drafts).toEqual({ '2026-10-05': draft })
  })

  it('does not write an unchanged empty cache even when storage is unavailable', () => {
    let writes = 0
    const store = new BudgetDraftStorage({ getItem: () => { throw new Error('denied') }, setItem: () => { writes++; throw new Error('denied') } }, 'qa-profile')
    expect(store.persist({})).toBe(true)
    expect(writes).toBe(0)
  })

  it('reports a storage write failure without changing the in-memory input', () => {
    const store = new BudgetDraftStorage({ getItem: () => null, setItem: () => { throw new Error('quota') } }, 'qa-profile')
    const drafts = { '2026-10-05': { ...draft } }
    expect(store.persist(drafts)).toBe(false)
    expect(store.error).toContain('quota')
    expect(drafts['2026-10-05'].sleep).toBe('56')
  })
})

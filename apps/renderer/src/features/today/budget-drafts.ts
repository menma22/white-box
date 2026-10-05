import type { ProjectAllocation } from '@white-box/core/types'

export interface AllocationDraft { projectId: string; mode: ProjectAllocation['mode']; minimum: string; maximum: string }
export interface BudgetDraft { sleep: string; meal: string; fixed: string; allocations: AllocationDraft[]; error: string; reuseAsDefault: boolean }
export type BudgetDraftCache = Record<string, BudgetDraft>
type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>

function isDraft(value: unknown): value is BudgetDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return ['sleep', 'meal', 'fixed', 'error'].every((field) => typeof draft[field] === 'string') && typeof draft.reuseAsDefault === 'boolean' &&
    Array.isArray(draft.allocations) && draft.allocations.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false
      const allocation = item as Record<string, unknown>
      return typeof allocation.projectId === 'string' && ['minimum', 'maximum', 'range', 'unlimited'].includes(String(allocation.mode)) && typeof allocation.minimum === 'string' && typeof allocation.maximum === 'string'
    })
}

export class BudgetDraftStorage {
  readonly drafts: BudgetDraftCache = {}
  error = ''
  private key: string | null
  private unreadable = false
  private savedRaw: string | null = null
  private baseline = '{}'
  private backedUp = false
  constructor(private storage: DraftStorage, profile: string | null) {
    this.key = profile ? `whitebox.weekly-budget-drafts.v1:${profile}` : null
    if (!this.key) return
    try {
      const raw = storage.getItem(this.key)
      this.savedRaw = raw
      if (!raw) return
      const value: unknown = JSON.parse(raw)
      if (!value || typeof value !== 'object') throw new Error('保存した入力の形式が不正')
      const record = value as Record<string, unknown>
      if (record.version !== 1 || !record.drafts || typeof record.drafts !== 'object' || Array.isArray(record.drafts)) throw new Error('保存した入力の形式が不正')
      for (const [week, draft] of Object.entries(record.drafts)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !isDraft(draft)) throw new Error('保存した入力の形式が不正')
        this.drafts[week] = draft
      }
    } catch (cause) {
      this.unreadable = true
      this.error = `保存した時間配分の入力を読み込めなかった。${cause instanceof Error ? cause.message : String(cause)} 既存の保存内容は保持している。`
    }
    this.baseline = JSON.stringify(this.drafts)
  }

  persist(drafts: BudgetDraftCache): boolean {
    const serialized = JSON.stringify(drafts)
    if (serialized === this.baseline) return true
    if (!this.key) { this.error = '時間配分の入力を保存する場所を確認できなかった。入力はこの画面に残っている。'; return false }
    try {
      if (this.unreadable && !this.backedUp) {
        const raw = this.savedRaw ?? this.storage.getItem(this.key)
        if (raw !== null) this.storage.setItem(`${this.key}:unreadable-backup:${Date.now()}`, raw)
        this.backedUp = true
      }
      this.storage.setItem(this.key, JSON.stringify({ version: 1, drafts }))
      this.baseline = serialized
      this.unreadable = false
      this.error = ''
      return true
    }
    catch (cause) { this.error = `時間配分の入力を保存できなかった。${cause instanceof Error ? cause.message : String(cause)} 入力はこの画面に残っている。`; return false }
  }
}

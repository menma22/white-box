import { forwardRef, useImperativeHandle, useRef, useState, type RefObject } from 'react'
import type { AppState, ProjectAllocation, WeeklyBudgetPlan } from '@white-box/core/types'
import { validateBudgetPlan, weeklyBudgetSummary } from '@white-box/core/weekly-budget'
import { formatDuration } from '@white-box/core/engine'
import { invoke } from '@/lib/bridge'
import { BudgetDraftStorage, type AllocationDraft, type BudgetDraft, type BudgetDraftCache } from './budget-drafts'
export type { BudgetDraft, BudgetDraftCache } from './budget-drafts'

export interface WeeklyBudgetHandle { flush(): Promise<boolean> }

function draftFrom(plan?: WeeklyBudgetPlan): BudgetDraft {
  return { sleep: plan ? String(plan.sleepMinutes / 60) : '', meal: plan ? String(plan.mealMinutes / 60) : '', fixed: plan ? String(plan.fixedMinutes / 60) : '', error: '', reuseAsDefault: false,
    allocations: (plan?.allocations ?? []).map((allocation) => ({ projectId: allocation.projectId, mode: allocation.mode,
      minimum: allocation.mode === 'minimum' ? String(allocation.minutes / 60) : allocation.mode === 'range' ? String(allocation.minimumMinutes / 60) : '',
      maximum: allocation.mode === 'maximum' ? String(allocation.minutes / 60) : allocation.mode === 'range' ? String(allocation.maximumMinutes / 60) : '' })) }
}

function minutes(hours: string): number {
  if (!hours.trim()) throw new Error('時間を入力してください。ない場合は 0 を入力する。')
  const value = Number(hours) * 60
  if (!Number.isFinite(value) || value < 0 || value > 10080) throw new Error('時間は 0〜168 時間で入力してください')
  return value
}

function planFrom(draft: BudgetDraft): WeeklyBudgetPlan {
  const allocations: ProjectAllocation[] = draft.allocations.map((item) => {
    if (item.mode === 'unlimited') return { projectId: item.projectId, mode: item.mode }
    if (item.mode === 'range') return { projectId: item.projectId, mode: item.mode, minimumMinutes: minutes(item.minimum), maximumMinutes: minutes(item.maximum) }
    return { projectId: item.projectId, mode: item.mode, minutes: minutes(item.mode === 'minimum' ? item.minimum : item.maximum) }
  })
  const plan = { sleepMinutes: minutes(draft.sleep), mealMinutes: minutes(draft.meal), fixedMinutes: minutes(draft.fixed), allocations }
  validateBudgetPlan(plan)
  return plan
}

function duration(value: number): string { return `${value < 0 ? '−' : ''}${formatDuration(Math.abs(value) * 60_000, 'compact')}` }

export const WeeklyBudget = forwardRef<WeeklyBudgetHandle, { state: AppState; weekStart: string; draftCache?: RefObject<BudgetDraftCache>; draftStorage?: BudgetDraftStorage }>(function WeeklyBudget({ state, weekStart, draftCache, draftStorage }, ref) {
  const saved = state.weeklyBudgets?.find((budget) => budget.weekStart === weekStart)
  const ownCache = useRef<BudgetDraftCache>({})
  const cache = draftCache ?? ownCache
  const [, refresh] = useState(0)
  const drafts = cache.current
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const disclosure = useRef<HTMLDetailsElement | null>(null)
  const draft = drafts[weekStart] ?? draftFrom(saved)
  const summary = weeklyBudgetSummary(state, weekStart)
  let preview = null
  try {
    const plan = planFrom(draft)
    preview = weeklyBudgetSummary({ weeklyBudgets: [{ ...plan, weekStart, createdAt: 0, updatedAt: 0 }], fixedWork: state.fixedWork }, weekStart)
  } catch { /* 未入力の計算結果は表示しない。 */ }
  function setDrafts(update: (all: BudgetDraftCache) => BudgetDraftCache) { cache.current = update(cache.current); draftStorage?.persist(cache.current); refresh((value) => value + 1) }
  function update(patch: Partial<BudgetDraft>) { setDrafts((all) => ({ ...all, [weekStart]: { ...draft, ...patch, error: patch.error ?? '' } })) }
  function allocation(index: number, patch: Partial<AllocationDraft>) { update({ allocations: draft.allocations.map((item, at) => at === index ? { ...item, ...patch } : item) }) }
  useImperativeHandle(ref, () => ({ flush: async () => {
    if (busy.current || drafts[weekStart]?.error || draftStorage && !draftStorage.persist(cache.current)) { if (disclosure.current) disclosure.current.open = true; setEditing(true); refresh((value) => value + 1); return false }
    return true
  } }))

  async function save() {
    if (busy.current) return
    let plan: WeeklyBudgetPlan
    try { plan = planFrom(draft) } catch (cause) { update({ error: String(cause).replace(/^(Error:\s*)+/, '') }); return }
    busy.current = true
    setSaving(true)
    update({ error: '' })
    try {
      await invoke('weeklyBudget:set', { weekStart, plan, reuseAsDefault: draft.reuseAsDefault })
      setDrafts((all) => { const next = { ...all }; delete next[weekStart]; return next })
      setEditing(false)
    } catch (cause) { update({ error: String(cause).replace(/^(Error:\s*)+/, '') }) }
    finally { busy.current = false; setSaving(false) }
  }

  return <details ref={disclosure} className="phase2-disclosure weekly-budget" data-week-budget={weekStart}>
    <summary>この週の時間配分 <span>{summary ? `柔軟に配分できる時間 ${duration(summary.availableMinutes)}` : '未設定'}{drafts[weekStart] ? ' · 保存前の入力あり' : ''}</span></summary>
    <p className="phase2-hint">一週間 168 時間から生活時間と外部固定作業を引き、残りを柔軟に配分する。配分の最小・最大は計画値。</p>
    <p className="phase2-hint">この配分は暦の月曜 0:00〜翌月曜 0:00。上の実績は設定した日境界から集計する。</p>
    {draftStorage?.error && <p className="task-command-error" role="alert">{draftStorage.error}</p>}
    {summary && !editing && <>
      <p className="weekly-budget-equation">168h − 睡眠 {duration(saved!.sleepMinutes)} − 食事 {duration(saved!.mealMinutes)} − その他の固定時間 {duration(saved!.fixedMinutes)} − 外部固定作業 {duration(summary.fixedWorkMinutes)} = <strong>{duration(summary.availableMinutes)}</strong></p>
      {summary.overcommitted && <p className="phase2-constraint">最小配分の合計が、利用可能時間を {duration(-summary.unallocatedMinutes)} 超えている。配分か生活・固定時間を見直せる。</p>}
      {saved!.allocations.map((item) => <div key={item.projectId} className="activity-entry"><span>{state.projects.find((project) => project.id === item.projectId)?.name ?? '削除されたプロジェクト'}</span><span className="num">{item.mode === 'minimum' ? `最小 ${duration(item.minutes)}` : item.mode === 'maximum' ? `最大 ${duration(item.minutes)}` : item.mode === 'range' ? `${duration(item.minimumMinutes)}〜${duration(item.maximumMinutes)}` : '上限なし'}</span></div>)}
      <p className="phase2-hint">最小配分の後に残る時間 {duration(summary.unallocatedMinutes)}。実作業の時間は上の実績に記録される。</p>
    </>}
    {!editing && <div className="phase2-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>{saved ? '時間配分を編集' : '時間配分を決める'}</button>{state.weeklyBudgetDefaults && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDrafts((all) => ({ ...all, [weekStart]: draftFrom(state.weeklyBudgetDefaults) })); setEditing(true) }}>既定の配分を使う</button>}</div>}
    {editing && <form className="phase2-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="weekly-budget-inputs">{([['sleep', '睡眠（週の合計時間）'], ['meal', '食事（週の合計時間）'], ['fixed', 'その他の固定時間（週の合計時間）']] as const).map(([key, label]) => <label key={key}>{label}<input className="input" type="number" min="0" max="168" step="any" required aria-label={label} value={draft[key]} onChange={(event) => update({ [key]: event.target.value })} disabled={saving} /></label>)}</div>
      <p className="phase2-hint">「その他の固定時間」には、別に登録した外部固定作業を含めない。該当なしは 0。</p>
      {preview && <><p className="weekly-budget-equation">外部固定作業 {duration(preview.fixedWorkMinutes)} を別枠に確保 → 柔軟に配分できる時間 <strong>{duration(preview.availableMinutes)}</strong></p>{preview.overcommitted && <p className="phase2-constraint">最小配分の合計 {duration(preview.minimumMinutes)} が利用可能時間を超えている。</p>}</>}
      <div>{draft.allocations.map((item, index) => <div className="weekly-allocation" key={item.projectId} data-allocation-project-id={item.projectId}>
        <div className="allocation-project"><strong>{state.projects.find((project) => project.id === item.projectId)?.name ?? '削除されたプロジェクト'}</strong><small>柔軟な時間の配分</small></div>
        <label>配分の方式<select className="input" aria-label={`配分の方式: ${state.projects.find((project) => project.id === item.projectId)?.name ?? '削除されたプロジェクト'}`} value={item.mode} disabled={saving} onChange={(event) => allocation(index, { mode: event.target.value as ProjectAllocation['mode'] })}><option value="minimum">最小</option><option value="maximum">最大</option><option value="range">範囲</option><option value="unlimited">上限なし</option></select></label>
        {item.mode === 'minimum' || item.mode === 'range' ? <label>最小（時間）<input className="input" type="number" min="0" max="168" step="any" required aria-label={`最小時間: ${state.projects.find((project) => project.id === item.projectId)?.name ?? '削除されたプロジェクト'}`} value={item.minimum} disabled={saving} onChange={(event) => allocation(index, { minimum: event.target.value })} /></label> : <span />}
        {item.mode === 'maximum' || item.mode === 'range' ? <label>最大（時間）<input className="input" type="number" min="0" max="168" step="any" required aria-label={`最大時間: ${state.projects.find((project) => project.id === item.projectId)?.name ?? '削除されたプロジェクト'}`} value={item.maximum} disabled={saving} onChange={(event) => allocation(index, { maximum: event.target.value })} /></label> : <span />}
        <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => update({ allocations: draft.allocations.filter((_, at) => at !== index) })}>配分を外す</button>
      </div>)}</div>
      <label>配分するプロジェクトを追加<select className="input" aria-label="配分するプロジェクトを追加" value="" disabled={saving} onChange={(event) => { if (event.target.value) update({ allocations: [...draft.allocations, { projectId: event.target.value, mode: 'unlimited', minimum: '', maximum: '' }] }) }}><option value="">プロジェクトを選ぶ</option>{state.projects.filter((project) => !project.archived && !draft.allocations.some((item) => item.projectId === project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="phase2-hint"><input type="checkbox" checked={draft.reuseAsDefault} disabled={saving} onChange={(event) => update({ reuseAsDefault: event.target.checked })} /> 次の週にも使う既定の配分として保存</label>
      {draft.error && <p className="task-command-error" role="alert">保存できなかった。{draft.error} 入力は残っている。</p>}
      <div className="phase2-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? '保存中…' : '時間配分を保存'}</button><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setEditing(false)}>編集を閉じる</button></div>
    </form>}
  </details>
})

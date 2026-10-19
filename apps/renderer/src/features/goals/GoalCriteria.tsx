import { useRef, useState } from 'react'
import type { GoalNode } from '@white-box/core/types'
import { criterionState, parseGoalCriteria, summarizeGoalCriteria, type GoalCriterion } from '@white-box/core/goal-criteria'
import { Button, Modal } from '@/components/ui'
import type { GoalRun } from './GoalFields'

const COMPARISONS = { 'at-least': '以上', 'at-most': '以下', equal: 'ちょうど' }
const STATES = { unmeasured: '未測定', reached: '数値に到達', 'not-reached': '数値未到達', confirmed: '本人が確認済み', unconfirmed: '未確認' }
type Draft = {
  id: string; title: string; kind: GoalCriterion['kind']; evidence: string
  target: string; current: string; unit: string; comparison: 'at-least' | 'at-most' | 'equal'; confirmed: boolean
}

function draftOf(item?: GoalCriterion): Draft {
  return {
    id: item?.id ?? `criterion_${crypto.randomUUID()}`, title: item?.title ?? '', kind: item?.kind ?? 'number', evidence: item?.evidence ?? '',
    target: item?.kind === 'number' ? String(item.target) : '', current: item?.kind === 'number' && item.current !== null ? String(item.current) : '',
    unit: item?.kind === 'number' ? item.unit : '', comparison: item?.kind === 'number' ? item.comparison : 'at-least',
    confirmed: item?.kind === 'observation' ? item.confirmed : false,
  }
}

export function GoalCriteria({ node, run }: { node: GoalNode; run: GoalRun }) {
  const criteria = node.criteria ?? []
  const summary = summarizeGoalCriteria(criteria)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [removing, setRemoving] = useState<GoalCriterion | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)

  async function persist(next: GoalCriterion[]) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    const ok = await run('goal:update', { id: node.id, patch: { criteria: next } })
    setError(ok ? '' : '成功条件を保存できなかった。入力を残しているので、もう一度保存して。')
    busyRef.current = false
    setBusy(false)
    return ok
  }

  async function save() {
    if (!draft || busyRef.current) return
    try {
      if (draft.kind === 'number' && !draft.target.trim()) throw new Error('目標値を入力してください')
      const base = { id: draft.id, title: draft.title.trim(), evidence: draft.evidence.trim() }
      const item: GoalCriterion = draft.kind === 'number'
        ? { ...base, kind: 'number', target: Number(draft.target), current: draft.current.trim() ? Number(draft.current) : null, unit: draft.unit.trim(), comparison: draft.comparison }
        : { ...base, kind: 'observation', confirmed: draft.confirmed }
      const next = parseGoalCriteria(criteria.some((entry) => entry.id === item.id)
        ? criteria.map((entry) => entry.id === item.id ? item : entry) : [...criteria, item])
      if (await persist(next)) setDraft(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return <section className="gm-criteria" aria-label="この目標の成功条件">
    <div className="gm-section-heading"><h3>成功条件</h3><span className={criteria.length ? 'gm-muted' : 'gm-criteria-missing'}>{criteria.length ? `${criteria.length} 件` : '未設定'}</span></div>
    <p className="gm-muted">{criteria.length ? '数字や観測できる状態を、この目標の判断材料にする。' : '何を見れば達成といえるか。数値か、確認できる状態をカードにしよう。'}</p>
    <div className="gm-criteria-list">{criteria.map((item) => {
      const state = criterionState(item)
      return <article className="gm-criterion" key={item.id}>
        <div className="gm-criterion-heading"><strong>{item.title}</strong><span className={state === 'reached' || state === 'confirmed' ? 'gm-criterion-confirmed' : 'gm-muted'}>{STATES[state]}</span></div>
        {item.kind === 'number' && <p className="gm-criterion-value">現在 {item.current === null ? '未測定' : `${item.current} ${item.unit}`} <span>／ 目標 {item.target} {item.unit} {COMPARISONS[item.comparison]}</span></p>}
        <p className="gm-criterion-evidence">{item.evidence ? `証拠：${item.evidence}` : '証拠の記録なし'}</p>
        <div className="gm-criterion-actions"><Button size="sm" disabled={busy || Boolean(draft)} onClick={() => { setDraft(draftOf(item)); setError('') }}>編集</Button>
          <Button size="sm" variant="quiet" disabled={busy || Boolean(draft)} onClick={() => setRemoving(item)}>条件を外す</Button></div>
      </article>
    })}</div>
    {!draft && <Button size="sm" disabled={busy} onClick={() => { setDraft(draftOf()); setError('') }}>＋ 成功条件を追加</Button>}
    {draft && <form className="gm-criterion-editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="field"><span className="label">条件の種類</span><select className="input" value={draft.kind} disabled={busy} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft['kind'] })}>
        <option value="number">数値で測る</option><option value="observation">状態を確認する</option>
      </select></label>
      <label className="field"><span className="label">具体的な成功条件</span><textarea className="input" rows={2} required disabled={busy} value={draft.title}
        placeholder={draft.kind === 'number' ? '例：新しい利用者に試してもらう' : '例：協力者がレポートを読み、次の方針に合意する'}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      {draft.kind === 'number' && <>
        <div className="gm-criterion-numbers"><label className="field"><span className="label">目標値</span><input className="input" type="number" step="any" required disabled={busy} value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} /></label>
          <label className="field"><span className="label">現在値（未測定なら空欄）</span><input className="input" type="number" step="any" disabled={busy} value={draft.current} onChange={(event) => setDraft({ ...draft, current: event.target.value })} /></label></div>
        <div className="gm-criterion-numbers"><label className="field"><span className="label">単位</span><input className="input" required disabled={busy} placeholder="人・件・% など" value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label>
          <label className="field"><span className="label">比較</span><select className="input" disabled={busy} value={draft.comparison} onChange={(event) => setDraft({ ...draft, comparison: event.target.value as Draft['comparison'] })}>
            <option value="at-least">目標値以上</option><option value="at-most">目標値以下</option><option value="equal">目標値と一致</option>
          </select></label></div>
      </>}
      <label className="field"><span className="label">確認できる証拠</span><textarea className="input" rows={2} disabled={busy} placeholder="測定元・URL・議事録・成果物など" value={draft.evidence} onChange={(event) => setDraft({ ...draft, evidence: event.target.value })} /></label>
      {draft.kind === 'observation' && <label className="gm-criterion-check"><input type="checkbox" disabled={busy} checked={draft.confirmed} onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })} />証拠を見て、この条件を自分で確認した</label>}
      <div className="gm-criterion-actions"><button type="submit" className="btn btn-solid btn-sm" disabled={busy}>{busy ? '保存中…' : '条件を保存'}</button><Button size="sm" disabled={busy} onClick={() => { setDraft(null); setError('') }}>キャンセル</Button></div>
    </form>}
    {error && <p className="gm-outcome-error" role="alert">{error}</p>}
    <p className="gm-muted">数値の到達や条件の確認後も、目標の達成はアウトカムで自分が判定する。</p>
    <details className="gm-criteria-review" open={reviewOpen} onToggle={(event) => setReviewOpen(event.currentTarget.open)}><summary>判定材料を確認</summary>
      <p className="gm-muted">成功条件 {summary.count} 件・数値到達 {summary.numericReached} 件・本人確認 {summary.observationConfirmed} 件・証拠 {summary.evidenceCount} 件</p>
      {!criteria.length && <p className="gm-criteria-missing">具体的な成功条件がまだない。</p>}
      {criteria.length > summary.evidenceCount && <p className="gm-muted">証拠がない条件が {criteria.length - summary.evidenceCount} 件ある。</p>}
      <p className="gm-muted">AI判定：未接続。成功条件と証拠を判断材料として保存している。</p>
    </details>
    {removing && <Modal open labelledBy="gm-criterion-remove-title" onClose={() => { if (!busy) setRemoving(null) }}>
      <div className="gm-dialog"><h2 id="gm-criterion-remove-title">この成功条件を外す？</h2><p>{removing.title}</p><p className="gm-muted">このカードと証拠の記録を外す。</p>
        <div className="gm-actions"><Button disabled={busy} onClick={() => setRemoving(null)}>キャンセル</Button><Button variant="danger" disabled={busy} onClick={() => void persist(criteria.filter((item) => item.id !== removing.id)).then((ok) => { if (ok) setRemoving(null) })}>条件を外す</Button></div>
      </div>
    </Modal>}
  </section>
}
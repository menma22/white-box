import { useEffect, useState } from 'react'
import type { GoalNode, OutcomeStatus } from '@white-box/core/types'
import { emptyOutcome } from '@white-box/core/outcome'
import type { GoalRun } from './GoalFields'

const STATUS_LABELS: Record<OutcomeStatus, string> = {
  pending: '未判定', achieved: '達成', 'not-achieved': '非達成',
}

export function GoalOutcome({ node, run }: { node: GoalNode; run: GoalRun }) {
  const outcome = node.outcome ?? emptyOutcome()
  const [deliverable, setDeliverable] = useState(outcome.deliverable)
  const [result, setResult] = useState(outcome.result)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = deliverable !== outcome.deliverable || result !== outcome.result

  useEffect(() => {
    if (!dirty) {
      setDeliverable(outcome.deliverable)
      setResult(outcome.result)
    }
  }, [outcome.deliverable, outcome.result])

  async function save(status = outcome.status) {
    if (busy) return
    if (status === 'achieved' && !deliverable.trim() && !result.trim()) {
      setError('成果物または達成結果を記入してください')
      return
    }
    setBusy(true)
    const ok = await run('goal:update', { id: node.id, patch: { outcome: { status, deliverable, result } } })
    setError(ok ? '' : '保存できませんでした')
    setBusy(false)
  }

  return <section className="gm-outcome" aria-label="この目標のアウトカム">
    <div className="gm-section-heading"><h3>アウトカム</h3><span className={`gm-outcome-status gm-outcome-${outcome.status}`}>{STATUS_LABELS[outcome.status]}</span></div>
    <p className="gm-muted">タスクの有無に関係なく、この目標で得た結果を記録する。</p>
    <label className="field"><span className="label">成果物</span>
      <textarea className="input" rows={2} placeholder="URL・ファイル名・保存場所など" value={deliverable} onChange={(event) => setDeliverable(event.target.value)} />
    </label>
    <label className="field"><span className="label">達成結果</span>
      <textarea className="input" rows={3} placeholder="何が決まったか、何を得たか" value={result} onChange={(event) => setResult(event.target.value)} />
    </label>
    {error && <p className="gm-outcome-error" role="alert">{error}</p>}
    <div className="gm-outcome-actions">
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !dirty} onClick={() => void save()}>記録を保存</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-pressed={outcome.status === 'pending'} onClick={() => void save('pending')}>未判定</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-pressed={outcome.status === 'not-achieved'} onClick={() => void save('not-achieved')}>非達成</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} aria-pressed={outcome.status === 'achieved'} onClick={() => void save('achieved')}>達成にする</button>
    </div>
    {outcome.assessedAt !== null && <time className="gm-muted">判定: {new Date(outcome.assessedAt).toLocaleString('ja-JP')}</time>}
  </section>
}

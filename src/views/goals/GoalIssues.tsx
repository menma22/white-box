import { useCallback, useState } from 'react'
import type { GoalIssue } from '@shared/types'
import { useData } from '../../store'
import { Button, Empty, Modal } from '../../ui/primitives'
import { GoalText, type GoalRun } from './GoalFields'
import { call } from '../../bridge'

const KINDS = { problem: '問題', question: '問い', idea: '改善' } as const

export function GoalIssuesView({ onJump }: { onJump: (id: string) => void }) {
  const [error, setError] = useState('')
  const run: GoalRun = useCallback(async (command, args) => {
    try { await call(command, args); setError(''); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false }
  }, [])
  return <div className="gm-root gm-issues-page">
    <header className="gm-header"><div><h1>問題・改善</h1><p>気づきを残して、次の行動につなぐ。</p></div></header>
    {error && <div className="gm-error" role="alert">保存できなかった：{error}</div>}
    <GoalIssues run={run} onJump={onJump} />
  </div>
}

export function GoalIssues({ nodeId, onJump, run }: { nodeId?: string; onJump: (id: string) => void; run: GoalRun }) {
  const map = useData().goalMap
  const [text, setText] = useState('')
  const [kind, setKind] = useState<GoalIssue['kind']>('problem')
  const [deleting, setDeleting] = useState<GoalIssue | null>(null)
  const [busy, setBusy] = useState(false)
  const issues = map.issues.filter((issue) => nodeId === undefined || issue.nodeId === nodeId)
  const active = issues.filter((issue) => !issue.resolved)
  const resolved = issues.filter((issue) => issue.resolved)

  async function add() {
    if (!text.trim() || busy) return
    setBusy(true)
    if (await run('issue:create', { text: text.trim(), kind, nodeId: nodeId ?? null })) setText('')
    setBusy(false)
  }

  function row(issue: GoalIssue) {
    return <div className={`gm-issue-row ${issue.resolved ? 'gm-resolved' : ''}`} key={issue.id}>
      <input type="checkbox" checked={issue.resolved} aria-label={`${issue.text}を${issue.resolved ? '未解決に戻す' : '解決する'}`}
        onChange={(event) => void run('issue:update', { id: issue.id, patch: { resolved: event.target.checked } })} />
      <div className="gm-issue-content">
        <GoalText value={issue.text} label="問題・問い・改善の本文" onSave={(value) => void run('issue:update', { id: issue.id, patch: { text: value } })} />
        <div className="gm-row-meta">
          <select className="input gm-kind" aria-label="問題の種別" value={issue.kind}
            onChange={(event) => void run('issue:update', { id: issue.id, patch: { kind: event.target.value } })}>
            {Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {issue.nodeId && map.nodes[issue.nodeId] ? <button className="gm-node-link" type="button" title={map.nodes[issue.nodeId]!.goal}
            onClick={() => onJump(issue.nodeId!)}>{map.nodes[issue.nodeId]!.goal || '未入力の目標'}</button> : <span className="gm-muted">全体</span>}
        </div>
      </div>
      <Button size="sm" variant="quiet" title="問題・問い・改善を削除" onClick={() => setDeleting(issue)}>削除</Button>
    </div>
  }

  return <section className={`gm-issues ${nodeId ? 'gm-issues-compact' : 'gm-list-page'}`} aria-label={nodeId ? 'この目標の問題・改善' : '問題・改善'}>
    {!nodeId && <div className="gm-section-heading"><span className="gm-muted">未解決 {active.length} 件</span></div>}
    <form className="gm-add-row" onSubmit={(event) => { event.preventDefault(); void add() }}>
      <select className="input gm-kind" aria-label="追加する問題の種別" value={kind} onChange={(event) => setKind(event.target.value as GoalIssue['kind'])}>
        {Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input className="input" aria-label="新しい問題・問い・改善" placeholder="気づいたことを書く" value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
      <button className="btn btn-solid btn-sm" type="submit" disabled={!text.trim() || busy}>追加</button>
    </form>
    {active.map(row)}
    {!issues.length && !nodeId && <Empty title="気づきを、次の改善へ。" hint="全体の問題も、目標に結びついた問いもここに集まる。" />}
    {resolved.length > 0 && <>
      <button className="gm-fold" type="button" aria-expanded={map.ui.resolvedOpen}
        onClick={() => void run('goal:ui', { patch: { resolvedOpen: !map.ui.resolvedOpen } })}>{map.ui.resolvedOpen ? '▾' : '▸'} 解決済み {resolved.length}</button>
      {map.ui.resolvedOpen && resolved.map(row)}
    </>}
    <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} labelledBy="gm-delete-issue-title">
      <div className="gm-dialog"><h2 id="gm-delete-issue-title">この記録を削除する？</h2><p>{deleting?.text}</p><p className="gm-muted">削除すると元に戻せない。</p>
        <div className="gm-actions"><Button onClick={() => setDeleting(null)}>キャンセル</Button><Button variant="danger" disabled={busy} onClick={() => {
          if (!deleting) return
          setBusy(true)
          void run('issue:delete', { id: deleting.id }).then((ok) => { if (ok) setDeleting(null); setBusy(false) })
        }}>削除する</Button></div></div>
    </Modal>
  </section>
}

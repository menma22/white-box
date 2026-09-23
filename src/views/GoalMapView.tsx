import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoalNode } from '@shared/types'
import { goalHead, isGoalHidden } from '@shared/goal-map'
import { call } from '../bridge'
import { useApp, useData } from '../store'
import { Button, Field, Modal } from '../ui/primitives'
import { GoalCanvas } from './goals/GoalCanvas'
import { GoalIssues } from './goals/GoalIssues'
import { GoalHistory } from './goals/GoalHistory'
import { GoalText, type GoalRun } from './goals/GoalFields'
import { GoalImport } from './goals/GoalImport'
import '../styles/goals.css'

type GoalDialog = { type: 'head' | 'child' | 'merge' | 'promote' | 'hide'; ids: string[] }

export function GoalMapView({ onGoTasks, onGoIssues, initialNodeId, onJumpHandled }: {
  onGoTasks: (taskId?: string) => void; onGoIssues: () => void; initialNodeId?: string | null; onJumpHandled?: () => void
}) {
  const state = useData(), map = state.goalMap
  const [selected, setSelected] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [merge, setMerge] = useState<string[] | null>(null)
  const [dialog, setDialog] = useState<GoalDialog | null>(null)
  const [error, setError] = useState('')
  const initialRoute = useRef(true)
  const node = selected ? map.nodes[selected] : null
  const run: GoalRun = useCallback(async (command, args) => {
    try { await call(command, args); setError(''); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false }
  }, [])

  const jump = useCallback(async (id: string) => {
    const current = useApp.getState().state!.goalMap
    const headId = goalHead(current, id)
    if (!headId) return
    const ok = await run('goal:ui', { activeHeadId: headId, patch: { view: 'map', ...(isGoalHidden(current, id) ? { showHidden: true } : {}) } })
    if (ok) { setSelected(id); setFocusRequest((value) => value + 1); setMerge(null) }
  }, [run])

  useEffect(() => {
    if (initialNodeId) void jump(initialNodeId).then(() => onJumpHandled?.())
  }, [initialNodeId, jump, onJumpHandled])

  useEffect(() => {
    if (!initialRoute.current) return
    initialRoute.current = false
    if (initialNodeId) return
    if (map.ui.view === 'tasks' || map.ui.view === 'issues') {
      const destination = map.ui.view
      void run('goal:ui', { patch: { view: 'map' } }).then((ok) => {
        if (ok) { if (destination === 'tasks') onGoTasks(); else onGoIssues() }
      })
    }
  }, [map.ui.view, initialNodeId, onGoTasks, onGoIssues, run])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (dialog || document.querySelector('[role="dialog"]')) return
      const element = event.target as HTMLElement
      if (element.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape') { setMerge(null); setSelected(null) }
      if (event.key === 'Delete' && node && map.ui.view !== 'history' && !isGoalHidden(map, node.id)) {
        event.preventDefault(); setDialog({ type: 'hide', ids: [node.id] })
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [dialog, node, map])

  function chooseHead(id: string) {
    if (merge) { setMerge(merge.includes(id) ? merge.filter((picked) => picked !== id) : [...merge, id]); return }
    void run('goal:ui', { activeHeadId: id, patch: { view: 'map' } })
    setSelected(null)
  }

  const heads = map.heads.filter((id) => map.nodes[id] && (map.ui.showHidden || !isGoalHidden(map, id)))
  return <div className="gm-root">
    <header className="gm-header"><div><h1>道標</h1><p>目標から、今日の一歩へ。</p></div>
      <div className="gm-header-actions"><Button variant="solid" size="sm" onClick={() => setDialog({ type: 'head', ids: [] })}>目標を追加</Button>
        <details className="gm-more"><summary aria-label="その他の操作">その他</summary><div className="gm-more-panel"><GoalImport /></div></details>
      </div>
    </header>
    {error && <div className="gm-error" role="alert">保存できなかった：{error}<Button size="sm" onClick={() => setError('')}>閉じる</Button></div>}
    <section className="gm-heads" aria-label="最上位の目標一覧"><div className="gm-heads-toolbar gm-map-toolbar">
        <button type="button" className="gm-fold" aria-expanded={map.ui.headsOpen} onClick={() => {
          if (map.ui.headsOpen) setMerge(null)
          void run('goal:ui', { patch: { headsOpen: !map.ui.headsOpen } })
        }}>{map.ui.headsOpen ? '▾' : '▸'} 最上位の目標 <span className="gm-count">{map.heads.filter((id) => !isGoalHidden(map, id)).length}</span></button>
        <div className="gm-toolbar-actions"><button type="button" className="gm-fold" onClick={() => void run('goal:ui', { patch: { view: map.ui.view === 'history' ? 'map' : 'history' } })}>{map.ui.view === 'history' ? 'マップに戻る' : '構造の履歴'}</button>
        <details className="gm-more"><summary>表示</summary><div className="gm-more-panel"><label className="gm-hidden-toggle"><input type="checkbox" checked={map.ui.showHidden} onChange={(event) => {
          if (!event.target.checked && node && isGoalHidden(map, node.id)) setSelected(null)
          void run('goal:ui', { patch: { showHidden: event.target.checked } })
        }} />隠した枝も表示</label></div></details></div>
      </div>
      {map.ui.headsOpen && <div className="gm-heads-body"><div className="gm-head-list">{heads.map((id) => <button type="button" key={id}
        className={`gm-head ${map.activeHeadId === id && !merge ? 'gm-head-active' : ''} ${merge?.includes(id) ? 'gm-head-active' : ''} ${isGoalHidden(map, id) ? 'gm-head-hidden' : ''}`}
        title={map.nodes[id]!.goal} disabled={Boolean(merge) && isGoalHidden(map, id)} onClick={() => chooseHead(id)}>
        {merge ? (merge.includes(id) ? '☑ ' : '☐ ') : '↗ '}{map.nodes[id]!.goal || '未入力の目標'}
      </button>)}</div>
        <div className="gm-head-actions">{merge ? <><span className="gm-muted">{merge.length} 件選択</span><Button size="sm" onClick={() => setMerge(null)}>キャンセル</Button><Button size="sm" variant="solid" disabled={merge.length < 2}
          onClick={() => setDialog({ type: 'merge', ids: merge })}>選んだ目標を統合</Button></> : <Button size="sm" disabled={map.heads.filter((id) => !isGoalHidden(map, id)).length < 2} onClick={() => setMerge([])}>目標を統合</Button>}</div>
      </div>}</section>
    {map.ui.view !== 'history' && <>
      <div className={`gm-workspace ${node ? 'gm-with-detail' : ''}`}>
        <GoalCanvas map={map} selected={selected} focusRequest={focusRequest} onSelect={setSelected} onAdd={(id) => setDialog({ type: 'child', ids: [id] })} />
        {node && <GoalDetail key={node.id} node={node} run={run} onJump={jump} onClose={() => setSelected(null)} onDialog={setDialog} onGoTasks={onGoTasks} onGoIssues={onGoIssues} />}
      </div>
    </>}
    {map.ui.view === 'history' && <GoalHistory onJump={jump} />}
    {dialog && <GoalCreateDialog dialog={dialog} onClose={() => setDialog(null)} onSuccess={(id) => { setDialog(null); setMerge(null); if (id) jump(id); else setSelected(null) }} onError={setError} />}
  </div>
}

function GoalDetail({ node, run, onJump, onClose, onDialog, onGoTasks, onGoIssues }: {
  node: GoalNode; run: GoalRun; onJump: (id: string) => void; onClose: () => void; onDialog: (dialog: GoalDialog) => void; onGoTasks: (taskId?: string) => void; onGoIssues: () => void
}) {
  const state = useData(), map = state.goalMap, hidden = isGoalHidden(map, node.id)
  const [taskTitle, setTaskTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const tasks = state.tasks.filter((task) => task.goalNodeId === node.id)
  let hiddenAncestor: GoalNode | undefined = node
  while (hiddenAncestor && !hiddenAncestor.hidden) hiddenAncestor = hiddenAncestor.parentId ? map.nodes[hiddenAncestor.parentId] : undefined
  return <aside className="gm-detail" aria-label="目標の詳細">
    <div className="gm-section-heading"><h2>{!node.parentId ? '最上位の目標' : '目標の詳細'}</h2><Button size="sm" title="目標の詳細を閉じる" onClick={onClose}>閉じる</Button></div>
    <Field label="目標"><GoalText value={node.goal} label="目標" multiline onSave={(goal) => void run('goal:update', { id: node.id, patch: { goal } })} /></Field>
    <Field label="この目標を目指す理由"><GoalText value={node.reason} label="この目標を目指す理由" multiline onSave={(reason) => void run('goal:update', { id: node.id, patch: { reason } })} /></Field>
    {hidden && <div className="gm-hidden-note"><strong>非表示の枝</strong>{hiddenAncestor && <>
      <p>{hiddenAncestor.hideReason || '理由の記録なし'}</p>{hiddenAncestor.hiddenAt && <time>{new Date(hiddenAncestor.hiddenAt).toLocaleString('ja-JP')}</time>}
      {hiddenAncestor.id !== node.id && <p>上位目標「{hiddenAncestor.goal}」が隠されている。</p>}
    </>}<Button size="sm" onClick={() => void run('goal:restore', { id: node.id })}>表示に戻す</Button></div>}
    <div className="gm-detail-actions">
      {!hidden && <Button variant="solid" size="sm" onClick={() => onDialog({ type: 'child', ids: [node.id] })}>＋ 子目標</Button>}
      {!hidden && <details className="gm-more"><summary>目標の操作</summary><div className="gm-more-panel">
      {!node.parentId && !hidden && <Button size="sm" onClick={() => onDialog({ type: 'promote', ids: [node.id] })}>この上に上位目標を作る</Button>}
      {!hidden && <Button variant="quiet" size="sm" onClick={() => onDialog({ type: 'hide', ids: [node.id] })}>枝を隠す</Button>}
      </div></details>}
    </div>
    <details className="gm-detail-section"><summary>問題・改善 <span>{map.issues.filter((issue) => issue.nodeId === node.id && !issue.resolved).length}</span></summary>
      <GoalIssues nodeId={node.id} run={run} onJump={onJump} /><button type="button" className="gm-section-link" onClick={onGoIssues}>すべての問題・改善を見る →</button>
    </details>
    <details className="gm-detail-section"><summary>タスク <span>{tasks.filter((task) => task.status !== 'done').length}</span></summary>
    <section className="gm-linked-tasks">
      {tasks.map((task) => <button type="button" className="gm-linked-task" key={task.id} onClick={() => onGoTasks(task.id)}><span>{task.status === 'done' ? '✓' : '○'}</span><span>{task.title}</span><span>→</span></button>)}
      <form className="gm-add-row" onSubmit={(event) => {
        event.preventDefault()
        if (!taskTitle.trim() || busy) return
        setBusy(true)
        void run('task:create', { title: taskTitle.trim(), goalNodeId: node.id }).then((ok) => { if (ok) setTaskTitle(''); setBusy(false) })
      }}><input className="input" aria-label="この目標に追加するタスク" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="次にやること"
        onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
        <button className="btn btn-solid btn-sm" type="submit" disabled={!taskTitle.trim() || busy}>追加</button></form>
      <button type="button" className="gm-section-link" onClick={() => onGoTasks()}>タスク一覧を見る →</button>
    </section></details>
  </aside>
}

function GoalCreateDialog({ dialog, onClose, onSuccess, onError }: {
  dialog: GoalDialog; onClose: () => void; onSuccess: (id?: string) => void; onError: (message: string) => void
}) {
  const [goal, setGoal] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const map = useData().goalMap
  const isHide = dialog.type === 'hide'
  const title = { head: '最上位の目標を作る', child: '子目標を追加', merge: '目標を統合', promote: '上位目標を作る', hide: 'この枝を隠す？' }[dialog.type]
  async function submit() {
    if (busy || (!isHide && !goal.trim())) return
    setBusy(true)
    try {
      if (isHide) { await call('goal:hide', { id: dialog.ids[0], reason }); onSuccess(); return }
      const result = await call<GoalNode>(dialog.type === 'merge' || dialog.type === 'promote' ? 'goal:merge' : 'goal:create', {
        goal: goal.trim(), reason,
        ...(dialog.type === 'child' ? { parentId: dialog.ids[0] } : {}),
        ...(dialog.type === 'merge' || dialog.type === 'promote' ? { ids: dialog.ids } : {}),
      })
      onSuccess(result.id)
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); onError(message); setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} labelledBy="gm-dialog-title"><form className="gm-dialog" onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <h2 id="gm-dialog-title">{title}</h2>
    {dialog.ids.length > 0 && <p className="gm-dialog-targets">{dialog.ids.map((id) => map.nodes[id]?.goal || '未入力の目標').join(' / ')}</p>}
    {isHide ? <p className="gm-muted">子目標も一緒に隠れる。目標と親子関係は残り、いつでも戻せる。</p> : <Field label="目標"><input autoFocus className="input" aria-label="新しい目標" value={goal} onChange={(event) => setGoal(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} /></Field>}
    <Field label={isHide ? '隠す理由（任意）' : '理由（任意）'}><textarea autoFocus={isHide} className="input" aria-label={isHide ? '隠す理由' : '新しい目標の理由'} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    {error && <p role="alert" className="gm-error">{error}</p>}
    <div className="gm-actions"><Button disabled={busy} onClick={onClose}>キャンセル</Button><button type="submit" className="btn btn-solid btn-md" disabled={busy || (!isHide && !goal.trim())}>{busy ? '保存中…' : isHide ? '隠す' : '作成する'}</button></div>
  </form></Modal>
}

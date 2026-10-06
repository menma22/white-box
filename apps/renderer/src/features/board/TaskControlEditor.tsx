import { useEffect, useRef, useState } from 'react'
import type { ExternalBlock, Task } from '@white-box/core/types'
import { taskBlockReasons, type TaskControl } from '@white-box/core/task-control'
import { useData } from '@/stores/app'
import { STATUS_LABEL } from '@/lib/selectors'
import { useDraftParticipant } from '@/lib/useEditorFlush'
import type { TaskDetailTarget } from './TaskDetail'
import { TaskControlDraft } from './task-control-draft'

export function TaskControlEditor({ task, save, onRelated, focusRequest }: { task: Task; save: (patch: TaskControl) => Promise<boolean>; onRelated?: (id: string) => void; focusRequest?: TaskDetailTarget }) {
  const state = useData()
  const section = useRef<HTMLElement>(null)
  const saveRef = useRef(save)
  saveRef.current = save
  const [draft] = useState(() => new TaskControlDraft(task.blockReason, (patch) => saveRef.current(patch)))
  const [draftState, setDraftState] = useState(() => draft.snapshot())
  const [editingExternal, setEditingExternal] = useState(false)
  const [external, setExternal] = useState<ExternalBlock>(task.externalBlock ?? { who: '', what: '', since: localDate(), lastContactOn: null, nextFollowUpOn: null })
  const reasons = taskBlockReasons(state, task)
  const externalLocked = draftState.externalSaving || draftState.flushing

  useEffect(() => draft.subscribe(setDraftState), [draft])
  useEffect(() => draft.receiveReason(task.blockReason), [draft, task.blockReason])
  useDraftParticipant(() => draft.flush())

  useEffect(() => {
    const target = section.current
    if (!focusRequest || !target) return
    const focus = () => {
      if (!target.isConnected || target.closest('[inert]')) return false
      target.scrollIntoView({ block: 'start' })
      target.focus({ preventScroll: true })
      return document.activeElement === target
    }
    if (focus()) return
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect() })
    for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['inert'] })
    }
    return () => observer.disconnect()
  }, [focusRequest, task.id])

  return <section ref={section} className="task-control" aria-label="待ち状態と先行タスク" tabIndex={-1} data-task-detail-section="waiting">
    <div className="detail-field">
      <label><input type="checkbox" checked={task.blocked ?? false} onChange={(event) => void save({ blocked: event.target.checked })} /> Blocked</label>
      <input className="input" aria-label="Blocked の理由" placeholder="何が進行を止めている？" value={draftState.reason} disabled={draftState.flushing} onChange={(event) => draft.updateReason(event.target.value)} onBlur={() => void draft.saveReason()} />
      {reasons.length > 0 && <ul className="task-control-reasons">{reasons.map((item) => <li key={item}>{item}</li>)}</ul>}
    </div>
    {(['hardDependencies', 'recommendedPredecessors'] as const).map((field) => {
      const links = task[field] ?? []
      const label = field === 'hardDependencies' ? '必須の先行タスク' : '推奨する先行タスク'
      return <div className="detail-field" key={field}>
        <span className="label">{label}</span>
        {field === 'recommendedPredecessors' && <small>未完でも開始できる。順序の判断材料。</small>}
        {links.map((id) => {
          const related = state.tasks.find((item) => item.id === id)
          return <div className="task-link" key={id}>
            {related ? <button type="button" className="task-link-title" onClick={() => onRelated?.(id)}>{related.title} · {STATUS_LABEL[related.status]}</button> : <span>削除されたタスク ({id})</span>}
            <button type="button" className="btn btn-ghost btn-sm" aria-label={`${related?.title ?? id} のリンクを解除`} onClick={() => void save({ [field]: links.filter((item) => item !== id) })}>解除</button>
          </div>
        })}
        <select className="input" aria-label={`${label}を追加`} value="" onChange={(event) => { if (event.target.value) void save({ [field]: [...links, event.target.value] }) }}>
          <option value="">先行タスクを選ぶ</option>
          {state.tasks.filter((item) => item.id !== task.id && !(task.hardDependencies ?? []).includes(item.id) && !(task.recommendedPredecessors ?? []).includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.title} · {STATUS_LABEL[item.status]}{state.projects.some((project) => project.id === item.projectId && project.archived) ? ' · アーカイブ' : ''}</option>)}
        </select>
      </div>
    })}
    <div className="detail-field">
      <span className="label">外部待ち</span>
      {task.externalBlock && <div className="external-summary"><strong>{task.externalBlock.who}</strong><span>{task.externalBlock.what}</span><small>{task.externalBlock.since} から · 最終連絡 {task.externalBlock.lastContactOn ?? '未記録'} · 次の確認 {task.externalBlock.nextFollowUpOn ?? '未設定'}</small></div>}
      <div className="task-control-actions">
        <button type="button" className="btn btn-ghost btn-sm" disabled={editingExternal || externalLocked} onClick={() => { setExternal(task.externalBlock ?? { who: '', what: '', since: localDate(), lastContactOn: null, nextFollowUpOn: null }); setEditingExternal(true) }}>{task.externalBlock ? '外部待ちを編集' : '外部待ちを登録'}</button>
        {task.externalBlock && <button type="button" className="btn btn-ghost btn-sm" disabled={editingExternal || externalLocked} onClick={() => void save({ externalBlock: null }).then((saved) => { if (saved) setEditingExternal(false) })}>外部待ちを解除</button>}
      </div>
      {editingExternal && <form className="external-form" onSubmit={(event) => { event.preventDefault(); void draft.submitExternal(external).then((saved) => { if (saved) setEditingExternal(false) }) }}>
        <label>誰待ち<input className="input" required disabled={externalLocked} value={external.who} onChange={(event) => setExternal({ ...external, who: event.target.value })} /></label>
        <label>何待ち<input className="input" required disabled={externalLocked} value={external.what} onChange={(event) => setExternal({ ...external, what: event.target.value })} /></label>
        <label>いつから<input className="input" type="date" required disabled={externalLocked} value={external.since} onChange={(event) => setExternal({ ...external, since: event.target.value })} /></label>
        <label>最終連絡日<input className="input" type="date" disabled={externalLocked} value={external.lastContactOn ?? ''} onChange={(event) => setExternal({ ...external, lastContactOn: event.target.value || null })} /></label>
        <label>次に確認する日<input className="input" type="date" disabled={externalLocked} value={external.nextFollowUpOn ?? ''} onChange={(event) => setExternal({ ...external, nextFollowUpOn: event.target.value || null })} /></label>
        {draftState.externalFailed && <span className="task-control-error" role="alert">保存できなかった。入力は残っている。再保存するか、やめるを選ぶ。</span>}
        <div className="task-control-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={externalLocked}>外部待ちを保存</button><button type="button" className="btn btn-ghost btn-sm" disabled={externalLocked} onClick={() => { draft.cancelExternal(); setEditingExternal(false) }}>やめる</button></div>
      </form>}
    </div>
  </section>
}

function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

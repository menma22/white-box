import { useState } from 'react'
import { followUpDue } from '@white-box/core/task-control'
import { useApp, useData } from '@/stores/app'
import { STATUS_LABEL } from '@/lib/selectors'

export function ExternalWaiting({ projectId, onSelect }: { projectId: string | null; onSelect: (id: string) => void }) {
  const state = useData()
  const now = new Date(useApp((app) => app.now))
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const [showArchived, setShowArchived] = useState(false)
  const tasks = state.tasks.filter((task) => task.externalBlock && task.status !== 'done' && (!projectId || task.projectId === projectId) && (showArchived || !state.projects.some((project) => project.id === task.projectId && project.archived)))
    .sort((a, b) => (a.externalBlock!.nextFollowUpOn ?? '9999').localeCompare(b.externalBlock!.nextFollowUpOn ?? '9999') || a.createdAt - b.createdAt)

  return <section className="external-waiting" aria-label="外部待ち">
    <header><h2>外部待ち <span className="num">{tasks.length}</span></h2><label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> アーカイブも表示</label></header>
    {tasks.length === 0 ? <p>外部待ちはない。</p> : <div className="external-waiting-list">{tasks.map((task) => {
      const block = task.externalBlock!
      const due = followUpDue(block, today)
      return <article className={`external-waiting-row ${due ? 'is-due' : ''}`} key={task.id} data-external-task-id={task.id}>
        <button type="button" className="external-waiting-task" onClick={() => onSelect(task.id)}><strong>{task.title}</strong><small>{STATUS_LABEL[task.status]} · {task.progress}%{state.projects.some((project) => project.id === task.projectId && project.archived) ? ' · アーカイブ' : ''}</small></button>
        <div><strong>{block.who}</strong><span>{block.what}</span><small>{block.since} から · 最終連絡 {block.lastContactOn ?? '未記録'} · 次の確認 {block.nextFollowUpOn ?? '未設定'}</small></div>
        <button type="button" className={`btn ${due ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => onSelect(task.id)}>{due ? '確認しますか？' : '確認日を編集'}</button>
      </article>
    })}</div>}
  </section>
}

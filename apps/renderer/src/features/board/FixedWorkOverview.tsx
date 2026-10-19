import { useState } from 'react'
import type { FixedWork, TimeRange } from '@white-box/core/types'
import { useApp, useData } from '@/stores/app'
import { invoke } from '@/lib/bridge'
import { formatDuration } from '@white-box/core/engine'
import { FixedWorkEditor } from './FixedWorkEditor'
import type { TaskDetailTarget } from './TaskDetail'

export function FixedWorkOverview({ taskId, projectId, period, onOpenTask, allowCreate = true }: { taskId?: string; projectId?: string | null; period?: TimeRange; onOpenTask?: (id: string, target?: TaskDetailTarget) => void; allowCreate?: boolean }) {
  const state = useData()
  const now = useApp((app) => app.now)
  const [editing, setEditing] = useState<FixedWork | 'new' | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const works = (state.fixedWork ?? []).filter((work) => {
    if (work.cancelled !== showCancelled || taskId && work.taskId !== taskId) return false
    const task = state.tasks.find((item) => item.id === work.taskId)
    if (projectId && task?.projectId !== projectId) return false
    return period ? work.startedAt < period.endedAt && work.endedAt > period.startedAt : taskId ? true : work.endedAt > now
  }).sort((a, b) => a.startedAt - b.startedAt)
  const label = taskId ? 'この仕事の外部固定予定' : '外部の固定予定'

  async function cancel(work: FixedWork) {
    if (savingId) return
    setSavingId(work.id)
    setError('')
    try { await invoke('fixedWork:update', { id: work.id, patch: { cancelled: true } }) }
    catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')) }
    finally { setSavingId(null) }
  }

  return <section className="fixed-work-overview" aria-label={label}>
    <details className="phase2-disclosure"><summary>{label} <span>{works.length} 件{works[0] ? ` · ${new Date(works[0].startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</span></summary>
      <p className="phase2-hint">外部の都合で確定した仕事の日時。計測は自分で開始する。</p>
      <div className="phase2-actions">{allowCreate && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>外部の固定予定を登録</button>}<label className="phase2-hint"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} /> 取り消した予定を表示</label></div>
      {error && <p className="task-command-error" role="alert">{error}</p>}
      <div className="fixed-work-list">{works.map((work) => {
        const task = state.tasks.find((item) => item.id === work.taskId)
        return <div className="fixed-work-item" key={work.id} data-fixed-work-id={work.id}><div><strong>{task?.title ?? '削除されたタスク'}</strong><span>{new Date(work.startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} — {new Date(work.endedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {formatDuration(work.endedAt - work.startedAt, 'compact')}{work.cancelled ? ' · 取消済み' : work.endedAt <= now ? ' · 時刻を経過' : work.startedAt <= now ? ' · 予定の時刻' : ''}</span><span>{work.externalReason}</span></div><div className="phase2-actions">
          {task && onOpenTask && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenTask(task.id)}>タスクを開く</button>}
          {!work.cancelled && work.startedAt > now && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(work)}>編集</button>}
          {!work.cancelled && <button type="button" className="btn btn-ghost btn-sm" disabled={savingId !== null} onClick={() => void cancel(work)}>{savingId === work.id ? '保存中…' : '予定を取り消す'}</button>}
        </div></div>
      })}</div>
      {!works.length && <p className="phase2-hint">{showCancelled ? '取り消した予定はない。' : period ? 'この期間の外部固定予定はない。' : '今後の外部固定予定はない。'}</p>}
    </details>
    {editing && <FixedWorkEditor key={editing === 'new' ? `new-${taskId ?? ''}` : editing.id} work={editing === 'new' ? undefined : editing} taskId={taskId} onClose={() => setEditing(null)} />}
  </section>
}

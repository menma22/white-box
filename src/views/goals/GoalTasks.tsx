import { useEffect, useRef, useState } from 'react'
import type { Task } from '@shared/types'
import { dayKey } from '@shared/engine'
import { call } from '../../bridge'
import { useApp, useData } from '../../store'
import { Modal } from '../../ui/primitives'
import { TaskDetail } from '../TaskDetail'
import './goal-tasks.css'

export function GoalTasks({ onJump, initialTaskId = null, projectId = null, onJumpHandled }: {
  onJump: (id: string) => void; initialTaskId?: string | null; projectId?: string | null
  onJumpHandled?: () => void
}) {
  const state = useData()
  const now = useApp((s) => s.now)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [detailId, setDetailId] = useState<string | null>(initialTaskId)
  useEffect(() => {
    if (!initialTaskId) return
    setDetailId(initialTaskId)
    onJumpHandled?.()
  }, [initialTaskId, onJumpHandled])
  const tasks = state.tasks.filter((task) => !projectId || task.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt)
  const done = tasks.filter((t) => t.status === 'done')
  const open = tasks.filter((t) => t.status !== 'done')

  async function run(name: string, args: Record<string, unknown>) {
    try {
      await call(name, args)
      setError('')
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  const descendants = new Set(deleting ? [deleting.id] : [])
  for (let size = -1; size !== descendants.size;) {
    size = descendants.size
    for (const task of state.tasks) if (task.parentId && descendants.has(task.parentId)) descendants.add(task.id)
  }

  function row(task: Task) {
    const node = task.goalNodeId ? state.goalMap.nodes[task.goalNodeId] : null
    const dueClass = task.status !== 'done' && task.due
      ? task.due < dayKey(now, 0) ? 'is-overdue' : task.due === dayKey(now, 0) ? 'is-today' : ''
      : ''
    return (
      <div key={task.id} className={`gm-task-row ${task.status === 'done' ? 'is-done' : ''}`} data-task-id={task.id}>
        <input type="checkbox" aria-label={`完了: ${task.title}`} checked={task.status === 'done'}
          onChange={() => void run('task:update', { id: task.id, patch: { status: task.status === 'done' ? 'todo' : 'done' } })} />
        <div className="gm-task-text">
          <TaskTitle value={task.title} onSave={(value) => void run('task:update', { id: task.id, patch: { title: value } })} />
          {node && <button type="button" className="gm-task-goal" title={node.goal} onClick={() => onJump(node.id)}>↗ {node.goal || '未入力の目標'}</button>}
        </div>
        <select className={`input gm-task-priority priority-${task.priority}`} aria-label={`優先度: ${task.title}`}
          value={task.priority} onChange={(e) => void run('task:update', { id: task.id, patch: { priority: e.target.value } })}>
          <option value="high">高</option><option value="normal">中</option><option value="low">低</option>
        </select>
        <input type="date" className={`input gm-task-due ${dueClass}`} aria-label={`締切: ${task.title}`}
          title={dueClass === 'is-overdue' ? '締切を過ぎている' : dueClass === 'is-today' ? '今日が締切' : '締切'}
          value={task.due ?? ''} onChange={(e) => void run('task:update', { id: task.id, patch: { due: e.target.value || null } })} />
        <button type="button" className="btn btn-quiet btn-sm gm-task-action" onClick={() => setDetailId(task.id)}>詳細</button>
        <button type="button" className="btn btn-danger btn-sm gm-task-action" aria-label={`削除: ${task.title}`} onClick={() => setDeleting(task)}>削除</button>
      </div>
    )
  }

  return (
    <section className="gm-task-view">
      <div className="gm-task-list">
        <h2>タスク <span className="gm-task-count">{open.length} 件</span></h2>
        <p className="gm-task-intro">次の一歩と、いつまでにやるか。</p>
        <form className="gm-task-add" onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim() || adding) return
          setAdding(true)
          void run('task:create', { title: title.trim(), status: 'todo', projectId }).then((ok) => {
            if (ok) setTitle('')
            setAdding(false)
          })
        }}>
          <input className="input" aria-label="新しいタスク" placeholder="次にやることを追加" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
          <button className="btn btn-primary btn-md" type="submit" disabled={!title.trim() || adding}>追加</button>
        </form>
        {error && <p role="alert" className="gm-task-error">保存できなかった。{error}</p>}
        {open.map(row)}
        {!open.length && <p className="gm-task-intro">未完了のタスクはない。</p>}
        <button type="button" className="btn btn-quiet btn-md gm-task-done" aria-expanded={state.goalMap.ui.doneOpen}
          onClick={() => void run('goal:ui', { patch: { doneOpen: !state.goalMap.ui.doneOpen } })}>
          {state.goalMap.ui.doneOpen ? '▾' : '▸'} 完了済み ({done.length})
        </button>
        {state.goalMap.ui.doneOpen && done.map(row)}
      </div>
      {detailId && <TaskDetail key={detailId} taskId={detailId} onClose={() => setDetailId(null)} />}
      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} labelledBy="gm-task-delete-title">
        <h3 id="gm-task-delete-title">「{deleting?.title}」を削除する？</h3>
        <p className="modal-text">{descendants.size > 1 ? `子タスク ${descendants.size - 1} 件も削除する。` : ''}ボードからも消える。これまでのセッション記録は残る。</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setDeleting(null)}>やめる</button>
          <button type="button" className="btn btn-danger btn-md" onClick={() => {
            if (deleting) void run('task:delete', { id: deleting.id }).then((ok) => { if (ok) setDeleting(null) })
          }}>削除する</button>
        </div>
      </Modal>
    </section>
  )
}

function TaskTitle({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(value) }, [value])
  return <input className="input gm-task-title" aria-label="タスク名" title={draft} value={draft}
    onFocus={() => { editing.current = true }} onBlur={() => { editing.current = false }}
    onChange={(event) => { setDraft(event.target.value); onSave(event.target.value) }}
    onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === 'Escape')) event.currentTarget.blur() }} />
}

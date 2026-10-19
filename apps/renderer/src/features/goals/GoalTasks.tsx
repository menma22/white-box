import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Priority, Task } from '@white-box/core/types'
import { dayKey } from '@white-box/core/engine'
import { invoke } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { Modal } from '@/components/ui'
import { TaskDetail, type TaskDetailHandle } from '@/features/board/TaskDetail'
import type { GoalRun } from './GoalFields'
import { runEditorAction, useDraftParticipant } from '@/lib/useEditorFlush'
import { TaskTitleDraft } from '@/features/task-control/task-title-draft'

export interface GoalTasksHandle { flush(): Promise<boolean> }
export const GoalTasks = forwardRef<GoalTasksHandle, {
  onJump: (id: string) => void; initialTaskId?: string | null; projectId?: string | null
  onJumpHandled?: () => void
}>(function GoalTasks({ onJump, initialTaskId = null, projectId = null, onJumpHandled }, ref) {
  const state = useData()
  const now = useApp((s) => s.now)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [detailId, setDetailId] = useState<string | null>(initialTaskId)
  const detail = useRef<TaskDetailHandle | null>(null)
  useImperativeHandle(ref, () => ({ flush: () => detail.current?.flush() ?? Promise.resolve(true) }), [])
  const selectTask = (id: string) => { void runEditorAction(() => setDetailId(id)) }
  useEffect(() => {
    if (!initialTaskId) return
    setDetailId(initialTaskId)
    onJumpHandled?.()
  }, [initialTaskId, onJumpHandled])
  const tasks = state.tasks.filter((task) => !projectId || task.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt)
  const done = tasks.filter((t) => t.status === 'done')
  const open = tasks.filter((t) => t.status !== 'done')

  const run: GoalRun = async (name, args) => {
    try {
      await invoke(name, args)
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
          onChange={() => void runEditorAction(async () => { await run('task:update', { id: task.id, patch: { status: task.status === 'done' ? 'todo' : 'done' } }) })} />
        <div className="gm-task-text">
          <TaskTitle value={task.title} onSave={(value, expected) => run('task:update', { id: task.id, patch: { title: value }, expectedContext: { title: expected } })} />
          {node && <button type="button" className="gm-task-goal" title={node.goal} onClick={() => onJump(node.id)}>↗ {node.goal || '未入力の目標'}</button>}
        </div>
        <select className={`input gm-task-priority priority-${task.priority}`} aria-label={`優先度: ${task.title}`}
          value={task.priority} onChange={(e) => void run('task:update', { id: task.id, patch: { priority: e.target.value as Priority } })}>
          <option value="high">高</option><option value="normal">中</option><option value="low">低</option>
        </select>
        <input type="date" className={`input gm-task-due ${dueClass}`} aria-label={`締切: ${task.title}`}
          title={dueClass === 'is-overdue' ? '締切を過ぎている' : dueClass === 'is-today' ? '今日が締切' : '締切'}
          value={task.due ?? ''} onChange={(e) => void run('task:update', { id: task.id, patch: { due: e.target.value || null } })} />
        <button type="button" className="btn btn-quiet btn-sm gm-task-action" onClick={() => selectTask(task.id)}>詳細</button>
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
          onClick={() => void runEditorAction(async () => { await run('goal:ui', { patch: { doneOpen: !state.goalMap.ui.doneOpen } }) })}>
          {state.goalMap.ui.doneOpen ? '▾' : '▸'} 完了済み ({done.length})
        </button>
        {state.goalMap.ui.doneOpen && done.map(row)}
      </div>
      {detailId && <TaskDetail ref={detail} key={detailId} taskId={detailId} onClose={() => setDetailId(null)} onSelectTask={selectTask} />}
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
})

function TaskTitle({ value, onSave }: { value: string; onSave: (value: string, expected: string) => Promise<boolean> }) {
  const save = useRef(onSave)
  save.current = onSave
  const [controller] = useState(() => new TaskTitleDraft(value, (title, expected) => save.current(title, expected)))
  const [state, setState] = useState(() => controller.snapshot())
  useEffect(() => controller.subscribe(setState), [controller])
  useEffect(() => controller.receive(value), [controller, value])
  useDraftParticipant(() => controller.flush())
  return <div><input className="input gm-task-title" aria-label="タスク名" title={state.draft} value={state.draft} disabled={state.flushing}
    onFocus={() => controller.focus(true)} onBlur={() => { controller.focus(false); void controller.save() }}
    onChange={(event) => {
      controller.update(event.target.value)
      if (event.target.value.trim()) void controller.save()
    }}
    onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === 'Escape')) event.currentTarget.blur() }} />
    {state.error && <span role="alert" className="gm-task-error">{state.error} 入力は残っている。</span>}
    {state.conflict !== null && <div><p>別の画面で保存されたタスク名: {state.conflict}</p><button type="button" className="btn btn-ghost btn-sm" disabled={state.flushing} onClick={() => void controller.retry()}>自分の入力を保存</button><button type="button" className="btn btn-ghost btn-sm" disabled={state.flushing} onClick={() => void controller.acceptLatest()}>最新の内容を使う</button></div>}
  </div>
}

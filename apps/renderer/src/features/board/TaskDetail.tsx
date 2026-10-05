import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { invoke } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { ancestorTitles, childrenOf, focusByTask, lastTouchedAt, STATUS_LABEL, STATUS_ORDER, taskById } from '@/lib/selectors'
import { Modal, ProgressBar, Segmented, useEscape } from '@/components/ui'
import { formatDuration } from '@white-box/core/engine'
import type { Priority, Task, TaskStatus } from '@white-box/core/types'
import { taskControl } from '@white-box/core/task-priority'
import { OptionalDurationField } from '@/features/task-control/OptionalDurationField'
import { TaskRiskSummary } from '@/features/task-control/TaskRiskSummary'
import { taskExecutionProblem } from '@white-box/core/task-control'
import { TaskControlEditor } from './TaskControlEditor'
import { TaskContextEditor } from './TaskContextEditor'
import type { NoteEditorHandle } from '@/features/notes/NoteEditor'
import { FixedWorkOverview } from './FixedWorkOverview'

export type TaskDetailTarget = { section: 'waiting' }
export interface TaskDetailHandle { flush(): Promise<boolean> }

export const TaskDetail = forwardRef<TaskDetailHandle, { taskId: string; onClose: () => void; onSelectTask?: (id: string) => void; target?: TaskDetailTarget }>(function TaskDetail({ taskId, onClose, onSelectTask, target }, ref) {
  const state = useData()
  const now = useApp((s) => s.now)
  const task = taskById(state, taskId)
  const [title, setTitle] = useState(task?.title ?? '')
  const editingTitle = useRef(false)
  const context = useRef<NoteEditorHandle | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hasTime, setHasTime] = useState(false)
  const [error, setError] = useState('')

  const flush = () => context.current?.flush() ?? Promise.resolve(true)
  useImperativeHandle(ref, () => ({ flush }))
  const close = () => { void flush().then((saved) => { if (saved) onClose() }) }
  const related = (id: string) => { void flush().then((saved) => { if (saved) onSelectTask?.(id) }) }
  useEscape(!confirmDelete, () => { if (!document.querySelector('[role="dialog"]')) close() })

  useEffect(() => {
    if (!editingTitle.current) setTitle(task?.title ?? '')
  }, [taskId, task?.title])
  useEffect(() => {
    if (!target) body.current?.scrollTo({ top: 0 })
  }, [taskId, target])

  if (!task) return null

  const children = childrenOf(state, task.id)
  const spent = focusByTask(state, now).get(task.id) ?? 0
  const touched = lastTouchedAt(state, task.id)
  const path = ancestorTitles(state, task)

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setError('')
    try { await action(); return true } catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false }
  }
  // Record<string, unknown> はキーの綴り違いを型検査で拾えないため、送信する patch は Partial<Task> で縛る。
  const save = (p: Partial<Task>) => run(() => invoke('task:update', { id: task.id, patch: p }))
  const patch = (p: Partial<Task>) => { void save(p) }
  const executionProblem = taskExecutionProblem(state, task.id)

  const taskIdForDelete = task.id
  async function askDelete() {
    setHasTime(await invoke('task:hasTime', { id: taskIdForDelete }))
    setConfirmDelete(true)
  }

  return (
    <aside className="detail">
      <header className="detail-head">
        <div className="detail-path">
          {path.length > 0 && <span className="detail-path-text">{path.join(' / ')} /</span>}
          <span className="label">タスク</span>
        </div>
        <button type="button" className="detail-close" onClick={close} title="閉じる (Esc)">
          ✕
        </button>
      </header>

      {error && <p className="task-command-error" role="alert">{error}</p>}

      <div className="detail-body" ref={body}>
        <textarea
          className="detail-title"
          value={title}
          rows={2}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => { editingTitle.current = true }}
          onBlur={() => {
            editingTitle.current = false
            if (title.trim() && title !== task.title) patch({ title: title.trim() })
          }}
        />

        {executionProblem && <p className="task-control-hint" data-execution-problem>開始できない理由: {executionProblem}</p>}

        <div className="detail-grid">
          <div className="detail-field">
            <span className="label">状態</span>
            <Segmented
              value={task.status}
              onChange={(v) => patch({ status: v })}
              options={STATUS_ORDER.map((s) => ({ value: s as TaskStatus, label: STATUS_LABEL[s] }))}
            />
          </div>

          <div className="detail-field">
            <span className="label">重要度</span>
            <Segmented
              value={task.priority}
              onChange={(v) => patch({ priority: v })}
              options={[
                { value: 'low' as Priority, label: '低' },
                { value: 'normal' as Priority, label: '普通' },
                { value: 'high' as Priority, label: '重要' },
              ]}
            />
          </div>

          <div className="detail-field">
            <span className="label">プロジェクト</span>
            <select className="input" value={task.projectId ?? ''} onChange={(e) => patch({ projectId: e.target.value || null })}>
              <option value="">なし</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <label className="detail-field">
            <span className="label">締切</span>
            <input className="input" type="date" value={task.due ?? ''} onChange={(e) => patch({ due: e.target.value || null })} />
          </label>
          <OptionalDurationField label="残作業の見積（任意）" value={task.remainingEffortMinutes} onSave={(remainingEffortMinutes) => invoke('task:update', { id: task.id, patch: { remainingEffortMinutes } })} />
          <OptionalDurationField label="安全余裕（任意）" value={task.safetyBufferMinutes} onSave={(safetyBufferMinutes) => invoke('task:update', { id: task.id, patch: { safetyBufferMinutes } })} />
          <div className="detail-field">
            <TaskRiskSummary control={taskControl(task, state.sessions, now, state.settings.stallWarningDays, state.projects)} />
            <p className="task-control-hint">見積は残作業。セッションを記録しても自動で減らさない。Slack は締切日末までの暦時間から見積と安全余裕を引いた値。休息や他の仕事は引かない。安全余裕なしなら 0 を入力する。</p>
          </div>
          <label className="detail-field">
            <span className="label">目標（道標）</span>
            <select className="input" value={task.goalNodeId ?? ''} onChange={(e) => patch({ goalNodeId: e.target.value || null })}>
              <option value="">なし</option>
              {Object.values(state.goalMap.nodes).map((node) => <option key={node.id} value={node.id}>{node.goal || '未入力の目標'}</option>)}
            </select>
          </label>
        </div>

        <div className="detail-field">
          <span className="label">進捗</span>
          <div className="detail-progress">
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={task.progress}
              style={{ ['--fill' as string]: `${task.progress}%` }}
              onChange={(e) => patch({ progress: Number(e.target.value) })}
            />
            <span className="num detail-pct">{task.progress}%</span>
          </div>
        </div>

        <div className="detail-stats">
          <div>
            <span className="label">積み上げ</span>
            <span className="num detail-stat-value">{spent > 0 ? formatDuration(spent, 'compact') : '—'}</span>
          </div>
          <div>
            <span className="label">最後に触れた</span>
            <span className="num detail-stat-value">
              {touched ? new Date(touched).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '—'}
            </span>
          </div>
        </div>

        <TaskControlEditor key={task.id} task={task} save={save} onRelated={related} focusRequest={target} />

        <TaskContextEditor ref={context} key={task.id} task={task} />
        <FixedWorkOverview taskId={task.id} />

        <div className="detail-field">
          <span className="label">分解（任意）</span>
          {children.map((c) => (
            <div key={c.id} className={`detail-sub ${c.status === 'done' ? 'is-done' : ''}`}>
              <button
                type="button"
                className="detail-sub-check"
                onClick={() => void run(() => invoke('task:update', { id: c.id, patch: { status: c.status === 'done' ? 'todo' : 'done' } }))}
              >
                {c.status === 'done' ? '✓' : ''}
              </button>
              <span className="detail-sub-title">{c.title}</span>
              <span className="detail-sub-bar">
                <ProgressBar value={c.progress} height={2} tone={c.status === 'done' ? 'done' : 'work'} />
              </span>
            </div>
          ))}
          <input
            className="input"
            placeholder="+ 中の一手を足す"
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !sub.trim()) return
              void run(() => invoke('task:create', { title: sub.trim(), parentId: task.id, projectId: task.projectId, status: task.status === 'done' ? 'todo' : task.status })).then((saved) => { if (saved) setSub('') })
            }}
          />
        </div>
      </div>

      <footer className="detail-foot">
        <button
          type="button"
          className="btn btn-primary btn-md"
          onClick={() => void flush().then((saved) => { if (saved) void run(() => invoke('session:start', { taskId: task.id, minutes: state.settings.defaultSessionMinutes })) })}
          disabled={Boolean(state.live) || Boolean(executionProblem)}
          title={executionProblem ?? (state.live ? 'すでにセッションが動いている' : '')}
        >
          このタスクで開始
        </button>
        <button type="button" className="btn btn-danger btn-md" onClick={() => void askDelete()}>
          削除
        </button>
      </footer>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <h3>「{task.title}」を削除する？</h3>
        <p className="modal-text">
          {children.length > 0 && `中のタスク ${children.length} 件も一緒に消える。`}
          {hasTime
            ? 'このタスクには実績時間がある。セッションの記録は残るが、記録側では「削除されたタスク」と表示される。'
            : '実績時間はまだ無い。'}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirmDelete(false)}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-danger btn-md"
            onClick={() => {
              void run(() => invoke('task:delete', { id: task.id })).then((saved) => {
                setConfirmDelete(false)
                if (saved) onClose()
              })
            }}
          >
            削除する
          </button>
        </div>
      </Modal>
    </aside>
  )
})

import { useEffect, useState } from 'react'
import { call } from '../bridge'
import { useApp, useData } from '../store'
import { ancestorTitles, childrenOf, focusByTask, lastTouchedAt, STATUS_LABEL, STATUS_ORDER, taskById } from '../lib/selectors'
import { Modal, ProgressBar, Segmented, useEscape } from '../ui/primitives'
import { formatDuration } from '@white-box/core/engine'
import type { Priority, TaskStatus } from '@white-box/core/types'

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const state = useData()
  const now = useApp((s) => s.now)
  const task = taskById(state, taskId)
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [sub, setSub] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hasTime, setHasTime] = useState(false)

  useEscape(!confirmDelete, onClose)

  useEffect(() => {
    setTitle(task?.title ?? '')
    setNotes(task?.notes ?? '')
  }, [taskId])

  if (!task) return null

  const children = childrenOf(state, task.id)
  const spent = focusByTask(state, now).get(task.id) ?? 0
  const touched = lastTouchedAt(state, task.id)
  const path = ancestorTitles(state, task)

  const patch = (p: Record<string, unknown>) => void call('task:update', { id: task.id, patch: p })

  const taskIdForDelete = task.id
  async function askDelete() {
    setHasTime(await call<boolean>('task:hasTime', { id: taskIdForDelete }))
    setConfirmDelete(true)
  }

  return (
    <aside className="detail">
      <header className="detail-head">
        <div className="detail-path">
          {path.length > 0 && <span className="detail-path-text">{path.join(' / ')} /</span>}
          <span className="label">タスク</span>
        </div>
        <button type="button" className="detail-close" onClick={onClose} title="閉じる (Esc)">
          ✕
        </button>
      </header>

      <div className="detail-body">
        <textarea
          className="detail-title"
          value={title}
          rows={2}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && patch({ title: title.trim() })}
        />

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

        <div className="detail-field">
          <span className="label">メモ</span>
          <textarea
            className="input detail-notes"
            rows={3}
            placeholder="次に再開するときの手がかり"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== task.notes && patch({ notes })}
          />
        </div>

        <div className="detail-field">
          <span className="label">分解（任意）</span>
          {children.map((c) => (
            <div key={c.id} className={`detail-sub ${c.status === 'done' ? 'is-done' : ''}`}>
              <button
                type="button"
                className="detail-sub-check"
                onClick={() => void call('task:update', { id: c.id, patch: { status: c.status === 'done' ? 'todo' : 'done' } })}
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
              void call('task:create', { title: sub.trim(), parentId: task.id, projectId: task.projectId, status: task.status === 'done' ? 'todo' : task.status })
              setSub('')
            }}
          />
        </div>
      </div>

      <footer className="detail-foot">
        <button
          type="button"
          className="btn btn-primary btn-md"
          onClick={() => void call('session:start', { taskId: task.id, minutes: state.settings.defaultSessionMinutes })}
          disabled={Boolean(state.live)}
          title={state.live ? 'すでにセッションが動いている' : ''}
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
              void call('task:delete', { id: task.id })
              setConfirmDelete(false)
              onClose()
            }}
          >
            削除する
          </button>
        </div>
      </Modal>
    </aside>
  )
}


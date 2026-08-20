import { useMemo, useState } from 'react'
import { call, cmd } from '../bridge'
import { useData } from '../store'
import { projectById, projectColor, taskById } from '../lib/selectors'
import { BigDuration, Chip, Empty, TitleBar, useEscape } from '../ui/primitives'
import { focusByTask, focusMs, formatClock, formatDuration, pausedMs } from '@shared/engine'

interface Draft {
  taskId: string
  from: number
  to: number
  markedDone: boolean
}

export function ReviewWindow() {
  const state = useData()
  const pending = state.pendingReview
  const session = useMemo(
    () => state.sessions.find((s) => s.id === pending?.sessionId) ?? null,
    [state.sessions, pending],
  )

  const initial = useMemo<Draft[]>(() => {
    if (!session) return []
    const ids = [...new Set(session.segments.map((s) => s.taskId))]
    return ids.map((taskId) => {
      const task = taskById(state, taskId)
      const from = task?.progress ?? 0
      return { taskId, from, to: from, markedDone: task?.status === 'done' }
    })
    // セッションが決まった時点の値を初期値にする（以後の再計算で入力を巻き戻さない）
  }, [session?.id])

  const [drafts, setDrafts] = useState<Draft[]>(initial)
  const [note, setNote] = useState('')
  const [showLog, setShowLog] = useState(false)

  useEscape(true, () => void call('session:skipReview'))

  if (!session) {
    return (
      <div className="win review">
        <TitleBar title="セッションの記録" onClose={() => void cmd.closeSelf()} />
        <Empty title="記録するセッションがない" />
      </div>
    )
  }

  const end = session.endedAt ?? Date.now()
  const perTask = focusByTask(session, end)
  const created = state.tasks.filter((t) => t.createdInSessionId === session.id)

  function patch(taskId: string, next: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.taskId === taskId ? { ...d, ...next } : d)))
  }

  async function save() {
    await call('session:review', { sessionId: session!.id, changes: drafts, note })
  }

  return (
    <div className="win review">
      <TitleBar
        title="セッションの記録"
        subtitle={`${formatClock(session.startedAt)} – ${formatClock(end)}`}
        onClose={() => void call('session:skipReview')}
      />

      <div className="review-body">
        <section className="review-summary">
          <Stat label="実作業" node={<BigDuration ms={focusMs(session, end)} size={38} />} />
          <Stat label="一時停止" value={formatDuration(pausedMs(session, end), 'compact')} />
          <Stat label="予定" value={formatDuration(session.plannedMs, 'compact')} />
          <Stat label="タスク" value={`${drafts.length}`} />
        </section>

        <div className="review-lead">
          <h3>どこまで進んだ？</h3>
          <p>数字を動かす必要がなければ、そのままでいい。</p>
        </div>

        {drafts.map((draft) => {
          const task = taskById(state, draft.taskId)
          const project = projectById(state, task?.projectId ?? null)
          const spent = perTask.get(draft.taskId) ?? 0
          return (
            <section key={draft.taskId} className={`review-task ${draft.markedDone ? 'is-done' : ''}`}>
              <header className="review-task-head">
                <div className="review-task-title">
                  {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
                  <span>{task?.title ?? '（削除されたタスク）'}</span>
                </div>
                <span className="num review-task-spent">{formatDuration(spent, 'compact')}</span>
              </header>

              <div className="review-progress">
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draft.to}
                  onChange={(e) => patch(draft.taskId, { to: Number(e.target.value) })}
                  style={{ ['--fill' as string]: `${draft.to}%` }}
                />
                <div className="review-progress-nums num">
                  <span className="review-from">{draft.from}%</span>
                  <span className="review-arrow">→</span>
                  <span className={`review-to ${draft.to > draft.from ? 'is-up' : draft.to < draft.from ? 'is-down' : ''}`}>
                    {draft.to}%
                  </span>
                </div>
              </div>

              <label className="review-done no-drag">
                <input
                  type="checkbox"
                  checked={draft.markedDone}
                  onChange={(e) => patch(draft.taskId, { markedDone: e.target.checked, to: e.target.checked ? 100 : draft.to })}
                />
                <span>このタスクは完了した</span>
              </label>
            </section>
          )
        })}

        {created.length > 0 && (
          <section className="review-created">
            <div className="label">このセッション中に生まれたタスク</div>
            {created.map((t) => (
              <div key={t.id} className="review-created-row">
                <span className="review-created-title">{t.title}</span>
                <select
                  className="input review-created-select"
                  value={t.status}
                  onChange={(e) => void call('task:update', { id: t.id, patch: { status: e.target.value } })}
                >
                  <option value="inbox">Inbox に置く</option>
                  <option value="todo">Todo にする</option>
                  <option value="doing">Doing のまま</option>
                  <option value="done">完了</option>
                </select>
              </div>
            ))}
          </section>
        )}

        <section className="review-note">
          <label className="label" htmlFor="review-note">
            ひとこと（任意）
          </label>
          <input
            id="review-note"
            className="input"
            placeholder="次に再開するとき、自分に伝えたいこと"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        <section className="review-log">
          <button type="button" className="review-log-toggle disp" onClick={() => setShowLog((v) => !v)}>
            {showLog ? '▾' : '▸'} このセッションの記録（{session.events.length}件）
          </button>
          {showLog && (
            <ol className="review-log-list">
              {session.events.map((e, i) => (
                <li key={i}>
                  <span className="num review-log-time">{formatClock(e.at)}</span>
                  <span className="review-log-label">{e.label}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <footer className="review-foot">
        <button type="button" className="btn btn-quiet btn-md" onClick={() => void call('session:skipReview')}>
          あとでにする
        </button>
        <div className="review-foot-right">
          <span className="review-foot-hint">記録は残る。数字だけ後から直せる。</span>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => void save()} autoFocus>
            記録する
          </button>
        </div>
      </footer>
    </div>
  )
}

function Stat({ label, value, node }: { label: string; value?: string; node?: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      {node ?? <span className="num stat-value">{value}</span>}
    </div>
  )
}


import { useState } from 'react'
import type { PauseInterval, Session, TimeRange } from '@white-box/core/types'
import { invoke } from '@/lib/bridge'
import { useData } from '@/stores/app'
import { candidateTasks, projectById, projectColor, taskById, taskTitle } from '@/lib/selectors'
import { Modal } from '@/components/ui'
import {
  declaredExclusions,
  excludedMs,
  focusByTask,
  focusMs,
  formatClock,
  formatDuration,
  livePausedMs,
  MINUTE,
  plannedReachedAt,
  unpausedRanges,
} from '@white-box/core/engine'

export function SessionRow({ session, now }: { session: Session; now: number }) {
  const state = useData()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const end = session.endedAt ?? now
  const perTask = focusByTask(session, end)
  const taskIds = [...perTask.keys()]

  return (
    <>
      <div className={`srow ${session.endedAt ? '' : 'is-live'}`}>
        <button type="button" className="srow-main" onClick={() => setOpen((v) => !v)}>
          <span className="num srow-time">
            {formatClock(session.startedAt)}
            <i>–</i>
            {session.endedAt ? formatClock(session.endedAt) : '…'}
          </span>

          <span className="srow-tasks">
            {taskIds.map((id) => {
              const task = taskById(state, id)
              const project = projectById(state, task?.projectId ?? null)
              return (
                <span key={id} className="srow-task">
                  <i className="srow-dot" style={{ background: projectColor(project) }} />
                  {taskTitle(state, id)}
                  {taskIds.length > 1 && <b className="num">{formatDuration(perTask.get(id) ?? 0, 'compact')}</b>}
                </span>
              )
            })}
            {session.progressChanges
              .filter((c) => c.to !== c.from)
              .map((c) => (
                <span key={c.taskId} className="srow-delta num">
                  {c.from}% → {c.to}%
                </span>
              ))}
            {session.note && <span className="srow-note">{session.note}</span>}
          </span>

          <span className="srow-right">
            {livePausedMs(session, end) > 0 && (
              <span className="num srow-pause" title="一時停止">
                {formatDuration(livePausedMs(session, end), 'compact')} 停止
              </span>
            )}
            {excludedMs(session, end) > 0 && (
              <span className="num srow-pause" title="後から実作業の外に出した時間">
                {formatDuration(excludedMs(session, end), 'compact')} 除外
              </span>
            )}
            {session.editedAt && <span className="srow-edited" title="手で修正した記録">修正</span>}
            <span className="num srow-focus">{formatDuration(focusMs(session, end), 'compact')}</span>
          </span>
        </button>

        {open && (
          <div className="srow-detail">
            <ol className="srow-log">
              {session.events.map((e, i) => (
                <li key={i}>
                  <span className="num srow-log-time">{formatClock(e.at)}</span>
                  <span>{e.label}</span>
                </li>
              ))}
            </ol>
            <div className="srow-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                記録を修正
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
                削除
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && <SessionEditor session={session} onClose={() => setEditing(false)} />}

      <Modal open={confirming} onClose={() => setConfirming(false)}>
        <h3>この記録を削除する？</h3>
        <p className="modal-text">
          {formatClock(session.startedAt)}–{session.endedAt ? formatClock(session.endedAt) : '…'}／実作業{' '}
          {formatDuration(focusMs(session, end), 'compact')} の記録が消える。これは元に戻せない。
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirming(false)}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-danger btn-md"
            onClick={() => {
              void invoke('session:delete', { id: session.id })
              setConfirming(false)
            }}
          >
            削除する
          </button>
        </div>
      </Modal>
    </>
  )
}

function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function SessionEditor({ session, onClose }: { session: Session; onClose: () => void }) {
  const state = useData()
  const [startedAt, setStartedAt] = useState(toLocalInput(session.startedAt))
  const [endedAt, setEndedAt] = useState(session.endedAt ? toLocalInput(session.endedAt) : '')
  const [minutes, setMinutes] = useState(Math.round(session.plannedMs / MINUTE))
  const [taskId, setTaskId] = useState(session.segments[0]?.taskId ?? '')
  const [note, setNote] = useState(session.note)
  const [exclusions, setExclusions] = useState<TimeRange[]>(declaredExclusions(session))
  const [error, setError] = useState<string | null>(null)

  const multi = new Set(session.segments.map((s) => s.taskId)).size > 1
  const ended = session.endedAt

  function nextExclusionCandidate(): TimeRange | null {
    if (ended === null) return null
    const taken: PauseInterval[] = [
      ...session.pauses.filter((p) => p.reason !== 'excluded'),
      ...exclusions.map((r) => ({ ...r, reason: 'excluded' as const })),
    ]
    const free = unpausedRanges(taken, session.startedAt, ended, ended)
    if (free.length === 0) return null
    const overFrom = plannedReachedAt(session, ended)
    if (overFrom !== null) {
      const over = free.find((r) => r.endedAt > overFrom)
      if (over) return { startedAt: Math.max(over.startedAt, overFrom), endedAt: over.endedAt }
    }
    const last = free[free.length - 1]
    if (!last) return null
    return { startedAt: Math.max(last.startedAt, last.endedAt - 10 * MINUTE), endedAt: last.endedAt }
  }

  function patchExclusion(index: number, next: Partial<TimeRange>) {
    setExclusions((rs) => rs.map((r, i) => (i === index ? { ...r, ...next } : r)))
  }

  async function save() {
    try {
      await invoke('session:update', {
        id: session.id,
        patch: {
          startedAt: new Date(startedAt).getTime(),
          ...(endedAt ? { endedAt: new Date(endedAt).getTime() } : {}),
          plannedMs: minutes * MINUTE,
          note,
          // 除外は終了済みのセッションだけのもの。実行中に送ると受け口が拒否する
          ...(ended !== null ? { exclusions } : {}),
        },
        ...(taskId && taskId !== session.segments[0]?.taskId ? { segmentTaskId: taskId } : {}),
      })
      onClose()
    } catch (e) {
      setError(String(e).replace(/^(Error:\s*)+/, ''))
    }
  }

  return (
    <Modal open onClose={onClose} width={560}>
      <h3>記録を修正する</h3>
      <p className="modal-text">直した記録には「修正」の印が残る。</p>

      <div className="editor-grid">
        <label className="field">
          <span className="label">開始</span>
          <input className="input num" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">終了</span>
          <input className="input num" type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        </label>
        <label className="field">
          <span className="label">予定の長さ（分）</span>
          <input className="input num" type="number" min={1} max={720} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} />
        </label>
        <label className="field">
          <span className="label">タスク</span>
          <select className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={multi}>
            {candidateTasks(state)
              .concat(state.tasks.filter((t) => t.status === 'done'))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
          {multi && <span className="field-hint">このセッションは複数のタスクにまたがっているので、まとめての差し替えはしない。</span>}
        </label>
      </div>

      {ended !== null && (
        <section className="editor-ex">
          <div className="label">作業していなかった時間（除外）</div>
          {exclusions.length === 0 ? (
            <p className="field-hint">止め忘れや、満了に気づかず離席していた区間をここで実作業から外す。</p>
          ) : (
            exclusions.map((range, i) => (
              <div key={i} className="editor-ex-row">
                <input
                  className="input num"
                  type="datetime-local"
                  value={toLocalInput(range.startedAt)}
                  onChange={(e) => {
                    const t = new Date(e.target.value).getTime()
                    if (Number.isFinite(t)) patchExclusion(i, { startedAt: t })
                  }}
                />
                <span className="editor-ex-sep">–</span>
                <input
                  className="input num"
                  type="datetime-local"
                  value={toLocalInput(range.endedAt)}
                  onChange={(e) => {
                    const t = new Date(e.target.value).getTime()
                    if (Number.isFinite(t)) patchExclusion(i, { endedAt: t })
                  }}
                />
                <span className="num editor-ex-len">
                  {formatDuration(Math.max(0, range.endedAt - range.startedAt), 'compact')}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExclusions((rs) => rs.filter((_, j) => j !== i))}
                >
                  取り消す
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm editor-ex-add"
            disabled={nextExclusionCandidate() === null}
            onClick={() => {
              const next = nextExclusionCandidate()
              if (next) setExclusions((rs) => [...rs, next])
            }}
          >
            ＋ 除外を足す
          </button>
        </section>
      )}

      <label className="field editor-note">
        <span className="label">ひとこと</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {error && <p className="editor-ex-error">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-md" onClick={onClose}>
          やめる
        </button>
        <button type="button" className="btn btn-primary btn-md" onClick={() => void save()}>
          修正を保存
        </button>
      </div>
    </Modal>
  )
}

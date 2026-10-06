import { useRef, useState } from 'react'
import { invoke, cmd } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { candidateTasks, childrenOf, projectById, projectColor, STATUS_LABEL, taskById } from '@/lib/selectors'
import { liveTimerPresentation } from '@/lib/liveTimer'
import { Chip, Empty, ProgressBar, Ring, TitleBar, useEscape } from '@/components/ui'
import { formatDuration, pausedMsWithin } from '@white-box/core/engine'
import { remainingLabel } from '@/lib/format'
import { taskExecutionProblem, unfinishedPredecessors } from '@white-box/core/task-control'
import { TaskContextEditor } from '@/features/board/TaskContextEditor'
import { RestartContext } from '@/features/task-control/RestartContext'
import type { NoteEditorHandle } from '@/features/notes/NoteEditor'
import { useEditorFlush } from '@/lib/useEditorFlush'

export function CurrentWorkWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const now = useApp((s) => s.now)
  const [draft, setDraft] = useState('')
  const [draftColumn, setDraftColumn] = useState<'inbox' | 'todo'>('inbox')
  const [splitting, setSplitting] = useState(false)
  const [splitTitle, setSplitTitle] = useState('')
  const [error, setError] = useState('')
  const context = useRef<NoteEditorHandle | null>(null)
  const contextDisclosure = useRef<HTMLDetailsElement | null>(null)
  const action = (request: Promise<unknown>) => { setError(''); void request.catch((cause) => setError(String(cause).replace(/^(Error:\s*)+/, ''))) }
  const flush = async () => { const ok = await context.current?.flush() !== false; if (!ok && contextDisclosure.current) contextDisclosure.current.open = true; return ok }
  const editorFlush = useEditorFlush(flush)
  const close = () => { void (async () => { if (await flush()) await cmd.closeSelf() })() }
  const switchTask = (id: string) => { void (async () => { if (await flush()) action(invoke('session:switchTask', { taskId: id })) })() }

  useEscape(true, close)

  const current = taskById(state, tick?.activeTaskId ?? null)
  const currentProject = projectById(state, current?.projectId ?? null)
  const others = candidateTasks(state, now).filter((t) => t.id !== current?.id)
  const subtasks = current ? childrenOf(state, current.id) : []
  const timer = tick ? liveTimerPresentation(tick, state.breakTimer, now) : null
  const session = state.sessions.find((s) => s.id === tick?.sessionId)
  const managementPauses = session?.pauses.filter((p) => p.reason === 'task-management') ?? []
  const managing = managementPauses.some((p) => p.endedAt === null)
  const originallyPaused = session?.pauses.some((p) => p.endedAt === null && p.reason !== 'task-management') ?? false
  const expired = (session?.mode ?? 'timer') === 'timer' && session?.expiredNotifiedAt != null
  const managementMs = session ? pausedMsWithin(managementPauses, session.startedAt, now, now) : 0

  async function addTask() {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await invoke('task:create', {
      title,
      status: draftColumn,
      projectId: current?.projectId ?? null,
      fromSession: Boolean(tick),
    })
  }

  async function addSubtask() {
    const title = splitTitle.trim()
    if (!title || !current) return
    setSplitTitle('')
    await invoke('task:create', {
      title,
      status: 'todo',
      parentId: current.id,
      projectId: current.projectId,
      fromSession: Boolean(tick),
    })
  }

  return (
    <div className="win current" inert={editorFlush.frozen} aria-busy={editorFlush.frozen}>
      <TitleBar title="現在の仕事" onClose={close} />

      <div className="current-body">
        {editorFlush.error && <p className="task-command-error" role="alert">{editorFlush.error}</p>}
        {editorFlush.frozen && <p className="editor-flush-status" role="status">入力を保存している…</p>}
        {error && <p className="task-command-error" role="alert">{error}</p>}
        {managing && <p className="current-management">タスク整理 {formatDuration(managementMs, 'compact')} · 実作業から除外中。{originallyPaused ? '閉じても一時停止を保つ。' : '閉じると作業を再開する。'}</p>}
        {tick && current && timer ? (
          <section className="current-focus">
            <Ring elapsedMs={timer.elapsedMs} plannedMs={timer.plannedMs} size={96} thickness={5} paused={timer.isPaused}>
              <span className="num current-ring-time">
                {remainingLabel(timer.remainingMs)}
              </span>
              <span className="label">{timer.label}</span>
            </Ring>

            <div className="current-focus-main">
              <div className="current-meta">
                {currentProject && <Chip color={projectColor(currentProject)}>{currentProject.name}</Chip>}
                <span className="num current-spent">{formatDuration(tick.elapsedMs, 'compact')} 実作業</span>
              </div>
              <h2 className="current-title">{current.title}</h2>
              <div className="current-progress">
                <ProgressBar value={current.progress} />
                <span className="num current-pct">{current.progress}%</span>
              </div>
              <div className="current-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSplitting((v) => !v)}>
                  分解する
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => action(invoke(originallyPaused ? 'session:resume' : 'session:pause'))}
                >
                  {expired ? '延長を選ぶ' : timer.isBreak ? '休憩を終える' : originallyPaused ? '閉じたら再開する' : '閉じても一時停止'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void (async () => { if (await flush()) action(invoke('session:end')) })() }}>
                  セッション終了
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="current-idle">
            <p className="current-idle-text">いまセッションは動いていない。</p>
            <button type="button" className="btn btn-primary btn-md" onClick={() => void cmd.openWindow('start')}>
              セッションを開始
            </button>
          </section>
        )}

        {current && <><RestartContext task={current} /><details ref={contextDisclosure} className="phase2-disclosure"><summary>この仕事の文脈を残す</summary><TaskContextEditor ref={context} key={current.id} task={current} /></details></>}

        {splitting && current && (
          <div className="current-split">
            <input
              className="input"
              placeholder={`「${current.title}」の中の、次にやる一手`}
              value={splitTitle}
              onChange={(e) => setSplitTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addSubtask()}
              autoFocus
            />
            <button type="button" className="btn btn-solid btn-md" onClick={() => void addSubtask()}>
              追加
            </button>
          </div>
        )}

        {subtasks.length > 0 && (
          <section className="current-sub">
            <div className="label">このタスクの中身</div>
            {subtasks.map((t) => (
              <div key={t.id} className={`current-sub-row ${t.status === 'done' ? 'is-done' : ''}`}>
                <button
                  type="button"
                  className="current-sub-check"
                  title={t.status === 'done' ? 'Todo に戻す' : '完了にする'}
                  onClick={() =>
                    action(invoke('task:update', {
                      id: t.id,
                      patch: { status: t.status === 'done' ? 'todo' : 'done' },
                    }))
                  }
                >
                  {t.status === 'done' ? '✓' : ''}
                </button>
                <span className="current-sub-title">{t.title}</span>
                {tick && (
                  <button type="button" className="current-switch disp" disabled={Boolean(taskExecutionProblem(state, t.id))} title={taskExecutionProblem(state, t.id) ?? ''} onClick={() => switchTask(t.id)}>
                    切り替える
                  </button>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="current-others">
          <div className="current-others-head">
            <span className="label">ほかのタスク</span>
            <div className="current-add">
              <input
                className="input current-add-input"
                placeholder="思いついた仕事を書く"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addTask()}
              />
              <select
                className="input current-add-select"
                value={draftColumn}
                onChange={(e) => setDraftColumn(e.target.value as 'inbox' | 'todo')}
              >
                <option value="inbox">Inbox へ</option>
                <option value="todo">Todo へ</option>
              </select>
            </div>
          </div>

          {others.length === 0 ? (
            <Empty title="ほかにタスクがない" hint="上の欄に書けば、いつでも足せる。" />
          ) : (
            <div className="current-list">
              {others.map((t) => {
                const project = projectById(state, t.projectId)
                const problem = taskExecutionProblem(state, t.id)
                const recommended = unfinishedPredecessors(state, t, 'recommended')
                return (
                  <div key={t.id} className="current-row">
                    <span className="current-row-status disp" data-status={t.status}>
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span className="current-row-body">
                      <span className="current-row-title">{t.title}</span>
                      {problem && <span className="task-control-hint">{problem}</span>}
                      {recommended.length > 0 && <span className="task-control-hint">推奨先行: {recommended.map((item) => item.task?.title ?? '削除されたタスク').join(' / ')}</span>}
                    </span>
                    {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
                    {t.progress > 0 && <span className="num current-row-pct">{t.progress}%</span>}
                    {tick ? (
                      <button
                        type="button"
                        className="current-switch disp"
                        disabled={Boolean(problem)}
                        title={problem ?? ''}
                        onClick={() => switchTask(t.id)}
                      >
                        切り替える
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="current-switch disp"
                        disabled={Boolean(problem)}
                        title={problem ?? ''}
                        onClick={() => action(invoke('session:start', { taskId: t.id, minutes: state.settings.defaultSessionMinutes }))}
                      >
                        開始する
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

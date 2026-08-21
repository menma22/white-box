import { useState } from 'react'
import { invoke, cmd } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { candidateTasks, childrenOf, projectById, projectColor, STATUS_LABEL, taskById } from '@/lib/selectors'
import { Chip, Empty, ProgressBar, Ring, TitleBar, useEscape } from '@/components/ui'
import { formatDuration } from '@white-box/core/engine'
import { remainingLabel } from '@/lib/format'

export function CurrentWorkWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const [draft, setDraft] = useState('')
  const [draftColumn, setDraftColumn] = useState<'inbox' | 'todo'>('inbox')
  const [splitting, setSplitting] = useState(false)
  const [splitTitle, setSplitTitle] = useState('')

  useEscape(true, () => void cmd.closeSelf())

  const current = taskById(state, tick?.activeTaskId ?? null)
  const currentProject = projectById(state, current?.projectId ?? null)
  const others = candidateTasks(state).filter((t) => t.id !== current?.id)
  const subtasks = current ? childrenOf(state, current.id) : []

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
    <div className="win current">
      <TitleBar title="現在の仕事" onClose={() => void cmd.closeSelf()} />

      <div className="current-body">
        {tick && current ? (
          <section className="current-focus">
            <Ring elapsedMs={tick.elapsedMs} plannedMs={tick.plannedMs} size={96} thickness={5} paused={tick.state === 'paused'}>
              <span className="num current-ring-time">
                {remainingLabel(tick.remainingMs)}
              </span>
              <span className="label">{tick.state === 'paused' ? '停止中' : '残り'}</span>
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
                  onClick={() => void invoke(tick.state === 'paused' ? 'session:resume' : 'session:pause')}
                >
                  {tick.state === 'paused' ? '再開' : '一時停止'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void invoke('session:end')}>
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
                    void invoke('task:update', {
                      id: t.id,
                      patch: { status: t.status === 'done' ? 'todo' : 'done' },
                    })
                  }
                >
                  {t.status === 'done' ? '✓' : ''}
                </button>
                <span className="current-sub-title">{t.title}</span>
                {tick && (
                  <button type="button" className="current-switch disp" onClick={() => void invoke('session:switchTask', { taskId: t.id })}>
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
                return (
                  <div key={t.id} className="current-row">
                    <span className="current-row-status disp" data-status={t.status}>
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span className="current-row-title">{t.title}</span>
                    {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
                    {t.progress > 0 && <span className="num current-row-pct">{t.progress}%</span>}
                    {tick ? (
                      <button
                        type="button"
                        className="current-switch disp"
                        onClick={() => void invoke('session:switchTask', { taskId: t.id })}
                      >
                        切り替える
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="current-switch disp"
                        onClick={() => void invoke('session:start', { taskId: t.id, minutes: state.settings.defaultSessionMinutes })}
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

import { useState } from 'react'
import { invoke, cmd } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { projectById, projectColor, stalledTasks, todayKey } from '@/lib/selectors'
import { Chip, useEscape } from '@/components/ui'
import { dayKey, formatDuration, HOUR } from '@white-box/core/engine'
import { dayTotalMs } from '@/lib/selectors'

export function WelcomeOverlay({ onClose, onGoBoard }: { onClose: () => void; onGoBoard: () => void }) {
  const state = useData()
  const now = useApp((s) => s.now)
  const key = todayKey(state, now)
  const [note, setNote] = useState(state.dayNotes[key] ?? '')

  useEscape(true, dismiss)

  function dismiss() {
    void invoke('welcome:dismiss')
    onClose()
  }

  const hour = new Date(now).getHours()
  const greeting = hour < 5 ? 'まだ起きてる' : hour < 11 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'おつかれ'
  const name = state.settings.displayName.trim()

  const stalls = stalledTasks(state, now)
  const todo = state.tasks
    .filter((t) => t.status === 'todo' || t.status === 'doing')
    .sort((a, b) => (a.priority === 'high' ? -1 : 1) - (b.priority === 'high' ? -1 : 1) || a.order - b.order)
    .slice(0, 6)

  // 「昨日」は一日の境目（dayStartHour）を考慮して数える。手組みのカレンダー日付だと深夜帯に今日の集計を昨日として出す
  const yKey = dayKey(now - 24 * HOUR, state.settings.dayStartHour)
  const yTotal = dayTotalMs(state, yKey, now)

  return (
    <div className="welcome">
      <div className="welcome-card">
        <header className="welcome-head">
          <div>
            <span className="label">{new Date(now).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</span>
            <h1 className="welcome-title">{name ? `${greeting}、${name}。` : `${greeting}。`}</h1>
          </div>
          <button type="button" className="welcome-close" onClick={dismiss} title="閉じる (Esc)">
            ✕
          </button>
        </header>

        {yTotal > 0 && (
          <p className="welcome-yesterday">
            昨日は <b className="num">{formatDuration(yTotal, 'compact')}</b> 記録した。
          </p>
        )}

        {stalls.length > 0 && (
          <section className="welcome-stall">
            {stalls.slice(0, 3).map(({ task, days }) => {
              const project = projectById(state, task.projectId)
              return (
                <div key={task.id} className="stall">
                  <div className="stall-text">
                    <div className="stall-title">
                      {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
                      <span>{task.title}</span>
                    </div>
                    <p className="stall-question">
                      これを「重要」に決めたのに、<b className="num">{days}日</b>動いていない。今後どうする？
                    </p>
                  </div>
                  <div className="stall-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        dismiss()
                        void invoke('session:start', { taskId: task.id, minutes: state.settings.defaultSessionMinutes })
                      }}
                    >
                      今やる
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void invoke('task:update', { id: task.id, patch: { priority: 'normal' } })}
                    >
                      重要をやめる
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void invoke('task:move', { id: task.id, status: 'inbox', index: 0 })}
                    >
                      Inbox へ戻す
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => void invoke('task:update', { id: task.id, patch: { status: 'done' } })}
                      title="やらないと決めるのも、ひとつの判断"
                    >
                      もう追わない
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        )}

        <section className="welcome-todo">
          <div className="label">やると決めていること</div>
          {todo.length === 0 ? (
            <p className="welcome-empty">まだ何も置かれていない。整理から始めてもいい。</p>
          ) : (
            <ul className="welcome-list">
              {todo.map((t) => {
                const project = projectById(state, t.projectId)
                return (
                  <li key={t.id}>
                    {t.priority === 'high' && <i className="welcome-flag" title="重要" />}
                    <span className="welcome-list-title">{t.title}</span>
                    {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
                    {t.progress > 0 && <span className="num welcome-pct">{t.progress}%</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="welcome-note">
          <label className="label" htmlFor="welcome-note">
            今日どうする？（書かなくていい）
          </label>
          <textarea
            id="welcome-note"
            className="input welcome-note-input"
            rows={2}
            placeholder="ひとことだけ、自分に。"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (state.dayNotes[key] ?? '') && void invoke('day:note', { key, text: note })}
          />
        </section>

        <footer className="welcome-foot">
          <button
            type="button"
            className="btn btn-quiet btn-md"
            onClick={() => {
              dismiss()
              onGoBoard()
            }}
          >
            タスクを整理する
          </button>
          <div className="welcome-foot-right">
            <button type="button" className="btn btn-ghost btn-md" onClick={dismiss}>
              閉じる
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => {
                dismiss()
                void cmd.openWindow('start')
              }}
            >
              はじめる
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

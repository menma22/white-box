import { useEffect, useState } from 'react'
import { invoke, cmd } from '../bridge'
import { useApp, useData } from '../store'
import { projectById, projectColor, taskById, todayKey } from '../lib/selectors'
import { Kbd } from '../ui/primitives'
import { BoardView } from '../views/BoardView'
import { TodayView } from '../views/TodayView'
import { HistoryView } from '../views/HistoryView'
import { SettingsView } from '../views/SettingsView'
import { WelcomeOverlay } from '../views/WelcomeOverlay'
import { formatDuration } from '@white-box/core/engine'

type Tab = 'today' | 'board' | 'history' | 'settings'

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'today', label: '今日', glyph: '◷' },
  { id: 'board', label: 'ボード', glyph: '▤' },
  { id: 'history', label: '記録', glyph: '≣' },
  { id: 'settings', label: '設定', glyph: '⚙' },
]

export function MainWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const now = useApp((s) => s.now)
  const [tab, setTab] = useState<Tab>('today')
  const [welcomeOpen, setWelcomeOpen] = useState(state.settings.lastWelcomeDate !== todayKey(state, Date.now()))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i >= 0) {
        e.preventDefault()
        setTab(TABS[i]!.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const liveTask = taskById(state, tick?.activeTaskId ?? null)
  const liveProject = projectById(state, liveTask?.projectId ?? null)

  return (
    <div className="win main">
      <div className="main-titlebar drag">
        <span className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden>
            <rect x="1.3" y="1.3" width="21.4" height="21.4" rx="6.2" fill="none" stroke="var(--accent-deep)" strokeWidth="2.6" />
            <rect x="6.3" y="7.3" width="11.4" height="2.5" rx="1.25" fill="var(--accent)" />
            <rect x="6.3" y="11.6" width="7.6" height="2.5" rx="1.25" fill="var(--accent-deep)" />
            <rect x="6.3" y="15.9" width="4.2" height="2.5" rx="1.25" fill="var(--amber)" />
          </svg>
          <span className="brand-name disp">White Box</span>
        </span>
        <span className="main-titlebar-date disp">
          {new Date(now).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}
        </span>
      </div>

      <div className="main-shell">
        <nav className="rail">
          {tick && liveTask ? (
            <button type="button" className={`rail-live ${tick.state === 'paused' ? 'is-paused' : ''}`} onClick={() => void cmd.openWindow('current')}>
              <span className="rail-live-top">
                <span className="rail-live-dot" />
                <span className="label">{tick.state === 'paused' ? '一時停止' : '実行中'}</span>
                <span className="num rail-live-time">
                  {tick.remainingMs < 0 ? `+${formatDuration(-tick.remainingMs, 'hms')}` : formatDuration(tick.remainingMs, 'hms')}
                </span>
              </span>
              <span className="rail-live-task">{liveTask.title}</span>
              {liveProject && (
                <span className="rail-live-project disp">
                  <i style={{ background: projectColor(liveProject) }} />
                  {liveProject.name}
                </span>
              )}
            </button>
          ) : (
            <button type="button" className="rail-start" onClick={() => void cmd.openWindow('start')}>
              <span className="rail-start-label disp">セッションを開始</span>
              <span className="rail-start-key">
                <Kbd>{state.settings.shortcuts.startPause.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ')}</Kbd>
              </span>
            </button>
          )}

          <div className="rail-tabs">
            {TABS.map((t, i) => (
              <button key={t.id} type="button" className={`rail-tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
                <span className="rail-tab-glyph" aria-hidden>
                  {t.glyph}
                </span>
                <span className="rail-tab-label">{t.label}</span>
                <span className="rail-tab-key num">{i + 1}</span>
              </button>
            ))}
          </div>

          <div className="rail-foot">
            <button type="button" className="rail-link" onClick={() => void cmd.openWindow('current')}>
              現在の仕事
              <Kbd>{state.settings.shortcuts.currentWork.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ')}</Kbd>
            </button>
          </div>
        </nav>

        <main className="main-content">
          {state.recovery && <RecoveryBanner />}
          {tab === 'today' && <TodayView />}
          {tab === 'board' && <BoardView />}
          {tab === 'history' && <HistoryView />}
          {tab === 'settings' && <SettingsView />}
        </main>
      </div>

      {welcomeOpen && <WelcomeOverlay onClose={() => setWelcomeOpen(false)} onGoBoard={() => setTab('board')} />}
    </div>
  )
}

function RecoveryBanner() {
  const state = useData()
  const rec = state.recovery!
  const session = state.sessions.find((s) => s.id === rec.sessionId)
  const task = taskById(state, session?.segments.at(-1)?.taskId ?? null)
  const when = new Date(rec.lastKnownAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="recovery">
      <div className="recovery-text">
        <strong>前回のセッションが開いたままだった。</strong>
        <span>
          「{task?.title ?? '不明なタスク'}」を計測中にアプリが終了している。最後に記録が取れたのは {when}。
        </span>
      </div>
      <div className="recovery-actions">
        <button type="button" className="btn btn-solid btn-sm" onClick={() => void invoke('recovery:close')}>
          その時刻で終了する
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void invoke('recovery:resume')}>
          続きから再開する
        </button>
      </div>
    </div>
  )
}

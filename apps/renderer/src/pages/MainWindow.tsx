import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, cmd } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { projectById, projectColor, taskById, todayKey } from '@/lib/selectors'
import { liveTimerPresentation } from '@/lib/liveTimer'
import { Kbd } from '@/components/ui'
import { BoardView } from '@/features/board/BoardView'
import { TodayView } from '@/features/today/TodayView'
import { WeekView } from '@/features/today/WeekView'
import { HistoryView } from '@/features/history/HistoryView'
import { SettingsView } from '@/features/settings/SettingsView'
import { GoalMapView } from '@/features/goals/GoalMapView'
import { GoalIssuesView } from '@/features/goals/GoalIssues'
import { WelcomeOverlay } from '@/features/welcome/WelcomeOverlay'
import { OnboardingFlow } from '@/features/onboarding/OnboardingFlow'
import { TaskSuggestions } from '@/features/agents/TaskSuggestions'
import { remainingLabel, shortcutLabel } from '@/lib/format'
import { NotesView, type NotesViewHandle } from '@/features/notes/NotesView'
import { ReminderPanel } from '@/features/notes/ReminderPanel'

type Tab = 'today' | 'week' | 'board' | 'history' | 'settings' | 'goals' | 'issues' | 'notes'

const TABS: { id: Tab; label: string; glyph: string; shortcut: string }[] = [
  { id: 'today', label: '今日', glyph: '◷', shortcut: '1' },
  { id: 'week', label: '週', glyph: '▦', shortcut: '8' },
  { id: 'board', label: 'ボード', glyph: '▤', shortcut: '2' },
  { id: 'history', label: '記録', glyph: '≣', shortcut: '3' },
  { id: 'goals', label: '道標', glyph: '⌘', shortcut: '5' },
  { id: 'issues', label: '問題・改善', glyph: '◇', shortcut: '6' },
  { id: 'notes', label: 'ノート', glyph: '▱', shortcut: '7' },
  { id: 'settings', label: '設定', glyph: '⚙', shortcut: '4' },
]

export function MainWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const now = useApp((s) => s.now)
  const [tab, setTab] = useState<Tab>('today')
  const notes = useRef<NotesViewHandle | null>(null)
  const navigate = useCallback(async (destination: Tab) => {
    if (tab === 'notes' && destination !== 'notes' && await notes.current?.flush() === false) return
    setTab(destination)
  }, [tab])
  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0 }, [tab])
  const [onboarding, setOnboarding] = useState(state.settings.onboardedAt === null)
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<string | null>(null)
  const goNote = useCallback((id: string) => { setSelectedNote(id); setTab('notes') }, [])
  const noteJumpHandled = useCallback(() => setSelectedNote(null), [])
  const [boardView, setBoardView] = useState<'board' | 'list'>('board')
  const jumpGoal = useCallback((id: string) => { setSelectedGoal(id); void navigate('goals') }, [navigate])
  const goTasks = useCallback((id?: string) => { setSelectedTask(id ?? null); setBoardView('list'); void navigate('board') }, [navigate])
  const goIssues = useCallback(() => { void navigate('issues') }, [navigate])
  const jumpHandled = useCallback(() => setSelectedGoal(null), [])
  const taskJumpHandled = useCallback(() => setSelectedTask(null), [])
  // onboardedAt の条件を外すと、初回にオンボーディングと毎日の挨拶が 2 枚重なる
  const [welcomeOpen, setWelcomeOpen] = useState(
    state.settings.onboardedAt !== null && state.settings.lastWelcomeDate !== todayKey(state, Date.now()),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const destination = TABS.find((item) => item.shortcut === e.key)
      if (destination) {
        e.preventDefault()
        void navigate(destination.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const liveTask = taskById(state, tick?.activeTaskId ?? null)
  const liveProject = projectById(state, liveTask?.projectId ?? null)
  const liveTimer = tick ? liveTimerPresentation(tick, state.breakTimer, now) : null

  return (
    <div className="win main">
      <div className="main-titlebar drag">
        <span className="brand">
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2.5 20.5 7.3V16.7L12 21.5 3.5 16.7V7.3Z" fill="var(--panel)" />
            <path d="M12 12 20.5 7.3V16.7L12 21.5Z" fill="var(--amber)" />
            <path d="M12 2.5 20.5 7.3V16.7L12 21.5 3.5 16.7V7.3Z M3.5 7.3 12 12 20.5 7.3 M12 12V21.5" fill="none" stroke="var(--accent-deep)" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span className="brand-name disp">White Box</span>
        </span>
        <span className="main-titlebar-date disp">
          {new Date(now).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}
        </span>
      </div>

      <div className="main-shell">
        <nav className="rail">
          {tick && liveTask && liveTimer ? (
            <button type="button" className={`rail-live ${tick.state === 'paused' ? 'is-paused' : ''}`} onClick={() => void cmd.openWindow('current')}>
              <span className="rail-live-top">
                <span className="rail-live-dot" />
                <span className="label">{liveTimer.status}</span>
                <span className="num rail-live-time">
                  {remainingLabel(liveTimer.remainingMs)}
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
              {state.settings.shortcuts.startPause !== '' && (
                <span className="rail-start-key">
                  <Kbd>{shortcutLabel(state.settings.shortcuts.startPause)}</Kbd>
                </span>
              )}
            </button>
          )}

          <div className="rail-tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`rail-tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => void navigate(t.id)}>
                <span className="rail-tab-glyph" aria-hidden>
                  {t.glyph}
                </span>
                <span className="rail-tab-label">{t.label}</span>
                <span className="rail-tab-key num">{t.shortcut}</span>
              </button>
            ))}
          </div>

          <div className="rail-foot">
            <button type="button" className="rail-link" onClick={() => void cmd.openWindow('current')}>
              現在の仕事
              {state.settings.shortcuts.currentWork !== '' && <Kbd>{shortcutLabel(state.settings.shortcuts.currentWork)}</Kbd>}
            </button>
          </div>
        </nav>

        <main className="main-content" ref={contentRef}>
          {state.recovery && <RecoveryBanner />}
          {tab === 'today' && <TaskSuggestions suggestions={state.taskSuggestions ?? []} sessions={state.sessions} />}
          {tab === 'today' && <ReminderPanel notes={state.notes ?? []} now={now} onOpen={goNote} onDismiss={(id) => void invoke('note:update', { id, patch: { remindAt: null } })} />}
          {tab === 'today' && <TodayView />}
          {tab === 'week' && <WeekView />}
          {tab === 'board' && <BoardView onJumpGoal={jumpGoal} initialView={boardView} initialTaskId={selectedTask} onTaskJumpHandled={taskJumpHandled} />}
          {tab === 'history' && <HistoryView />}
          {tab === 'settings' && <SettingsView />}
          {tab === 'goals' && <GoalMapView onGoTasks={goTasks} onGoIssues={goIssues} initialNodeId={selectedGoal} onJumpHandled={jumpHandled} />}
          {tab === 'issues' && <GoalIssuesView onJump={jumpGoal} />}
          {tab === 'notes' && <NotesView ref={notes} data={state} now={now} initialNoteId={selectedNote} onJumpHandled={noteJumpHandled} />}
        </main>
      </div>

      {onboarding && <OnboardingFlow onDone={() => setOnboarding(false)} />}
      {welcomeOpen && <WelcomeOverlay onClose={() => setWelcomeOpen(false)} onGoBoard={() => void navigate('board')} />}
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

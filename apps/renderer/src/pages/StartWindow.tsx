import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke, cmd } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { candidateTasks, matchTask, projectById, projectColor, STATUS_LABEL } from '@/lib/selectors'
import { Chip, Kbd, ProgressBar, useEscape } from '@/components/ui'
import { formatDuration } from '@white-box/core/engine'

const DURATIONS = [25, 50, 90]

export function StartWindow() {
  const state = useData()
  const now = useApp((s) => s.now)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [minutes, setMinutes] = useState(state.settings.defaultSessionMinutes)
  const [projectId, setProjectId] = useState<string>(state.projects[0]?.id ?? '')
  const listRef = useRef<HTMLDivElement>(null)

  useEscape(true, () => void cmd.closeSelf())

  const matches = useMemo(
    () => candidateTasks(state).filter((t) => matchTask(state, t, query)),
    [state, query],
  )
  const exact = matches.some((t) => t.title.toLowerCase() === query.trim().toLowerCase())
  const canCreate = query.trim().length > 0 && !exact
  const rows = canCreate ? matches.length + 1 : matches.length
  const isCreateRow = canCreate && cursor === matches.length

  useEffect(() => setCursor(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, query])

  async function start() {
    if (isCreateRow) {
      await invoke('session:start', {
        newTask: { title: query.trim(), projectId: projectId || null },
        minutes,
      })
      return
    }
    const task = matches[cursor]
    if (!task) return
    await invoke('session:start', { taskId: task.id, minutes })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (rows === 0 ? 0 : (c + 1) % rows))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (rows === 0 ? 0 : (c - 1 + rows) % rows))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void start()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const i = DURATIONS.indexOf(minutes)
      setMinutes(DURATIONS[(i + 1) % DURATIONS.length] ?? 50)
    }
  }

  return (
    <div className="win start-win" onKeyDown={onKeyDown}>
      <div className="start-head drag">
        <div className="start-head-label label">これから何をやる？</div>
        <Kbd>Esc</Kbd>
      </div>

      <div className="start-search no-drag">
        <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden className="start-search-icon">
          <circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10 10l3.2 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          className="start-input"
          placeholder="タスクを探す、または新しいタスクを書く"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          spellCheck={false}
        />
      </div>

      <div className="start-list" ref={listRef}>
        {matches.map((task, i) => {
          const project = projectById(state, task.projectId)
          return (
            <button
              key={task.id}
              type="button"
              className={`start-row ${i === cursor ? 'is-cursor' : ''}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => void start()}
            >
              <span className="start-row-status disp" data-status={task.status}>
                {STATUS_LABEL[task.status]}
              </span>
              <span className="start-row-body">
                <span className="start-row-title">{task.title}</span>
                <span className="start-row-meta">
                  {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
                  {task.progress > 0 && <span className="num start-row-pct">{task.progress}%</span>}
                </span>
              </span>
              {task.progress > 0 && (
                <span className="start-row-bar">
                  <ProgressBar value={task.progress} height={3} />
                </span>
              )}
            </button>
          )
        })}

        {canCreate && (
          <div className={`start-row start-row-new ${isCreateRow ? 'is-cursor' : ''}`} onMouseMove={() => setCursor(matches.length)}>
            <span className="start-row-status disp" data-status="new">
              新規
            </span>
            <span className="start-row-body">
              <span className="start-row-title">「{query.trim()}」を新しいタスクとして開始</span>
            </span>
            <select
              className="input start-project no-drag"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">プロジェクトなし</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {rows === 0 && <div className="start-none">タスクがない。上の欄に書けば、そのまま始められる。</div>}
      </div>

      <footer className="start-foot">
        <div className="start-durations">
          <span className="label">セッション</span>
          {DURATIONS.map((m) => (
            <button
              key={m}
              type="button"
              className={`start-dur disp ${m === minutes ? 'is-active' : ''}`}
              onClick={() => setMinutes(m)}
            >
              {m}
              <i>分</i>
            </button>
          ))}
          <input
            className="start-dur-custom num"
            type="number"
            min={1}
            max={480}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Math.min(480, Number(e.target.value) || 1)))}
            title="任意の長さ"
          />
        </div>
        <button type="button" className="start-go disp" onClick={() => void start()} disabled={rows === 0}>
          開始
          <span className="start-go-time num">{formatDuration(minutes * 60_000, 'compact')}</span>
        </button>
      </footer>

      <div className="start-hint">
        <span>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> 選ぶ
        </span>
        <span>
          <Kbd>Tab</Kbd> 長さ
        </span>
        <span>
          <Kbd>Enter</Kbd> 開始
        </span>
        <span className="start-hint-now num">{new Date(now).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useApp, useData } from '@/stores/app'
import { todayKey } from '@/lib/selectors'
import { activitySummary, dayRange, shiftDay, weekKey, weekRange } from '@white-box/core/activity'
import { formatDuration } from '@white-box/core/engine'
import { BigDuration } from '@/components/ui'
import { ActivityBreakdown } from './ActivityBreakdown'
import { ActivityTrend } from './ActivityTrend'
import { SessionRow } from '@/features/sessions/SessionRow'

export function WeekView() {
  const state = useData()
  const now = useApp((s) => s.now)
  const today = todayKey(state, now)
  const [offset, setOffset] = useState(0)
  const start = shiftDay(weekKey(today), offset * 7)
  const period = weekRange(start, state.settings.dayStartHour)
  const summary = activitySummary(state.sessions, state.tasks, now, period)
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDay(start, index)
    return { key, summary: activitySummary(state.sessions, state.tasks, now, dayRange(key, state.settings.dayStartHour)) }
  })
  const max = Math.max(1, ...days.map((d) => d.summary.focusMs))
  return <div className="view week">
    <header className="view-head">
      <div><span className="label">週の実績</span><h1 className="view-title">{start} — {shiftDay(start, 6)}</h1><div className="week-navigation">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOffset((n) => n - 1)}>前の週</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOffset(0)}>今週</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOffset((n) => n + 1)}>次の週</button>
      </div></div>
      <div className="today-total"><BigDuration ms={summary.focusMs} size={46} /><span className="label">週の実作業</span></div>
    </header>
    <div className="today-strip">
      <div className="metric"><span className="num metric-value">{days.filter((d) => d.summary.focusMs > 0).length}</span><span className="label">記録のある日</span></div>
      <div className="metric"><span className="num metric-value">{summary.sessions.length}</span><span className="label">セッション</span></div>
      <div className="metric"><span className="num metric-value">{summary.completedTasks.length}</span><span className="label">完了したタスク</span></div>
    </div>
    <section className="activity-panel week-days" aria-label="各日の実績"><h2>各日の実績</h2>
      {days.map(({ key, summary: day }) => <details key={key} className="week-day">
        <summary><span>{key.slice(5).replace('-', '/')} {new Date(`${key}T12:00:00`).toLocaleDateString('ja-JP', { weekday: 'short' })}{key === today ? '・今日' : ''}</span><span className="week-bar"><i style={{ width: `${day.focusMs / max * 100}%` }} /></span><span className="num">{formatDuration(day.focusMs, 'compact')}</span></summary>
        <ActivityBreakdown state={state} summary={day} />
        {[...day.sessions].reverse().map((session) => <SessionRow key={session.id} session={session} now={now} inPeriod={{ ms: day.sessionMs.get(session.id) ?? 0, label: 'この日' }} />)}
      </details>)}
    </section>
    <ActivityBreakdown state={state} summary={summary} />
    {summary.completedTasks.length > 0 && <section className="activity-panel"><h2>この週に完了したタスク</h2><ul>{summary.completedTasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul></section>}
    <ActivityTrend state={state} now={now} lastDay={today} />
    <p className="activity-note">週は月曜日の {state.settings.dayStartHour}:00 から。進行中の週は途中の実績。重複した時刻は一度だけ集計。タスク完了は目標の成果達成とは別。</p>
  </div>
}

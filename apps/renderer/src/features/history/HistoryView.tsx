import { useMemo, useState } from 'react'
import { useApp, useData } from '@/stores/app'
import { dayKeysWithSessions, todayKey } from '@/lib/selectors'
import { activitySummary, dayRange } from '@white-box/core/activity'
import { BigDuration, Empty } from '@/components/ui'
import { dayStartTs, formatDuration, sessionEndOrNow } from '@white-box/core/engine'
import { SessionRow } from '@/features/sessions/SessionRow'
import { PresenceCandidates } from '@/features/presence/PresenceCandidates'

function shiftMonth(month: string, offset: number): string {
  const [year, index] = month.split('-').map(Number)
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year!, index! - 1 + offset, 1)
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function HistoryView() {
  const state = useData()
  const now = useApp((s) => s.now)
  const today = todayKey(state, now)
  const [month, setMonth] = useState<string | null>(null)
  const selectedMonth = month ?? today.slice(0, 7)
  const period = useMemo(() => ({ startedAt: dayStartTs(`${selectedMonth}-01`, state.settings.dayStartHour), endedAt: dayStartTs(`${shiftMonth(selectedMonth, 1)}-01`, state.settings.dayStartHour) }), [selectedMonth, state.settings.dayStartHour])
  const keys = useMemo(() => dayKeysWithSessions(state, now, period), [state.sessions, state.settings.dayStartHour, now, period])
  const [open, setOpen] = useState<string[]>([today])

  const summaries = useMemo(() => keys.map((k) => activitySummary(state.sessions, state.tasks, now, dayRange(k, state.settings.dayStartHour))), [keys, state.sessions, state.tasks, state.settings.dayStartHour, now])
  const totals = summaries.map((summary) => summary.focusMs)
  const max = Math.max(1, ...totals)
  const grand = useMemo(() => {
    if (state.sessions.length === 0) return 0
    const fullPeriod = state.sessions.reduce((range, session) => ({ startedAt: Math.min(range.startedAt, session.startedAt), endedAt: Math.max(range.endedAt, sessionEndOrNow(session, now)) }), { startedAt: Infinity, endedAt: -Infinity })
    return activitySummary(state.sessions, state.tasks, now, fullPeriod).focusMs
  }, [state.sessions, state.tasks, now])

  return (
    <div className="view history">
      <header className="view-head">
        <div>
          <span className="label">記録</span>
          <h1 className="view-title">これまで</h1>
        </div>
        <div className="today-total">
          <BigDuration ms={grand} size={40} />
          <span className="label">すべての記録の合計</span>
        </div>
      </header>

      <div className="history-month-navigation" aria-label="記録を表示する月">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(selectedMonth, -1))}>前の月</button>
        <label>表示する月<input className="input num" type="month" value={selectedMonth} onChange={(event) => { if (event.target.value) setMonth(event.target.value) }} /></label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(null)}>今月</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMonth(shiftMonth(selectedMonth, 1))}>次の月</button>
      </div>
      <p className="activity-note">{selectedMonth} の記録を表示。一日の境目は {state.settings.dayStartHour}:00。全体合計は表示する月を変えても変わらない。</p>
      <div className="history-days">
        <PresenceCandidates />
        {keys.length === 0 && <Empty title={state.sessions.length === 0 ? 'まだ記録がない' : 'この月は記録がない'} hint="前後の月へ移動するか、表示する月を指定できる。" />}
        {keys.map((key, i) => {
          const total = totals[i] ?? 0
          const summary = summaries[i]!
          const sessions = summary.sessions
          const expanded = open.includes(key)
          const d = new Date(`${key}T00:00:00`)
          return (
            <section key={key} className={`hday ${expanded ? 'is-open' : ''}`}>
              <button
                type="button"
                className="hday-head"
                onClick={() => setOpen((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]))}
              >
                <span className="hday-date disp">
                  {d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                  <i>{d.toLocaleDateString('ja-JP', { weekday: 'short' })}</i>
                  {key === today && <b className="hday-today">今日</b>}
                </span>
                <span className="hday-bar">
                  <span className="hday-bar-fill" style={{ width: `${(total / max) * 100}%` }} />
                </span>
                <span className="num hday-total">{formatDuration(total, 'compact')}</span>
                <span className="num hday-count">{sessions.length}本</span>
              </button>

              {expanded && (
                <div className="hday-body">
                  {[...sessions].reverse().map((s) => (
                    <SessionRow key={s.id} session={s} now={now} inPeriod={{ ms: summary.sessionMs.get(s.id) ?? 0, label: 'この日' }} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useApp, useData } from '@/stores/app'
import { dayKeysWithSessions, todayKey } from '@/lib/selectors'
import { activitySummary, dayRange } from '@white-box/core/activity'
import { BigDuration, Empty } from '@/components/ui'
import { formatDuration } from '@white-box/core/engine'
import { SessionRow } from '@/features/sessions/SessionRow'
import { PresenceCandidates } from '@/features/presence/PresenceCandidates'

export function HistoryView() {
  const state = useData()
  const now = useApp((s) => s.now)
  const keys = useMemo(() => dayKeysWithSessions(state, now), [state.sessions, state.settings.dayStartHour, now])
  const today = todayKey(state, now)
  const [open, setOpen] = useState<string[]>([today])

  const summaries = useMemo(() => keys.map((k) => activitySummary(state.sessions, state.tasks, now, dayRange(k, state.settings.dayStartHour))), [keys, state.sessions, state.tasks, state.settings.dayStartHour, now])
  const totals = summaries.map((summary) => summary.focusMs)
  const max = Math.max(1, ...totals)
  const grand = totals.reduce((a, b) => a + b, 0)

  if (keys.length === 0) {
    return (
      <div className="view">
        <header className="view-head">
          <div>
            <span className="label">記録</span>
            <h1 className="view-title">これまで</h1>
          </div>
        </header>
        <PresenceCandidates />
        <Empty title="まだ記録がない" hint="セッションを終えると、ここに一日ずつ積み上がっていく。" />
      </div>
    )
  }

  return (
    <div className="view history">
      <header className="view-head">
        <div>
          <span className="label">記録</span>
          <h1 className="view-title">これまで</h1>
        </div>
        <div className="today-total">
          <BigDuration ms={grand} size={40} />
          <span className="label">{keys.length}日ぶんの合計</span>
        </div>
      </header>

      <div className="history-days">
        <PresenceCandidates />
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

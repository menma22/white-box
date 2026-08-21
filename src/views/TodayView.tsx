import { useMemo } from 'react'
import { useApp, useData } from '../store'
import { sessionsForDay, todayKey } from '../lib/selectors'
import { BigDuration, Empty } from '../ui/primitives'
import { focusMs, formatDuration, pausedMs } from '@white-box/core/engine'
import { SessionRow } from './SessionRow'
import { DayRibbon } from './DayRibbon'

export function TodayView() {
  const state = useData()
  const now = useApp((s) => s.now)
  const key = todayKey(state, now)
  const sessions = useMemo(() => sessionsForDay(state, key), [state.sessions, key])

  const total = sessions.reduce((sum, s) => sum + focusMs(s, now), 0)
  const paused = sessions.reduce((sum, s) => sum + pausedMs(s, now), 0)

  return (
    <div className="view today">
      <header className="view-head">
        <div>
          <span className="label">今日</span>
          <h1 className="view-title">
            {new Date(now).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}
          </h1>
        </div>
        <div className="today-total">
          <BigDuration ms={total} size={46} />
          <span className="label">記録した作業</span>
        </div>
      </header>

      <div className="today-strip">
        <Metric label="セッション" value={`${sessions.length}`} />
        <Metric label="一時停止" value={paused > 0 ? formatDuration(paused, 'compact') : '—'} />
        <Metric
          label="平均の長さ"
          value={sessions.length ? formatDuration(total / sessions.length, 'compact') : '—'}
        />
        <Metric label="いま" value={new Date(now).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} />
      </div>

      {sessions.length === 0 ? (
        <Empty title="今日はまだ記録がない" hint="ショートカットを押せば、そこから記録が始まる。" />
      ) : (
        <>
          <DayRibbon sessions={sessions} now={now} />
          <section className="today-list">
            <div className="label today-list-label">セッション</div>
            {[...sessions].reverse().map((s) => (
              <SessionRow key={s.id} session={s} now={now} />
            ))}
          </section>
        </>
      )}

      {total > 0 && total < 30 * 60_000 && (
        <p className="today-foot-note">
          記録は {formatDuration(total, 'compact')}。少ないと感じるなら、それが今日の現実。責める必要はないけれど、目を逸らす必要もない。
        </p>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="num metric-value">{value}</span>
      <span className="label">{label}</span>
    </div>
  )
}


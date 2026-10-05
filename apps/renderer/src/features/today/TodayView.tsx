import { useMemo } from 'react'
import { useApp, useData } from '@/stores/app'
import { todayKey } from '@/lib/selectors'
import { BigDuration, Empty } from '@/components/ui'
import { formatDuration } from '@white-box/core/engine'
import { activitySummary, dayRange } from '@white-box/core/activity'
import { SessionRow } from '@/features/sessions/SessionRow'
import { DayRibbon } from './DayRibbon'
import { ActivityBreakdown } from './ActivityBreakdown'
import { ActivityTrend } from './ActivityTrend'

export function TodayView() {
  const state = useData()
  const now = useApp((s) => s.now)
  const key = todayKey(state, now)
  const period = dayRange(key, state.settings.dayStartHour)
  const summary = useMemo(() => activitySummary(state.sessions, state.tasks, now, period), [state.sessions, state.tasks, now, key, state.settings.dayStartHour])
  const { sessions, focusMs: total, pausedMs: paused, managementMs: managing, excludedMs: excluded } = summary

  return (
    <div className="view today">
      <header className="view-head">
        <div>
          <span className="label">今日</span>
          <h1 className="view-title">
            {new Date(`${key}T12:00:00`).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })}
          </h1>
        </div>
        <div className="today-total">
          <BigDuration ms={total} size={46} />
          <span className="label">記録した作業</span>
        </div>
      </header>

      <div className="today-strip">
        <Metric label="セッション" value={`${sessions.length}`} />
        <Metric label="一時停止" value={paused > managing ? formatDuration(paused - managing, 'compact') : '—'} />
        {managing > 0 && <Metric label="タスク整理" value={formatDuration(managing, 'compact')} />}
        {excluded > 0 && <Metric label="除外" value={formatDuration(excluded, 'compact')} />}
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
          <DayRibbon sessions={sessions} now={now} period={period} />
          <ActivityBreakdown state={state} summary={summary} />
          <section className="today-list">
            <div className="label today-list-label">セッション</div>
            {[...sessions].reverse().map((s) => (
              <SessionRow key={s.id} session={s} now={now} inPeriod={{ ms: summary.sessionMs.get(s.id) ?? 0, label: 'この日' }} />
            ))}
          </section>
        </>
      )}

      <ActivityTrend state={state} now={now} lastDay={key} />
      <p className="activity-note">一日の境目は {state.settings.dayStartHour}:00。時間はこの日に入る区間だけを集計。重なる実作業は開始が早い記録へ一度だけ数え、別の記録の停止より実作業を優先する。進捗は現在の宣言値。</p>
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


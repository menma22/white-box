import type { AppState } from '@white-box/core/types'
import { activitySummary, dayRange, shiftDay } from '@white-box/core/activity'
import { formatDuration } from '@white-box/core/engine'

export function ActivityTrend({ state, now, lastDay }: { state: AppState; now: number; lastDay: string }) {
  const days = Array.from({ length: 14 }, (_, index) => {
    const key = shiftDay(lastDay, index - 13)
    return { key, ms: activitySummary(state.sessions, state.tasks, now, dayRange(key, state.settings.dayStartHour)).focusMs }
  })
  const max = Math.max(...days.map((d) => d.ms), 1)
  const x = (index: number) => 16 + index * (628 / 13)
  const y = (ms: number) => 126 - (ms / max) * 104
  return <section className="activity-panel activity-trend" aria-label="最近14日の作業時間">
    <h2>最近14日の作業時間</h2>
    <p className="activity-note">今日を含む実績。記録がない日は0。</p>
    <svg viewBox="0 0 660 154" role="img" aria-label="最近14日の実作業時間の推移">
      <line x1="16" y1="126" x2="644" y2="126" className="trend-axis" />
      <polyline points={days.map((d, index) => `${x(index)},${y(d.ms)}`).join(' ')} className="trend-line" />
      {days.map((d, index) => <circle key={d.key} cx={x(index)} cy={y(d.ms)} r="3.5" className="trend-point"><title>{d.key}：{formatDuration(d.ms, 'compact')}</title></circle>)}
      {[0, 6, 13].map((index) => <text key={index} x={x(index)} y="148" textAnchor={index === 0 ? 'start' : index === 13 ? 'end' : 'middle'}>{days[index]!.key.slice(5).replace('-', '/')}</text>)}
      <text x="16" y="14">最大 {formatDuration(max === 1 ? 0 : max, 'compact')}</text>
    </svg>
    <details><summary>日ごとの数値</summary><ol className="trend-values">{days.map((d) => <li key={d.key}><span>{d.key}</span><span className="num">{formatDuration(d.ms, 'compact')}</span></li>)}</ol></details>
  </section>
}

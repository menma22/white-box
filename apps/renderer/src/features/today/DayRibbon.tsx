import { useState } from 'react'
import type { Session } from '@white-box/core/types'
import { useData } from '@/stores/app'
import { projectById, projectColor, taskById, taskTitle } from '@/lib/selectors'
import { formatClock, formatDuration, MINUTE } from '@white-box/core/engine'
import { ribbonRows, type RibbonItem } from '@/lib/day-ribbon'

function dateTime(at: number): string {
  return `${new Date(at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} ${formatClock(at)}`
}

function duration(ms: number): string {
  return ms < MINUTE ? `${Math.floor(ms / 1000)}s` : formatDuration(ms, 'compact')
}

export function DayRibbon({ sessions, now }: { sessions: Session[]; now: number }) {
  const state = useData()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const rows = ribbonRows(sessions, now)
  if (!rows.length) return null
  const selected = rows.flatMap((row) => row.items).find((item) => item.key === selectedKey)
  const project = (item: RibbonItem) => projectById(state, taskById(state, item.taskId)?.projectId ?? null)
  const label = (item: RibbonItem) => item.kind === 'work' ? taskTitle(state, item.taskId!) : item.kind === 'excluded' ? '除外（後から申告）' : '一時停止'
  const summary = (item: RibbonItem) => `${label(item)}｜${dateTime(item.startedAt)}–${dateTime(item.endedAt)}｜${item.kind === 'work' ? '実作業' : '長さ'} ${duration(item.kind === 'work' ? item.focusMs : item.endedAt - item.startedAt)}`

  return (
    <section className="ribbon" aria-label="今日のタイムライン">
      {rows.map((row) => {
        const pct = (at: number) => ((at - row.startedAt) / (row.endedAt - row.startedAt)) * 100
        return (
          <div className="ribbon-row" key={row.startedAt}>
            <div className="ribbon-range num">{dateTime(row.startedAt)} – {dateTime(row.endedAt)}</div>
            <div className="ribbon-rail">
              {row.hours.map((at) => <div key={at} className="ribbon-grid" style={{ left: `${pct(at)}%` }} />)}
              {row.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`ribbon-item ribbon-${item.kind}${item.live ? ' is-live' : ''}${selectedKey === item.key ? ' is-selected' : ''}`}
                  style={{ left: `${pct(item.startedAt)}%`, width: `${pct(item.endedAt) - pct(item.startedAt)}%`, ...(item.kind === 'work' ? { background: projectColor(project(item)) } : {}) }}
                  aria-label={summary(item)}
                  aria-describedby="ribbon-detail"
                  onMouseEnter={() => setSelectedKey(item.key)}
                  onFocus={() => setSelectedKey(item.key)}
                  onClick={() => setSelectedKey(item.key)}
                />
              ))}
              {now >= row.startedAt && now < row.endedAt && <div className="ribbon-now" style={{ left: `${pct(now)}%` }} />}
            </div>
            <div className="ribbon-axis">
              {row.hours.map((at) => <span key={at} className="num ribbon-hour" style={{ left: `${pct(at)}%` }}>{formatClock(at)}</span>)}
            </div>
          </div>
        )
      })}
      <div id="ribbon-detail" className="ribbon-detail" aria-live="polite">
        {selected ? (
          <>
            <div className="ribbon-detail-heading"><strong>{label(selected)}</strong><span>{project(selected)?.name ?? (selected.kind === 'work' ? 'プロジェクトなし' : '')}</span></div>
            <div className="ribbon-detail-meta num">
              <span>{dateTime(selected.startedAt)} – {dateTime(selected.endedAt)}</span>
              <span>{selected.kind === 'work' ? '実作業' : '長さ'} {duration(selected.kind === 'work' ? selected.focusMs : selected.endedAt - selected.startedAt)}</span>
              {selected.live && <span>進行中</span>}
            </div>
          </>
        ) : <p className="ribbon-hint">帯にカーソルを合わせると詳細が見える。Tabキーでも選べる。</p>}
      </div>
    </section>
  )
}

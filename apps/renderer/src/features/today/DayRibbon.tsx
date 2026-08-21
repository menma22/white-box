import type { Session } from '@white-box/core/types'
import { useData } from '@/stores/app'
import { projectById, projectColor, taskById } from '@/lib/selectors'
import { formatClock, formatDuration, HOUR } from '@white-box/core/engine'

/** 1 日を 1 本の帯にする。実作業＝色の付いた区間、一時停止＝抜けた区間。 */
export function DayRibbon({ sessions, now }: { sessions: Session[]; now: number }) {
  const state = useData()
  if (sessions.length === 0) return null

  const first = Math.min(...sessions.map((s) => s.startedAt))
  const last = Math.max(...sessions.map((s) => s.endedAt ?? now))
  const start = Math.floor(first / HOUR) * HOUR
  const end = Math.max(Math.ceil(last / HOUR) * HOUR, start + 4 * HOUR)
  const span = end - start
  const pct = (t: number) => ((t - start) / span) * 100

  const hours: number[] = []
  for (let t = start; t <= end; t += HOUR) hours.push(t)

  return (
    <section className="ribbon">
      <div className="ribbon-rail">
        {hours.map((t) => (
          <div key={t} className="ribbon-grid" style={{ left: `${pct(t)}%` }} />
        ))}

        {sessions.map((session) => {
          const sEnd = session.endedAt ?? now
          return (
            <div
              key={session.id}
              className={`ribbon-band ${session.endedAt ? '' : 'is-live'}`}
              style={{ left: `${pct(session.startedAt)}%`, width: `${Math.max(0.4, pct(sEnd) - pct(session.startedAt))}%` }}
            >
              {session.segments.map((seg) => {
                const task = taskById(state, seg.taskId)
                const project = projectById(state, task?.projectId ?? null)
                const segEnd = Math.min(seg.endedAt ?? sEnd, sEnd)
                const left = ((seg.startedAt - session.startedAt) / (sEnd - session.startedAt)) * 100
                const width = ((segEnd - seg.startedAt) / (sEnd - session.startedAt)) * 100
                return (
                  <div
                    key={seg.id}
                    className="ribbon-seg"
                    style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%`, background: projectColor(project) }}
                    title={`${task?.title ?? '（削除されたタスク）'}｜${formatClock(seg.startedAt)}–${formatClock(segEnd)}`}
                  />
                )
              })}
              {session.pauses.map((p, i) => {
                const pEnd = Math.min(p.endedAt ?? sEnd, sEnd)
                const left = ((p.startedAt - session.startedAt) / (sEnd - session.startedAt)) * 100
                const width = ((pEnd - p.startedAt) / (sEnd - session.startedAt)) * 100
                return (
                  <div
                    key={i}
                    className="ribbon-pause"
                    style={{ left: `${left}%`, width: `${Math.max(0.4, width)}%` }}
                    title={`一時停止 ${formatDuration(pEnd - p.startedAt, 'compact')}`}
                  />
                )
              })}
            </div>
          )
        })}

        <div className="ribbon-now" style={{ left: `${Math.min(100, Math.max(0, pct(now)))}%` }} />
      </div>

      <div className="ribbon-axis">
        {hours.map((t) => (
          <span key={t} className="num ribbon-hour" style={{ left: `${pct(t)}%` }}>
            {new Date(t).getHours()}
          </span>
        ))}
      </div>
    </section>
  )
}

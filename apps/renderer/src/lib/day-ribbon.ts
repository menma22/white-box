import type { Session } from '@white-box/core/types'
import { HOUR, pausedMsWithin } from '@white-box/core/engine'

export interface RibbonItem {
  key: string
  taskId: string | null
  kind: 'work' | 'pause' | 'excluded'
  startedAt: number
  endedAt: number
  focusMs: number
  live: boolean
}

export interface RibbonRow {
  startedAt: number
  endedAt: number
  hours: number[]
  items: RibbonItem[]
}

export function ribbonRows(sessions: Session[], now: number): RibbonRow[] {
  if (!sessions.length) return []
  const first = Math.min(...sessions.map((s) => s.startedAt))
  const last = Math.max(...sessions.map((s) => s.endedAt ?? now))
  const startDate = new Date(first)
  startDate.setMinutes(0, 0, 0)
  const start = startDate.getTime()
  const rowSpan = Math.max(2, Math.ceil((last - start) / (2 * HOUR))) * HOUR
  const rows: RibbonRow[] = [0, 1].map((index) => {
    const startedAt = start + index * rowSpan
    return {
      startedAt, endedAt: startedAt + rowSpan, items: [],
      hours: Array.from({ length: rowSpan / HOUR + 1 }, (_, hour) => startedAt + hour * HOUR),
    }
  })

  for (const session of sessions) {
    const end = session.endedAt ?? now
    const add = (key: string, from: number, to: number, kind: RibbonItem['kind'], taskId: string | null) => {
      for (const row of rows) {
        const startedAt = Math.max(from, session.startedAt, row.startedAt)
        const endedAt = Math.min(to, end, row.endedAt)
        if (endedAt <= startedAt) continue
        row.items.push({
          key: `${session.id}:${key}:${row.startedAt}`, taskId, kind, startedAt, endedAt,
          focusMs: kind === 'work' ? endedAt - startedAt - pausedMsWithin(session.pauses, startedAt, endedAt, now) : 0,
          live: session.endedAt === null && to === end && endedAt === end,
        })
      }
    }
    session.segments.forEach((segment, index) => {
      const from = index === 0 ? session.startedAt : segment.startedAt
      const to = index === session.segments.length - 1 ? end : segment.endedAt ?? end
      add(segment.id, from, to, 'work', segment.taskId)
    })
    session.pauses.forEach((pause, index) => {
      add(`pause-${index}`, pause.startedAt, pause.endedAt ?? end, pause.reason === 'excluded' ? 'excluded' : 'pause', null)
    })
  }
  return rows
}

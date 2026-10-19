import type { Session, TimeRange } from '@white-box/core/types'
import { HOUR } from '@white-box/core/engine'
import { activityTimeline } from '@white-box/core/activity'

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

export function ribbonRows(sessions: Session[], now: number, period?: TimeRange): RibbonRow[] {
  if (!sessions.length) return []
  const first = Math.max(period?.startedAt ?? -Infinity, Math.min(...sessions.map((s) => s.startedAt)))
  const last = Math.min(period?.endedAt ?? Infinity, Math.max(...sessions.map((s) => s.endedAt ?? now)))
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

  for (const item of activityTimeline(sessions, now, period ?? { startedAt: first, endedAt: last })) {
    const session = sessions.find((s) => s.id === item.sessionId)!
    for (const row of rows) {
      const startedAt = Math.max(item.startedAt, row.startedAt)
      const endedAt = Math.min(item.endedAt, row.endedAt)
      if (endedAt <= startedAt) continue
      row.items.push({
        key: `${item.sessionId}:${item.kind}:${item.startedAt}:${row.startedAt}`, taskId: item.taskId, kind: item.kind, startedAt, endedAt,
        focusMs: item.kind === 'work' ? endedAt - startedAt : 0,
        live: session.endedAt === null && item.endedAt === now && endedAt === now,
      })
    }
  }
  return rows
}

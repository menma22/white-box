import type { CSSProperties } from 'react'
import type { TimeRange } from '@white-box/core/types'
import { formatClock } from '@white-box/core/engine'
import { layoutDayEvents } from '../today/calendar-layout'
import { googleCalendarEvent, type GoogleEvent } from './google-calendar'

export function GoogleDayTimeline({ events, period, onEvent }: { events: GoogleEvent[]; period: TimeRange; onEvent: (event: GoogleEvent) => void }) {
  const allDay = events.filter((event) => event.allDay)
  const positions = layoutDayEvents(events.filter((event) => !event.allDay).map(googleCalendarEvent), period, 30)
  const rows = Math.max(1, ...positions.map((item) => item.lanes))
  return <section className="google-day" aria-label="Google カレンダーの今日の予定">
    <header><h2>Google の予定</h2><span>実績に含めない</span></header>
    {allDay.length > 0 && <div className="google-day-all-day"><span>終日</span>{allDay.map((event) => <button key={JSON.stringify([event.calendarId, event.id])} type="button" onClick={() => onEvent(event)}>{event.title}</button>)}</div>}
    {positions.length > 0 ? <div className="google-day-scroll"><div className="google-day-axis">{Array.from({ length: 7 }, (_, index) => <span key={index} style={{ left: index / 6 * 100 + '%' }}>{String((new Date(period.startedAt).getHours() + index * 4) % 24).padStart(2, '0')}:00</span>)}</div>
      <div className="google-day-track" style={{ height: rows * 36, '--google-grid-size': '16.6667%' } as CSSProperties}>{positions.map(({ event, startMinute, endMinute, lane }) => <button type="button" key={event.key} className="google-day-event" style={{ left: startMinute / 1440 * 100 + '%', width: (endMinute - startMinute) / 1440 * 100 + '%', top: lane * 36 }} title={event.title + ' · ' + formatClock(event.startedAt) + '–' + formatClock(event.endedAt)} aria-label={event.title + ' · ' + new Date(event.startedAt).toLocaleString('ja-JP') + '–' + new Date(event.endedAt).toLocaleString('ja-JP')} onClick={() => onEvent(event.googleEvent!)}>{event.title}</button>)}</div>
    </div> : !allDay.length && <p className="calendar-hint">この日の Google 予定はない。</p>}
  </section>
}

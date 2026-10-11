import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { dayRange, shiftDay } from '@white-box/core/activity'
import { formatClock, formatDuration } from '@white-box/core/engine'
import { layoutDayEvents, selectionMinutes, type CalendarEvent } from './calendar-layout'

const KIND = { planned: '予定', actual: '実績', routine: '生活・固定', fixed: '外部固定' }
const CAPTION_HEIGHT = 56
export function WeekCalendar({ start, today, now, events, actualByDay, zoom, onCreate, onEvent }: {
  start: string; today: string; now: number; events: CalendarEvent[]; actualByDay: Map<string, number>; zoom: boolean
  onCreate: (startedAt: number, endedAt: number) => void; onEvent: (event: CalendarEvent) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(648)
  const [viewportWidth, setViewportWidth] = useState(1200)
  const [scrollTop, setScrollTop] = useState(0)
  const [selection, setSelection] = useState<{ day: string; start: number; end: number } | null>(null)
  const anchor = useRef<{ day: string; minute: number; end: number; moved: boolean } | null>(null)
  const height = zoom ? 24 * 56 : Math.max(216, viewport - 70)
  const hourHeight = height / 24
  const hourStep = hourHeight < 24 ? 4 : 2
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(start, index))
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const observer = new ResizeObserver(() => { setViewport(element.clientHeight); setViewportWidth(element.clientWidth) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = zoom ? 6 * 56 : 0 }, [start, zoom])
  function minute(event: PointerEvent<HTMLDivElement>) { return Math.max(0, Math.min(1440, (event.clientY - event.currentTarget.getBoundingClientRect().top) / height * 1440)) }
  function create(day: string, from: number, to: number) {
    const begin = new Date(day + 'T00:00:00'), end = new Date(day + 'T00:00:00')
    begin.setMinutes(from); end.setMinutes(to)
    onCreate(begin.getTime(), end.getTime())
  }
  return <section className="week-calendar" aria-label="1週間の予定と実績">
    <div ref={scroll} className="calendar-scroll" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} aria-label="週の時間軸。上下にスクロールできる">
      <div className="calendar-grid" style={{ '--calendar-hour': hourHeight + 'px' } as CSSProperties}>
        <div className="calendar-axis-header"><span>時刻</span><small>予定 / 実績</small></div>
        {days.map((day) => <div key={day} className={'calendar-day-header' + (day === today ? ' is-today' : '')} data-calendar-day={day}>
          <div className="calendar-day-top"><span>{new Date(day + 'T12:00:00').toLocaleDateString('ja-JP', { weekday: 'short' })}</span><strong className="calendar-date num">{Number(day.slice(-2))}</strong><button type="button" aria-label={day + 'に予定を追加'} title="この日に予定を追加" onClick={() => create(day, 9 * 60, 10 * 60)}>+</button></div>
          <span className="calendar-day-total num">{formatDuration(actualByDay.get(day) ?? 0, 'compact')} <small>実績</small></span>
        </div>)}
        <div className="calendar-axis" style={{ height }}>{Array.from({ length: Math.ceil(24 / hourStep) }, (_, index) => index * hourStep).map((hour) => <span key={hour} style={{ top: hour * hourHeight }} className="num">{String(hour).padStart(2, '0')}:00</span>)}<span className="calendar-midnight num">24:00</span></div>
        {days.map((day) => {
          const period = dayRange(day, 0)
          const positions = layoutDayEvents(events, period, 18 / hourHeight * 60)
          const current = new Date(now)
          const currentMinute = current.getHours() * 60 + current.getMinutes()
          return <div key={day} data-calendar-column={day} className={'calendar-day-column' + (day === today ? ' is-today' : '')} style={{ height }}
            onPointerDown={(event) => {
              if (event.button !== 0 || event.pointerType === 'touch' || (event.target as HTMLElement).closest('button')) return
              event.preventDefault()
              const from = minute(event)
              anchor.current = { day, minute: from, end: from, moved: false }
              const [first, last] = selectionMinutes(from, from + 60)
              setSelection({ day, start: first, end: last })
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!anchor.current || anchor.current.day !== day) return
              const to = minute(event)
              if (Math.abs(to - anchor.current.minute) > 5) anchor.current.moved = true
              anchor.current.end = to
              const [first, last] = selectionMinutes(anchor.current.minute, anchor.current.moved ? to : anchor.current.minute + 60)
              setSelection({ day, start: first, end: last })
            }}
            onPointerUp={(event) => {
              const active = anchor.current
              if (!active || active.day !== day) return
              anchor.current = null; setSelection(null)
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              const [first, last] = selectionMinutes(active.minute, active.moved ? active.end : active.minute + 60)
              create(day, first, last)
            }}
            onPointerCancel={() => { anchor.current = null; setSelection(null) }}>
            {selection?.day === day && <div className="calendar-selection" style={{ top: selection.start / 1440 * height, height: (selection.end - selection.start) / 1440 * height }}><span>+ 予定</span></div>}
            {positions.map(({ event, startMinute, endMinute, lane, lanes }) => {
              const eventHeight = (endMinute - startMinute) / 1440 * height
              const narrow = (Math.max(560, viewportWidth) - 58) / 7 / lanes - 6 < 82
              const captionOffset = Math.min(Math.max(0, scrollTop - startMinute / 1440 * height), Math.max(0, eventHeight - CAPTION_HEIGHT))
              const caption = KIND[event.kind] + (event.recurring ? '・毎週' : '') + ' · ' + event.title + ' · ' + new Date(event.startedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + ' ' + formatClock(event.startedAt) + '–' + new Date(event.endedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) + ' ' + formatClock(event.endedAt) + ' · ' + formatDuration(event.endedAt - event.startedAt, 'compact')
              return <button type="button" key={event.key} data-calendar-event={event.kind} data-calendar-block-id={event.blockId}
                className={'calendar-event is-' + event.kind + (eventHeight < CAPTION_HEIGHT ? ' is-short' : '') + (narrow ? ' is-narrow' : '') + (event.live ? ' is-live' : '')}
                style={{ top: startMinute / 1440 * height, height: eventHeight, left: 'calc(' + lane / lanes * 100 + '% + 3px)', width: 'calc(' + 100 / lanes + '% - 6px)', '--event-color': event.color ?? 'var(--accent)' } as CSSProperties}
                title={caption} aria-label={caption} onClick={() => onEvent(event)}>
                <span className="calendar-event-caption" style={{ transform: captionOffset ? 'translateY(' + captionOffset + 'px)' : undefined }}>
                <span className="calendar-event-title">{event.recurring ? '↻ ' : ''}{event.title}</span>
                {eventHeight >= CAPTION_HEIGHT && !narrow && <span className="calendar-event-time num">{formatClock(event.startedAt)}–{formatClock(event.endedAt)}</span>}
                </span>
              </button>
            })}
            {day === today && <div className="calendar-now" style={{ top: currentMinute / 1440 * height }} aria-label="現在の時刻"><i /></div>}
          </div>
        })}
      </div>
    </div>
  </section>
}

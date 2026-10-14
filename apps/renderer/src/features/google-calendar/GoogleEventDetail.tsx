import { Modal } from '@/components/ui'
import type { GoogleCalendarInfo, GoogleEvent } from './google-calendar'

export function GoogleEventDetail({ event, calendars, onClose }: { event: GoogleEvent | null; calendars: GoogleCalendarInfo[]; onClose: () => void }) {
  const link = event?.htmlLink && /^https:\/\/(calendar\.google\.com|www\.google\.com)\//.test(event.htmlLink) ? event.htmlLink : null
  return <Modal open={Boolean(event)} onClose={onClose} width={540} labelledBy="google-event-title">
    {event && <div className="google-event-detail"><span className="label">Google カレンダーの予定</span><h2 id="google-event-title">{event.title}</h2>
      <p>{calendars.find((calendar) => calendar.id === event.calendarId)?.title ?? event.calendarId}</p>
      <p className="calendar-hint">{event.allDay ? '終日 · ' : ''}{new Date(event.startedAt).toLocaleString('ja-JP', event.allDay ? { year: 'numeric', month: 'long', day: 'numeric' } : undefined)} — {new Date(event.allDay ? event.endedAt - 1 : event.endedAt).toLocaleString('ja-JP', event.allDay ? { year: 'numeric', month: 'long', day: 'numeric' } : undefined)}</p>
      {event.location && <p>{event.location}</p>}<p className="calendar-hint">この予定は実作業の集計に含まれない。</p>
      <div className="modal-actions">{link && <a className="btn btn-ghost btn-md" href={link} target="_blank" rel="noreferrer">Google で開く</a>}<button type="button" className="btn btn-ghost btn-md" onClick={onClose}>閉じる</button></div>
    </div>}
  </Modal>
}

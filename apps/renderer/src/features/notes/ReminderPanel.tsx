import { noteTitle, selectVisibleReminders, type Note } from '@white-box/core/notes'

export function ReminderPanel({ notes, now = Date.now(), onOpen, onDismiss }: {
  notes: Note[]; now?: number; onOpen?: (id: string) => void; onDismiss?: (id: string) => void
}) {
  const visible = selectVisibleReminders(notes, now)
  if (!visible.length) return null
  return <section className="reminder-panel" aria-label="気に留めたいこと">
    <header><h2>気に留めたいこと</h2><span>{visible.length}件</span></header>
    <div className="reminder-cards">{visible.map((note) => {
      const due = note.remindAt !== null && note.remindAt <= now
      return <article key={note.id} className={`reminder-card${due ? ' reminder-card-due' : ''}`}>
        <div className="reminder-card-meta">{note.remindAt !== null ? <time dateTime={new Date(note.remindAt).toISOString()}>{due ? '思い出す時間 · ' : ''}{new Date(note.remindAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time> : <span>気に留めている</span>}</div>
        {onOpen ? <button className="reminder-open" type="button" onClick={() => onOpen(note.id)}>{noteTitle(note)}</button> : <strong>{noteTitle(note)}</strong>}
        {note.body.trim() && <p>{note.body}</p>}
        {note.remindAt !== null && onDismiss && <button className="reminder-dismiss" type="button" onClick={() => onDismiss(note.id)}>確認した</button>}
      </article>
    })}</div>
  </section>
}

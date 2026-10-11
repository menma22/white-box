import { useRef, useState } from 'react'
import { Modal } from '@/components/ui'
import { invoke, isBrowserPreview } from '@/lib/bridge'
import { useDraftParticipant } from '@/lib/useEditorFlush'
import { GoogleCreateRequest, writableCalendars, type GoogleCalendarInfo } from './google-calendar'

function localDate(at: number) { const date = new Date(at); return new Date(at - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) }

export function GoogleEventEditor({ calendars, startedAt, endedAt, onClose }: { calendars: GoogleCalendarInfo[]; startedAt: number; endedAt: number; onClose: () => void }) {
  const writable = writableCalendars(calendars)
  const initial = useRef({ calendarId: writable[0]?.id ?? '', title: '', start: localDate(startedAt), end: localDate(endedAt) })
  const [draft, setDraft] = useState(initial.current)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [discard, setDiscard] = useState(false)
  const request = useRef<GoogleCreateRequest | null>(null)
  if (!request.current) request.current = new GoogleCreateRequest(crypto.randomUUID())
  const running = useRef<Promise<boolean> | null>(null)
  const dirty = attempted || JSON.stringify(draft) !== JSON.stringify(initial.current)
  useDraftParticipant(async () => {
    if (running.current) return running.current
    if (!dirty) return true
    setError('Google の予定が保存されていない。保存するか、編集を閉じてから続けられる。')
    return false
  })
  function close() { if (saving) return; if (dirty) setDiscard(true); else onClose() }
  function save(): Promise<boolean> {
    if (running.current) return running.current
    if (isBrowserPreview) { setError('Google への接続と保存はデスクトップアプリで使える。'); return Promise.resolve(false) }
    const input = { calendarId: draft.calendarId, title: draft.title.trim(), startedAt: new Date(draft.start).getTime(), endedAt: new Date(draft.end).getTime() }
    if (!input.title || !writable.some((calendar) => calendar.id === input.calendarId) || !Number.isFinite(input.startedAt) || !Number.isFinite(input.endedAt) || input.endedAt <= input.startedAt) {
      setError('書き込めるカレンダー、タイトル、開始より後の終了を指定して。'); return Promise.resolve(false)
    }
    setSaving(true); setAttempted(true); setError(''); setDiscard(false)
    running.current = invoke('googleCalendar:create', request.current!.prepare(input)).then(() => { onClose(); return true })
      .catch((cause) => { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false })
      .finally(() => { running.current = null; setSaving(false) })
    return running.current
  }
  return <Modal open onClose={close} width={540} labelledBy="google-editor-title"><div className="calendar-editor">
    <header className="calendar-editor-head"><div><span className="label">Google カレンダー</span><h2 id="google-editor-title">Google に予定をつくる</h2></div><button type="button" className="calendar-close" aria-label="Google の予定の編集を閉じる" disabled={saving} onClick={close}>×</button></header>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label className="calendar-field">保存先<select className="input" required value={draft.calendarId} disabled={saving || attempted} onChange={(event) => setDraft({ ...draft, calendarId: event.target.value })}>{!writable.length && <option value="">書き込めるカレンダーがない</option>}{writable.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.title}</option>)}</select></label>
      <label className="calendar-field">タイトル<input className="input" required maxLength={500} value={draft.title} disabled={saving || attempted} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <div className="calendar-field-pair"><label className="calendar-field">開始<input className="input" type="datetime-local" required value={draft.start} disabled={saving || attempted} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label><label className="calendar-field">終了<input className="input" type="datetime-local" required value={draft.end} disabled={saving || attempted} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label></div>
      <p className="calendar-hint">保存先の Google カレンダーへ送信する。予定は実績に含まれない。繰り返し・終日の登録は Google で行える。</p>
      {isBrowserPreview && <p className="calendar-hint">接続と保存はデスクトップアプリで使える。</p>}
      {error && <p className="task-command-error" role="alert">{error} 入力は残っている。{attempted && '送信が完了した可能性がある。同じ内容で再試行して結果を確認できる。'}</p>}
      {discard && <div className="calendar-confirm" role="alert"><p>{attempted ? '送信した予定が Google に残っている可能性がある。再試行せずに入力を破棄して閉じる？' : '保存前の入力を破棄して閉じる？'}</p><div className="modal-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDiscard(false)}>編集へ戻る</button><button type="button" className="btn btn-danger btn-sm" onClick={onClose}>入力を破棄して閉じる</button></div></div>}
      <footer className="calendar-editor-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={close}>閉じる</button><button type="submit" className="btn btn-primary btn-md" disabled={saving || !writable.length || isBrowserPreview}>{saving ? 'Google に保存中…' : attempted ? '同じ予定を再試行' : 'Google に保存'}</button></footer>
    </form>
  </div></Modal>
}

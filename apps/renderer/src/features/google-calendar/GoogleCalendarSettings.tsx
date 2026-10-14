import { useRef, useState } from 'react'
import { invoke, isBrowserPreview } from '@/lib/bridge'
import { useData } from '@/stores/app'
import { useDraftParticipant } from '@/lib/useEditorFlush'
import { dayKey } from '@white-box/core/engine'
import { weekKey } from '@white-box/core/activity'
import { weekBounds } from '@white-box/core/weekly-budget'
import type { TimeRange } from '@white-box/core/types'

export function GoogleCalendarSettings({ period }: { period?: TimeRange }) {
  const google = useData().googleCalendar
  const [credentials, setCredentials] = useState({ clientId: '', clientSecret: '' })
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [error, setError] = useState('')
  const running = useRef<Promise<boolean> | null>(null)
  useDraftParticipant(async () => {
    if (running.current) await running.current
    if (!credentials.clientId && !credentials.clientSecret) return true
    setError('接続設定の入力が保存されていない。設定を保存するか、入力をクリアしてから続けられる。')
    return false
  })
  function perform(action: () => Promise<unknown>): Promise<boolean> {
    if (running.current) return running.current
    if (isBrowserPreview) { setError('Google カレンダーへの接続はデスクトップアプリで使える。'); return Promise.resolve(false) }
    setSaving(true); setError('')
    running.current = action().then(() => true).catch((cause) => { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false })
      .finally(() => { running.current = null; setSaving(false) })
    return running.current
  }
  const disabled = saving || isBrowserPreview
  return <section className="set-block google-calendar-settings" aria-labelledby="google-settings-title">
    <h2 className="set-title" id="google-settings-title">Google カレンダー</h2>
    <p className="set-note">Google に接続して、選んだカレンダーの予定を今日・週に表示する。予定の追加もできる。実作業の記録とは別に扱う。</p>
    {isBrowserPreview && <p className="calendar-hint">ブラウザは表示確認用。接続・同期・Google への保存はデスクトップアプリで使える。</p>}
    <div className="google-status" role="status"><strong>{google?.connected ? '接続中' : google?.configured ? '接続待ち' : '接続を利用できません'}</strong>{google?.account && <span>{google.account}</span>}{google?.syncing ? <span>同期中…</span> : google?.lastSyncedAt && <span>最終同期 {new Date(google.lastSyncedAt).toLocaleString('ja-JP')}</span>}</div>
    {(error || google?.error) && <p className="task-command-error" role="alert">{error || google?.error}</p>}
    {!google?.connected && <p className="calendar-hint">ブラウザで Google アカウントを選び、カレンダーへのアクセスを許可する。Google のパスワードを White Box に入力する必要はない。</p>}
    {google?.connected ? <>
      <fieldset className="google-calendar-selection" disabled={disabled}><legend>表示するカレンダー</legend>{google.calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={google.selectedCalendarIds.includes(calendar.id)} onChange={(event) => {
        const calendarIds = event.target.checked ? [...google.selectedCalendarIds, calendar.id] : google.selectedCalendarIds.filter((id) => id !== calendar.id)
        void perform(() => invoke('googleCalendar:select', { calendarIds }))
      }} /><span>{calendar.title}{calendar.primary ? '（メイン）' : ''}</span><small>{calendar.accessRole === 'owner' || calendar.accessRole === 'writer' ? '予定を保存できる' : '閲覧のみ'}</small></label>)}{!google.calendars.length && <p className="calendar-hint">カレンダーがない。再同期で取得し直せる。</p>}</fieldset>
      <div className="google-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={disabled || google.syncing} onClick={() => void perform(() => invoke('googleCalendar:sync', period ?? weekBounds(weekKey(dayKey(Date.now(), 0)))))}>再同期</button><button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setConfirmDisconnect(true)}>接続を解除</button></div>
      {confirmDisconnect && <div className="calendar-confirm" role="alert"><p>この端末の Google 接続を解除する？ Google 上の予定は削除しない。</p><div className="google-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setConfirmDisconnect(false)}>戻る</button><button type="button" className="btn btn-danger btn-sm" disabled={disabled} onClick={() => void perform(async () => { await invoke('googleCalendar:disconnect'); setConfirmDisconnect(false) })}>この端末の接続を解除</button></div></div>}
    </> : <div className="google-actions"><button type="button" className="btn btn-primary btn-sm" disabled={disabled || !google?.configured || Boolean(credentials.clientId || credentials.clientSecret)} onClick={() => {
      setConnecting(true)
      void perform(() => invoke('googleCalendar:connect')).finally(() => setConnecting(false))
    }}>{connecting ? '接続中…' : 'Google に接続'}</button>{connecting && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void invoke('googleCalendar:cancelConnect').catch((cause) => setError(String(cause).replace(/^(Error:\s*)+/, '')))}>ログインを中止</button>}</div>}
    {!google?.connected && <details className="google-credentials">
      <summary>詳細設定（自分の OAuth クライアントを使う）</summary><p className="calendar-hint">通常は入力不要。自分で用意したデスクトップ アプリ用の Client ID と Client secret に切り替える場合だけ使う。保存済みの値は画面へ戻さない。</p>
      <form onSubmit={(event) => { event.preventDefault(); void perform(async () => { await invoke('googleCalendar:configure', credentials); setCredentials({ clientId: '', clientSecret: '' }) }) }}>
        <label className="calendar-field">Client ID<input className="input" required autoComplete="off" value={credentials.clientId} disabled={disabled} onChange={(event) => setCredentials({ ...credentials, clientId: event.target.value })} /></label>
        <label className="calendar-field">Client secret<input className="input" type="password" required autoComplete="new-password" value={credentials.clientSecret} disabled={disabled} onChange={(event) => setCredentials({ ...credentials, clientSecret: event.target.value })} /></label>
        <div className="google-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={disabled}>接続設定を保存</button>{(credentials.clientId || credentials.clientSecret) && <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => { setCredentials({ clientId: '', clientSecret: '' }); setError('') }}>入力をクリア</button>}</div>
      </form>
    </details>}
  </section>
}

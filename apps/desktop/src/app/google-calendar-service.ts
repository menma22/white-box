import { createHash } from 'node:crypto'
import type { GoogleCalendarEvent, GoogleCalendarInfo, GoogleCalendarState } from '@white-box/core/types'
import { GoogleCalendarEventSchema, GoogleCalendarProfileSchema, GoogleCalendarTokenSchema as TokenSchema, GoogleCalendarListPageSchema as CalendarPage, GoogleCalendarApiEventSchema as ApiEvent, GoogleCalendarEventPageSchema as EventPage, GoogleCalendarAccountSchema, type GoogleCalendarProfile, GoogleOAuthClientSchema, type GoogleOAuthClient } from '@white-box/contracts'
export { GoogleCalendarProfileSchema, type GoogleCalendarProfile } from '@white-box/contracts'

export interface GoogleCalendarPorts {
  appClient?(): GoogleOAuthClient | null
  fetch: typeof fetch
  secrets: { load(): GoogleCalendarProfile | null; save(profile: GoogleCalendarProfile): void }
  authorize(clientId: string, signal: AbortSignal): Promise<{ code: string; verifier: string; redirectUri: string }>
  publish(state: GoogleCalendarState): void
  now(): number
}
type Range = { startedAt: number; endedAt: number }
type Create = Range & { calendarId: string; title: string; requestId: string }
const BASE = 'https://www.googleapis.com/calendar/v3'

function localDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Google の予定の日付が不正です')
  const [y, m, d] = date.split('-').map(Number)
  const result = new Date(y!, m! - 1, d!)
  if (result.getFullYear() !== y || result.getMonth() !== m! - 1 || result.getDate() !== d) throw new Error('Google の予定の日付が不正です')
  return result.getTime()
}
function eventValue(raw: ReturnType<typeof ApiEvent.parse>, calendarId: string): GoogleCalendarEvent | null {
  if (raw.status === 'cancelled') return null
  if (!raw.start || !raw.end) throw new Error('Google の予定に時刻がありません')
  const allDay = raw.start.date !== undefined
  const startedAt = allDay ? localDate(raw.start.date!) : Date.parse(raw.start.dateTime ?? '')
  const endedAt = allDay ? localDate(raw.end.date ?? '') : Date.parse(raw.end.dateTime ?? '')
  return GoogleCalendarEventSchema.parse({ id: raw.id, calendarId, title: raw.summary ?? '（無題）', startedAt, endedAt, allDay, ...(raw.htmlLink ? { htmlLink: raw.htmlLink } : {}), ...(raw.location ? { location: raw.location } : {}) })
}
function initialState(): GoogleCalendarState {
  return { configured: false, connected: false, account: null, calendars: [], selectedCalendarIds: [], events: [], syncing: false, lastSyncedAt: null, error: null }
}
class HttpFailure extends Error {
  constructor(readonly status: number, category?: string) {
    const messages: Record<string, string> = {
      invalid_client: 'Google のアプリ接続設定が無効です。配布元へ確認してください',
      invalid_grant: 'Google の接続許可が失効しました。接続を解除して Google に接続し直してください',
      access_denied: 'Google のログインが許可されませんでした',
    }
    super(category && messages[category] || (status === 403 ? 'Google カレンダーへのアクセスが許可されません。アカウントとカレンダーの権限を確認してください (HTTP 403)' : `Google Calendar に接続できません (HTTP ${status})`))
  }
}

export class GoogleCalendarService {
  private profile: GoogleCalendarProfile | null = null
  private state = initialState()
  private token: { value: string; expiresAt: number } | null = null
  private refreshing: Promise<string> | null = null
  private generation = 0
  private syncGeneration = 0
  private controllers = new Set<AbortController>()
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private authenticating = false
  private authController: AbortController | null = null
  private range: Range
  constructor(private readonly ports: GoogleCalendarPorts) {
    const start = new Date(ports.now()); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    this.range = { startedAt: start.getTime(), endedAt: end.getTime() }
  }
  start(): void {
    try {
      const profile = this.ports.secrets.load()
      const client = !profile ? this.ports.appClient?.() : null
      this.profile = profile ? GoogleCalendarProfileSchema.parse(profile) : client ? { ...GoogleOAuthClientSchema.parse(client), selectedCalendarIds: null } : null
      this.emit({ ...initialState(), configured: Boolean(this.profile), connected: Boolean(this.profile?.refreshToken), account: this.profile?.account ?? null, selectedCalendarIds: this.profile?.selectedCalendarIds ?? [], error: this.profile ? null : 'この配布版には Google 接続設定がありません。配布元へ確認してください' })
    } catch { this.emit({ ...initialState(), error: 'Google の接続設定を読み込めません。保存済み接続または配布元の設定を確認してください' }) }
    if (!this.timer) this.timer = setInterval(() => this.resume(), 180_000)
    this.resume()
  }
  private emit(patch: Partial<GoogleCalendarState>): void { this.state = { ...this.state, ...patch }; this.ports.publish(structuredClone(this.state)) }
  private invalidate(): void {
    this.generation++; this.syncGeneration++; this.token = null; this.refreshing = null; this.authenticating = false; this.authController = null
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
  stop(): void { this.stopped = true; this.invalidate(); if (this.timer) clearInterval(this.timer); this.timer = null }
  cancelConnect(): void { if (this.authenticating) this.authController?.abort() }
  resume(): void { if (!this.stopped && !this.authenticating && this.state.connected && !this.state.syncing) void this.sync(this.range).catch(() => {}) }
  configure(input: { clientId: string; clientSecret: string }): void {
    const next = GoogleCalendarProfileSchema.parse({ ...input, selectedCalendarIds: null })
    this.ports.secrets.save(next); this.invalidate(); this.profile = next
    this.emit({ ...initialState(), configured: true })
  }
  disconnect(): void {
    const next = this.profile ? { clientId: this.profile.clientId, clientSecret: this.profile.clientSecret, selectedCalendarIds: null } : null
    if (next) this.ports.secrets.save(next)
    this.invalidate(); this.profile = next; this.emit({ ...initialState(), configured: Boolean(next) })
  }
  private controller(): AbortController {
    if (this.stopped) throw new Error('アプリを終了中です')
    const controller = new AbortController(); this.controllers.add(controller); return controller
  }
  private assertCurrent(generation: number): void { if (this.stopped || generation !== this.generation) throw new Error('Google の接続操作を取り消しました') }
  private async response(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const response = await this.ports.fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
    if (!response.ok) {
      let category: string | undefined
      if (url === 'https://oauth2.googleapis.com/token') {
        const reader = response.body?.getReader()
        if (reader) {
          try {
            let body = ''
            while (body.length <= 4096) {
              const { done, value } = await reader.read()
              if (done) { const error: unknown = JSON.parse(body).error; if (typeof error === 'string' && ['invalid_client', 'invalid_grant', 'access_denied'].includes(error)) category = error; break }
              if (Buffer.byteLength(body) + value.byteLength > 4096) break
              body += Buffer.from(value).toString('utf8')
            }
          } catch { /* Provider details are never exposed. */ }
          finally { void reader.cancel().catch(() => {}) }
        }
      }
      throw new HttpFailure(response.status, category)
    }
    return response.json()
  }
  private async exchange(fields: Record<string, string>, signal: AbortSignal) {
    return TokenSchema.parse(await this.response('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) }, signal))
  }
  async connect(): Promise<void> {
    if (!this.profile) throw new Error(this.state.error ?? 'この配布版には Google 接続設定がありません。配布元へ確認してください')
    const profile = this.profile
    const previous = structuredClone(this.state)
    this.invalidate(); const generation = this.generation; const controller = this.controller()
    this.authenticating = true
    this.authController = controller
    this.emit({ syncing: true, error: null })
    try {
      const auth = await this.ports.authorize(profile.clientId, controller.signal)
      this.assertCurrent(generation)
      const token = await this.exchange({ client_id: profile.clientId, client_secret: profile.clientSecret, code: auth.code, code_verifier: auth.verifier, redirect_uri: auth.redirectUri, grant_type: 'authorization_code' }, controller.signal)
      this.assertCurrent(generation)
      if (!token.refresh_token) throw new Error('継続接続の権限がありません。Google で再度許可してください')
      if (token.scope && (!token.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.events') || !token.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.calendarlist.readonly'))) throw new Error('カレンダーの閲覧・作成を両方許可してください')
      const account = GoogleCalendarAccountSchema.parse(await this.response('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }, controller.signal)).email
      this.assertCurrent(generation)
      const next = { ...profile, refreshToken: token.refresh_token, account, selectedCalendarIds: null }
      this.ports.secrets.save(next); this.profile = next; this.token = { value: token.access_token, expiresAt: this.ports.now() + token.expires_in * 1000 }
      this.authenticating = false
      this.emit({ ...initialState(), configured: true, connected: true, account, syncing: false, error: null })
      await this.sync(this.range)
    } catch (cause) {
      if (generation === this.generation && controller.signal.aborted && !this.stopped) { this.emit({ ...previous, syncing: false, error: null }); return }
      if (generation === this.generation && !this.stopped) this.emit({ ...(this.profile === profile ? previous : {}), syncing: false, error: this.error(cause) })
      throw new Error(this.error(cause))
    }
    finally { if (generation === this.generation) this.authenticating = false; if (this.authController === controller) this.authController = null; this.controllers.delete(controller) }
  }
  private error(cause: unknown): string {
    if (cause instanceof HttpFailure) return cause.message
    const safeMessages = ['継続接続の権限がありません。Google で再度許可してください', 'カレンダーの閲覧・作成を両方許可してください', 'Google のログインを取り消しました', 'Google のログインが許可されませんでした', 'Google のログインが時間切れです', 'Google のログイン画面を開けません', 'Google ログインの受信口を開けません', '同じリクエストIDに異なる予定を送信できません', '作成済み予定が削除されています', 'Google の接続設定を安全に保存できません', 'OS の安全な資格情報保存が利用できません']
    if (cause instanceof Error && safeMessages.includes(cause.message)) return cause.message
    return 'Google Calendar の操作に失敗しました。接続・権限・ネットワークを確認してください'
  }
  private async accessToken(signal: AbortSignal, generation: number): Promise<string> {
    this.assertCurrent(generation)
    if (this.token && this.token.expiresAt - this.ports.now() > 60_000) return this.token.value
    if (this.refreshing) return this.refreshing
    const profile = this.profile
    if (!profile?.refreshToken) throw new Error('Google に接続してください')
    const pending = (async () => {
      const token = await this.exchange({ client_id: profile.clientId, client_secret: profile.clientSecret, refresh_token: profile.refreshToken!, grant_type: 'refresh_token' }, signal)
      this.assertCurrent(generation)
      if (token.refresh_token) { const next = { ...this.profile!, refreshToken: token.refresh_token }; this.ports.secrets.save(next); this.profile = next }
      this.token = { value: token.access_token, expiresAt: this.ports.now() + token.expires_in * 1000 }; return token.access_token
    })()
    this.refreshing = pending
    try { return await pending } finally { if (this.refreshing === pending) this.refreshing = null }
  }
  private async read(url: string, signal: AbortSignal, generation: number): Promise<unknown> {
    const token = await this.accessToken(signal, generation)
    try { const result = await this.response(url, { headers: { Authorization: `Bearer ${token}` } }, signal); this.assertCurrent(generation); return result }
    catch (cause) {
      this.assertCurrent(generation)
      if (!(cause instanceof HttpFailure) || cause.status !== 401) throw cause
      this.token = null
      const fresh = await this.accessToken(signal, generation)
      const result = await this.response(url, { headers: { Authorization: `Bearer ${fresh}` } }, signal); this.assertCurrent(generation); return result
    }
  }
  select(calendarIds: string[]): void {
    if (this.authenticating) throw new Error('Google のログイン完了を待ってください')
    if (!this.profile || !this.state.connected) throw new Error('Google に接続してください')
    if (calendarIds.some((id) => !this.state.calendars.some((calendar) => calendar.id === id))) throw new Error('カレンダーがありません')
    const ids = [...new Set(calendarIds)]; const next = { ...this.profile, selectedCalendarIds: ids }
    this.ports.secrets.save(next); this.profile = next; this.syncGeneration++
    this.emit({ selectedCalendarIds: ids, events: this.state.events.filter((event) => ids.includes(event.calendarId)), syncing: false, lastSyncedAt: null, error: null }); this.resume()
  }
  async sync(range: Range): Promise<void> {
    if (!Number.isSafeInteger(range.startedAt) || !Number.isSafeInteger(range.endedAt) || range.endedAt <= range.startedAt || range.endedAt - range.startedAt > 90 * 86400000 || !Number.isFinite(new Date(range.startedAt).getTime()) || !Number.isFinite(new Date(range.endedAt).getTime())) throw new Error('同期期間は90日以内にしてください')
    this.range = range
    if (!this.state.connected || this.authenticating) return
    const generation = this.generation; const syncGeneration = ++this.syncGeneration; const controller = this.controller()
    const current = () => !this.stopped && generation === this.generation && syncGeneration === this.syncGeneration
    this.emit({ syncing: true, error: null })
    try {
      const calendars: GoogleCalendarInfo[] = []; let pageToken: string | undefined; const seen = new Set<string>()
      do {
        const url = new URL(`${BASE}/users/me/calendarList`); url.searchParams.set('maxResults', '250'); if (pageToken) url.searchParams.set('pageToken', pageToken)
        const page = CalendarPage.parse(await this.read(url.href, controller.signal, generation))
        for (const c of page.items) if (!c.deleted) calendars.push({ id: c.id, title: c.summary ?? c.id, accessRole: c.accessRole, primary: c.primary ?? false })
        pageToken = page.nextPageToken; if (pageToken && seen.has(pageToken)) throw new Error('ページが循環しています'); if (pageToken) seen.add(pageToken)
      } while (pageToken)
      if (!current()) return
      const ids = (this.profile?.selectedCalendarIds ?? calendars.filter((c) => c.primary).map((c) => c.id)).filter((id) => calendars.some((c) => c.id === id))
      const events: GoogleCalendarEvent[] = []
      for (const id of ids) {
        pageToken = undefined; seen.clear()
        do {
          const url = new URL(`${BASE}/calendars/${encodeURIComponent(id)}/events`)
          for (const [key, value] of Object.entries({ timeMin: new Date(range.startedAt).toISOString(), timeMax: new Date(range.endedAt).toISOString(), singleEvents: 'true', showDeleted: 'false', maxResults: '2500', orderBy: 'startTime' })) url.searchParams.set(key, value)
          if (pageToken) url.searchParams.set('pageToken', pageToken)
          const page = EventPage.parse(await this.read(url.href, controller.signal, generation))
          if (!current()) return
          for (const raw of page.items) { const event = eventValue(raw, id); if (event) events.push(event) }
          pageToken = page.nextPageToken; if (pageToken && seen.has(pageToken)) throw new Error('ページが循環しています'); if (pageToken) seen.add(pageToken)
        } while (pageToken)
      }
      if (current()) this.emit({ calendars, selectedCalendarIds: ids, events: [...new Map(events.map((event) => [`${event.calendarId}\0${event.id}`, event])).values()].sort((a, b) => a.startedAt - b.startedAt), syncing: false, lastSyncedAt: this.ports.now(), error: null })
    } catch (cause) { if (current()) this.emit({ syncing: false, error: this.error(cause) }); throw new Error(this.error(cause)) }
    finally { this.controllers.delete(controller) }
  }
  async create(input: Create): Promise<GoogleCalendarEvent> {
    if (this.authenticating) throw new Error('Google のログイン完了を待ってください')
    if (!this.state.connected || !this.state.calendars.some((calendar) => calendar.id === input.calendarId && ['owner', 'writer'].includes(calendar.accessRole))) throw new Error('書き込みできるカレンダーを選んでください')
    const generation = this.generation; const controller = this.controller()
    const id = 'b0' + createHash('sha256').update(JSON.stringify([this.state.account, input.calendarId, input.requestId])).digest('hex')
    const fingerprint = createHash('sha256').update(JSON.stringify([input.title, input.startedAt, input.endedAt])).digest('hex')
    try {
      const token = await this.accessToken(controller.signal, generation)
      let raw: ReturnType<typeof ApiEvent.parse>
      try { raw = ApiEvent.parse(await this.response(`${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, summary: input.title, start: { dateTime: new Date(input.startedAt).toISOString() }, end: { dateTime: new Date(input.endedAt).toISOString() }, extendedProperties: { private: { whiteBoxRequest: fingerprint } } }) }, controller.signal)) }
      catch (cause) {
        this.assertCurrent(generation)
        if (!(cause instanceof HttpFailure) || cause.status !== 409) throw cause
        raw = ApiEvent.parse(await this.read(`${BASE}/calendars/${encodeURIComponent(input.calendarId)}/events/${id}`, controller.signal, generation))
        if (raw.extendedProperties?.private?.whiteBoxRequest !== fingerprint) throw new Error('同じリクエストIDに異なる予定を送信できません')
      }
      this.assertCurrent(generation)
      const event = eventValue(raw, input.calendarId); if (!event) throw new Error('作成済み予定が削除されています')
      this.syncGeneration++
      const events = this.state.events.filter((item) => item.id !== event.id || item.calendarId !== event.calendarId)
      if (this.state.selectedCalendarIds.includes(event.calendarId) && event.startedAt < this.range.endedAt && event.endedAt > this.range.startedAt) events.push(event)
      this.emit({ events: events.sort((a, b) => a.startedAt - b.startedAt), syncing: false, error: null }); this.resume(); return event
    } catch (cause) { if (generation === this.generation && !this.stopped) this.emit({ error: this.error(cause) }); throw new Error(this.error(cause)) }
    finally { this.controllers.delete(controller) }
  }
}

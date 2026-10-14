import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleCalendarState } from '@white-box/core/types'
import { GoogleCalendarService, type GoogleCalendarProfile } from '../src/app/google-calendar-service.js'
import type { GoogleOAuthClient } from '@white-box/contracts'
import { authorizeGoogleCalendar } from '../src/infra/google-calendar-oauth.js'

const NOW = new Date(2026, 9, 12, 12).getTime()
const range = { startedAt: NOW - 86400000, endedAt: NOW + 86400000 }
const calendar = { id: 'primary@example.com', summary: 'Personal', accessRole: 'owner', primary: true }
const rawEvent = { id: 'event1', summary: 'Meeting', start: { dateTime: new Date(NOW).toISOString() }, end: { dateTime: new Date(NOW + 3600000).toISOString() } }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const services: GoogleCalendarService[] = []
afterEach(() => { services.forEach((service) => service.stop()); services.length = 0; vi.useRealTimers() })
function fixture(custom?: (url: URL, init?: RequestInit) => Promise<Response> | Response, initial: GoogleCalendarProfile | null = { clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', account: 'primary@example.com', selectedCalendarIds: null }, appClient?: () => GoogleOAuthClient | null) {
  let profile = initial
  let state: GoogleCalendarState | undefined
  const publish = vi.fn((next: GoogleCalendarState) => { state = next })
  const transport = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    if (custom) return custom(url, init)
    if (url.pathname === '/token') return json({ access_token: 'access', expires_in: 3600 })
    if (url.pathname.endsWith('/calendarList')) return json({ items: [calendar] })
    return json({ items: [rawEvent] })
  })
  const save = vi.fn((next: GoogleCalendarProfile) => { profile = structuredClone(next) })
  const authorize = vi.fn(async (_clientId: string, _signal: AbortSignal) => ({ code: 'code', verifier: 'verifier', redirectUri: 'http://127.0.0.1:3210/oauth2callback' }))
  const service = new GoogleCalendarService({ appClient, fetch: transport as typeof fetch, secrets: { load: () => profile, save }, authorize, publish, now: () => NOW })
  services.push(service)
  return { service, transport, save, authorize, publish, state: () => state!, profile: () => profile }
}
async function ready(f: ReturnType<typeof fixture>) { f.service.start(); await vi.waitFor(() => expect(f.state().lastSyncedAt).toBe(NOW)) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

describe('Google Calendar service', () => {
  const appClient = { clientId: 'app-desktop.apps.googleusercontent.com', clientSecret: 'app-secret' }

  it('starts ready for ordinary Google login without persisting an app-only client or making requests', () => {
    const f = fixture(undefined, null, () => appClient)
    f.service.start()
    expect(f.state()).toMatchObject({ configured: true, connected: false, account: null, error: null })
    expect(f.save).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled()
    expect(JSON.stringify(f.state())).not.toMatch(/app-secret|app-desktop/)
  })

  it('uses the app client for successful browser login and stores tokens only after authorization', async () => {
    const f = fixture((url, init) => {
      if (url.pathname === '/token') {
        const fields = new URLSearchParams(String(init?.body))
        expect(fields.get('client_id')).toBe(appClient.clientId); expect(fields.get('client_secret')).toBe(appClient.clientSecret)
        expect(f.save).not.toHaveBeenCalled()
        return json({ access_token: 'access', refresh_token: 'connected-refresh', expires_in: 3600 })
      }
      if (url.pathname.endsWith('/userinfo')) return json({ email: 'new@example.com' })
      if (url.pathname.endsWith('/calendarList')) return json({ items: [calendar] })
      return json({ items: [] })
    }, null, () => appClient)
    f.service.start(); await f.service.connect()
    expect(f.authorize).toHaveBeenCalledWith(appClient.clientId, expect.any(AbortSignal))
    expect(f.save).toHaveBeenCalledTimes(1)
    expect(f.profile()).toMatchObject({ ...appClient, refreshToken: 'connected-refresh', account: 'new@example.com' })
    expect(f.state().connected).toBe(true)
  })

  it('preserves legacy credentials, tokens and selections without reading a broken app config', async () => {
    const loadClient = vi.fn(() => { throw new Error('broken distribution') })
    const profile = { clientId: 'legacy', clientSecret: 'legacy-secret', refreshToken: 'refresh', account: 'primary@example.com', selectedCalendarIds: [calendar.id] }
    const f = fixture(undefined, profile, loadClient); await ready(f)
    expect(loadClient).not.toHaveBeenCalled(); expect(f.profile()).toEqual(profile)
    expect(f.save).not.toHaveBeenCalled(); expect(f.state().selectedCalendarIds).toEqual([calendar.id])
  })

  it('reports absent and invalid app clients honestly without writing user storage', async () => {
    for (const loadClient of [() => null, () => { throw new Error('secret-path-invalid') }, () => ({ ...appClient, clientId: 'dummy' })]) {
      const f = fixture(undefined, null, loadClient); f.service.start()
      expect(f.state().configured).toBe(false); expect(f.state().error).toContain('設定')
      await expect(f.service.connect()).rejects.toThrow('設定')
      expect(f.save).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled()
      expect(f.state().error).not.toContain('secret-path-invalid')
    }
  })

  it.each([
    ['invalid_client', 400, 'アプリ接続設定が無効'],
    ['invalid_grant', 400, '接続許可が失効'],
    ['access_denied', 400, '許可されませんでした'],
    ['unknown-secret-value', 403, 'HTTP 403'],
    ['unknown-secret-value', 400, 'HTTP 400'],
  ])('sanitizes provider category %s without exposing provider details', async (category, status, message) => {
    const f = fixture(() => json({ error: category, error_description: 'secret-provider-url https://evil.test/token' }, status), null, () => appClient)
    f.service.start()
    await expect(f.service.connect()).rejects.toThrow(message)
    expect(f.state().error).not.toMatch(/secret-provider-url|evil\.test|unknown-secret/)
    expect(f.save).not.toHaveBeenCalled(); expect(f.state().connected).toBe(false)
  })

  it('bounds error parsing and never echoes oversized provider responses', async () => {
    const f = fixture(() => json({ error_description: 'secret'.repeat(2000), error: 'invalid_client' }, 400), null, () => appClient)
    f.service.start(); await expect(f.service.connect()).rejects.toThrow('HTTP 400')
    expect(f.state().error).not.toContain('secret'); expect(f.save).not.toHaveBeenCalled()
  })

  it('refreshes saved credentials, pages calendars/events, expands recurrence and maps exclusive all-day dates locally', async () => {
    const f = fixture((url, init) => {
      if (url.pathname === '/token') { expect(String(init?.body)).toContain('refresh_token=refresh'); return json({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 }) }
      if (url.pathname.endsWith('/calendarList')) return url.searchParams.has('pageToken') ? json({ items: [{ id: 'team', summary: 'Team', accessRole: 'reader' }] }) : json({ items: [calendar], nextPageToken: 'cal2' })
      expect(url.searchParams.get('singleEvents')).toBe('true'); expect(url.searchParams.get('showDeleted')).toBe('false')
      expect(init?.headers).toEqual({ Authorization: 'Bearer access' })
      return url.searchParams.has('pageToken') ? json({ items: [{ id: 'day', summary: 'Holiday', start: { date: '2026-10-12' }, end: { date: '2026-10-14' } }, { id: 'gone', status: 'cancelled' }] }) : json({ items: [rawEvent], nextPageToken: 'ev2' })
    })
    await ready(f)
    expect(f.profile()?.refreshToken).toBe('rotated')
    expect(f.state().calendars).toHaveLength(2)
    expect(f.state().selectedCalendarIds).toEqual([calendar.id])
    expect(f.state().events).toHaveLength(2)
    expect(f.state().events.find((e) => e.id === 'day')).toMatchObject({ allDay: true, startedAt: new Date(2026, 9, 12).getTime(), endedAt: new Date(2026, 9, 14).getTime() })
    expect(JSON.stringify(f.state())).not.toMatch(/secret|refresh|access_token/)
  })

  it('keeps the last successful cache and timestamp after an offline read', async () => {
    const f = fixture(); await ready(f)
    const previous = structuredClone(f.state())
    f.transport.mockRejectedValue(new TypeError('network error containing secret'))
    await expect(f.service.sync(range)).rejects.toThrow('Google Calendar')
    expect(f.state().events).toEqual(previous.events); expect(f.state().lastSyncedAt).toBe(previous.lastSyncedAt)
    expect(f.state().syncing).toBe(false); expect(f.state().error).not.toContain('secret')
  })

  it('ignores pending responses after disconnect and removes persisted refresh credentials', async () => {
    const f = fixture(); await ready(f)
    const pending = deferred<Response>()
    f.transport.mockImplementation(async () => pending.promise)
    const sync = f.service.sync(range)
    await vi.waitFor(() => expect(f.state().syncing).toBe(true))
    f.service.disconnect(); const snapshot = f.state()
    pending.resolve(json({ items: [calendar] }))
    await expect(sync).rejects.toThrow()
    expect(f.state()).toEqual(snapshot); expect(f.state().connected).toBe(false); expect(f.state().events).toEqual([])
    expect(f.profile()).not.toHaveProperty('refreshToken'); expect(f.profile()).not.toHaveProperty('account')
  })

  it('does not resurrect deselected calendars from a pending sync', async () => {
    const f = fixture(); await ready(f)
    const pending = deferred<Response>()
    f.transport.mockImplementation(async (input) => String(input).includes('/calendarList') ? json({ items: [calendar] }) : pending.promise)
    const before = f.transport.mock.calls.length
    const old = f.service.sync(range)
    await vi.waitFor(() => expect(f.transport.mock.calls.slice(before).some(([url]) => String(url).includes('timeMin='))).toBe(true))
    f.service.select([])
    pending.resolve(json({ items: [rawEvent] })); await old
    await vi.waitFor(() => expect(f.state().syncing).toBe(false))
    expect(f.state().selectedCalendarIds).toEqual([]); expect(f.state().events).toEqual([]); expect(f.profile()?.selectedCalendarIds).toEqual([])
  })

  it('discards an older range result when a later requested range completes', async () => {
    const f = fixture(); await ready(f)
    const pending = deferred<Response>()
    const oldRange = { startedAt: NOW - 3 * 86400000, endedAt: NOW - 2 * 86400000 }
    f.transport.mockImplementation(async (input) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/calendarList')) return json({ items: [calendar] })
      if (url.searchParams.get('timeMin') === new Date(oldRange.startedAt).toISOString()) return pending.promise
      return json({ items: [{ ...rawEvent, id: 'new-range' }] })
    })
    const old = f.service.sync(oldRange)
    await vi.waitFor(() => expect(f.transport.mock.calls.some(([url]) => String(url).includes(encodeURIComponent(new Date(oldRange.startedAt).toISOString())))).toBe(true))
    await f.service.sync(range); pending.resolve(json({ items: [{ ...rawEvent, id: 'old-range' }] })); await old
    expect(f.state().events.map((e) => e.id)).toEqual(['new-range'])
  })

  it('persists successful login and includes PKCE verifier only in the token exchange', async () => {
    const f = fixture((url, init) => {
      if (url.pathname === '/token') { expect(String(init?.body)).toContain('code_verifier=verifier'); return json({ access_token: 'access', refresh_token: 'new-refresh', expires_in: 3600 }) }
      if (url.pathname.endsWith('/userinfo')) return json({ email: 'new@example.com' })
      if (url.pathname.endsWith('/calendarList')) return json({ items: [calendar] })
      return json({ items: [rawEvent] })
    }, null)
    f.service.start(); f.service.configure({ clientId: 'client', clientSecret: 'secret' }); await f.service.connect()
    expect(f.state().connected).toBe(true); expect(f.state().account).toBe('new@example.com'); expect(f.profile()?.refreshToken).toBe('new-refresh')
    expect(f.authorize).toHaveBeenCalledWith('client', expect.any(AbortSignal))
    expect(JSON.stringify(f.state())).not.toContain('new-refresh')
  })

  it('preserves prior account/cache when reauthentication fails', async () => {
    const f = fixture(); await ready(f)
    const previous = structuredClone(f.state())
    f.authorize.mockRejectedValue(new Error('provider sent secret'))
    await expect(f.service.connect()).rejects.toThrow('Google Calendar')
    expect(f.state().connected).toBe(true); expect(f.state().account).toBe(previous.account); expect(f.state().events).toEqual(previous.events)
    expect(f.profile()?.refreshToken).toBe('refresh'); expect(f.state().error).not.toContain('secret')
  })

  it('refuses partial calendar grants before storing credentials', async () => {
    const f = fixture((url) => url.pathname === '/token' ? json({ access_token: 'access', refresh_token: 'new-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly' }) : json({}), null)
    f.service.start(); f.service.configure({ clientId: 'client', clientSecret: 'secret' })
    await expect(f.service.connect()).rejects.toThrow('両方許可')
    expect(f.profile()).not.toHaveProperty('refreshToken'); expect(f.state().connected).toBe(false)
  })

  it('blocks old-account reads and writes while browser reauthentication is pending', async () => {
    const f = fixture(); await ready(f)
    const auth = deferred<{ code: string; verifier: string; redirectUri: string }>()
    f.authorize.mockImplementation(() => auth.promise)
    const pending = f.service.connect(); const calls = f.transport.mock.calls.length
    await f.service.sync(range)
    await expect(f.service.create({ ...range, calendarId: calendar.id, title: 'Blocked', requestId: 'request' })).rejects.toThrow('ログイン完了')
    expect(() => f.service.select([])).toThrow('ログイン完了')
    expect(f.transport.mock.calls.length).toBe(calls)
    f.service.disconnect(); auth.resolve({ code: 'late', verifier: 'verifier', redirectUri: 'http://127.0.0.1:3210/oauth2callback' })
    await expect(pending).rejects.toThrow()
    expect(f.state().connected).toBe(false); expect(f.profile()).not.toHaveProperty('refreshToken')
    expect(f.transport.mock.calls.length).toBe(calls)
  })

  it('cancels pending browser login immediately while preserving the prior account and cache', async () => {
    const f = fixture(); await ready(f)
    const previous = structuredClone(f.state()); const profile = structuredClone(f.profile())
    let callback = ''
    f.authorize.mockImplementation((clientId, signal) => authorizeGoogleCalendar(clientId, signal, async (url) => { callback = new URL(url).searchParams.get('redirect_uri')! }))
    const pending = f.service.connect()
    expect(f.state().syncing).toBe(true)
    await vi.waitFor(() => expect(callback).not.toBe(''))
    f.service.cancelConnect()
    await expect(pending).resolves.toBeUndefined()
    await expect(fetch(callback)).rejects.toThrow()
    expect(f.state().connected).toBe(previous.connected); expect(f.state().account).toBe(previous.account)
    expect(f.state().events).toEqual(previous.events); expect(f.state().syncing).toBe(false)
    expect(f.state().error).toBeNull()
    expect(f.profile()).toEqual(profile)
    await f.service.sync(range)
    expect(f.state().lastSyncedAt).toBe(NOW); expect(f.state().error).toBeNull()
  })

  it('refreshes exactly once after a 401 read without retrying writes', async () => {
    let tokens = 0; let reads = 0
    const f = fixture((url) => {
      if (url.pathname === '/token') { tokens++; return json({ access_token: 'access-' + tokens, expires_in: 3600 }) }
      if (url.pathname.endsWith('/calendarList')) { reads++; return reads === 1 ? json({}, 401) : json({ items: [calendar] }) }
      return json({ items: [] })
    })
    await ready(f)
    expect(tokens).toBe(2); expect(reads).toBe(2)
    const f2 = fixture(); await ready(f2)
    f2.transport.mockResolvedValue(json({}, 401))
    const before = f2.transport.mock.calls.length
    await expect(f2.service.create({ ...range, calendarId: calendar.id, title: 'No retry', requestId: 'request' })).rejects.toThrow('HTTP 401')
    expect(f2.transport.mock.calls.length - before).toBe(1)
  })

  it('uses one stable base32hex id across ambiguous write retries, resolves 409, and refuses changed payload', async () => {
    let remote: Record<string, unknown> | null = null; let writes = 0
    const f = fixture((url, init) => {
      if (url.pathname === '/token') return json({ access_token: 'access', expires_in: 3600 })
      if (url.pathname.endsWith('/calendarList')) return json({ items: [calendar] })
      if (init?.method === 'POST') {
        writes++; const payload = JSON.parse(String(init.body)) as Record<string, unknown>
        expect(payload.id).toMatch(/^[a-v0-9]{5,1024}$/)
        if (!remote) { remote = payload; throw new TypeError('Response lost after server accepted event') }
        expect(payload.id).toBe(remote.id); return json({}, 409)
      }
      if (url.pathname.endsWith('/events')) return json({ items: remote ? [remote] : [] })
      return json(remote)
    })
    await ready(f)
    const input = { ...range, calendarId: calendar.id, title: 'Created', requestId: 'stable-request' }
    await expect(f.service.create(input)).rejects.toThrow(); expect(writes).toBe(1)
    const event = await f.service.create(input); expect(writes).toBe(2); expect(event.title).toBe('Created')
    await expect(f.service.create({ ...input, title: 'Changed' })).rejects.toThrow('異なる予定')
    expect(writes).toBe(3)
  })

  it('refuses read-only writes and ranges exceeding ninety days', async () => {
    const f = fixture((url) => url.pathname === '/token' ? json({ access_token: 'access', expires_in: 3600 }) : url.pathname.endsWith('/calendarList') ? json({ items: [{ ...calendar, accessRole: 'reader' }] }) : json({ items: [] }))
    await ready(f)
    await expect(f.service.create({ ...range, calendarId: calendar.id, title: 'No', requestId: 'request' })).rejects.toThrow('書き込み')
    await expect(f.service.sync({ startedAt: NOW, endedAt: NOW + 91 * 86400000 })).rejects.toThrow('90日')
    expect(f.transport.mock.calls.some(([, init]) => init?.method === 'POST' && String(init.body).includes('summary'))).toBe(false)
  })

  it('refreshes automatically without a window and stops the resident timer on shutdown', async () => {
    const f = fixture(); await ready(f); vi.useFakeTimers()
    f.service.stop()
    const g = fixture(); g.service.start(); await vi.advanceTimersByTimeAsync(0)
    expect(g.state().lastSyncedAt).toBe(NOW)
    const before = g.transport.mock.calls.length
    await vi.advanceTimersByTimeAsync(180_000); expect(g.transport.mock.calls.length).toBeGreaterThan(before)
    g.service.stop(); const after = g.transport.mock.calls.length
    await vi.advanceTimersByTimeAsync(360_000); expect(g.transport.mock.calls.length).toBe(after)
  })
})

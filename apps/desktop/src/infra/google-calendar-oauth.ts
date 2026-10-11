import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export async function authorizeGoogleCalendar(clientId: string, signal: AbortSignal, openExternal: (url: string) => Promise<unknown>, timeoutMs = 180_000): Promise<{ code: string; verifier: string; redirectUri: string }> {
  signal.throwIfAborted()
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return new Promise((resolve, reject) => {
    let settled = false
    let redirectUri = ''
    const finish = (error?: Error, code?: string) => {
      if (settled) return
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort)
      server.close(); server.closeAllConnections()
      if (error) reject(error)
      else resolve({ code: code!, verifier, redirectUri })
    }
    const abort = () => finish(new Error('Google のログインを取り消しました'))
    const server = createServer((request, response) => {
      let url: URL
      try { url = new URL(request.url ?? '/', 'http://127.0.0.1') }
      catch {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Invalid OAuth callback'); return
      }
      const candidate = url.searchParams.get('state') ?? ''
      const validState = Buffer.byteLength(candidate) === Buffer.byteLength(state) && timingSafeEqual(Buffer.from(candidate), Buffer.from(state))
      if (request.method !== 'GET' || url.pathname !== '/oauth2callback' || !validState) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Invalid OAuth callback'); return
      }
      const code = url.searchParams.get('code')
      const failed = Boolean(url.searchParams.get('error')) || !code
      response.writeHead(failed ? 400 : 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(failed ? 'Google sign-in was not completed. Return to White Box.' : 'Connected. You can close this window and return to White Box.', () => finish(failed ? new Error('Google のログインが許可されませんでした') : undefined, code ?? undefined))
    })
    server.on('error', () => finish(new Error('Google ログインの受信口を開けません')))
    const timeout = setTimeout(() => finish(new Error('Google のログインが時間切れです')), timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    server.listen(0, '127.0.0.1', () => {
      if (settled) { server.close(); return }
      const address = server.address()
      if (!address || typeof address === 'string') { finish(new Error('Google ログインの受信口を開けません')); return }
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email', code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent select_account' })) url.searchParams.set(key, value)
      void openExternal(url.href).catch(() => finish(new Error('Google のログイン画面を開けません')))
    })
  })
}

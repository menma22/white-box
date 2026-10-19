import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { describe, expect, it } from 'vitest'
import { authorizeGoogleCalendar } from '../src/infra/google-calendar-oauth.js'

describe('Google desktop browser OAuth', () => {
  it('uses real loopback callback, validates state, and binds S256 verifier', async () => {
    let challenge = ''; let callback = ''
    const auth = await authorizeGoogleCalendar('desktop-client', new AbortController().signal, async (url) => {
      const params = new URL(url).searchParams
      expect(new URL(url).hostname).toBe('accounts.google.com'); expect(params.get('code_challenge_method')).toBe('S256')
      expect(params.get('scope')).toContain('calendar.events'); expect(params.get('access_type')).toBe('offline')
      callback = params.get('redirect_uri')!; challenge = params.get('code_challenge')!
      expect(new URL(callback).hostname).toBe('127.0.0.1')
      const malformedStatus = await new Promise<number | undefined>((resolve, reject) => {
        const malformed = request({ hostname: '127.0.0.1', port: new URL(callback).port, path: 'http://[' }, (response) => { response.resume(); resolve(response.statusCode) })
        malformed.on('error', reject); malformed.end()
      })
      expect(malformedStatus).toBe(400)
      const invalid = await fetch(callback + '?state=wrong&code=intruder')
      expect(invalid.status).toBe(400)
      const valid = await fetch(callback + '?state=' + encodeURIComponent(params.get('state')!) + '&code=real-code')
      expect(valid.status).toBe(200); expect(await valid.text()).not.toContain('real-code')
    })
    expect(auth.code).toBe('real-code'); expect(auth.verifier).toHaveLength(43)
    expect(createHash('sha256').update(auth.verifier).digest('base64url')).toBe(challenge)
    expect(auth.redirectUri).toBe(callback)
    await expect(fetch(callback)).rejects.toThrow()
  })

  it('closes the listener when login is canceled by shutdown', async () => {
    const controller = new AbortController(); let callback = ''
    const auth = authorizeGoogleCalendar('desktop-client', controller.signal, async (url) => { callback = new URL(url).searchParams.get('redirect_uri')!; controller.abort() })
    await expect(auth).rejects.toThrow('取り消し')
    await expect(fetch(callback)).rejects.toThrow()
  })

  it('bounds waiting for browser consent and refuses authorization denial', async () => {
    await expect(authorizeGoogleCalendar('desktop-client', new AbortController().signal, async () => {}, 20)).rejects.toThrow('時間切れ')
    await expect(authorizeGoogleCalendar('desktop-client', new AbortController().signal, async (url) => {
      const params = new URL(url).searchParams
      await fetch(params.get('redirect_uri')! + '?state=' + params.get('state') + '&error=access_denied')
    })).rejects.toThrow('許可されません')
  })
})

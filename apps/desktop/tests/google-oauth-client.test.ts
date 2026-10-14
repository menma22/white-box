import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appGoogleOAuthClient, readGoogleOAuthClient, writeGoogleOAuthClient } from '../src/infra/google-oauth-client.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); dirs.length = 0 })
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-google-client-')); dirs.push(root)
  const assets = path.join(root, 'assets'); fs.mkdirSync(assets)
  return { root, assets, file: path.join(assets, 'google-oauth-client.json') }
}
const client = { clientId: 'test-desktop.apps.googleusercontent.com', clientSecret: 'test-client-secret' }

describe('application Google OAuth client', () => {
  it('loads packaged assets and ignores developer overrides in a packaged app', () => {
    const f = fixture(); fs.writeFileSync(f.file, JSON.stringify(client))
    expect(appGoogleOAuthClient(f.root, true, 'missing-private-developer-file')).toEqual(client)
    expect(appGoogleOAuthClient(f.root, false)).toEqual(client)
    expect(appGoogleOAuthClient(f.root, true)).not.toHaveProperty('refreshToken')
  })
  it('uses only an explicitly supplied developer file in source mode', () => {
    const f = fixture(); const override = path.join(f.root, 'private-client.json')
    const own = { ...client, clientId: 'developer.apps.googleusercontent.com' }
    fs.writeFileSync(f.file, JSON.stringify(client)); fs.writeFileSync(override, JSON.stringify(own))
    expect(appGoogleOAuthClient(f.root, false, override)).toEqual(own)
    expect(() => appGoogleOAuthClient(f.root, false, override + '.missing')).toThrow('配布元')
  })
  it('distinguishes optional absence from invalid, oversized or token-bearing configs without exposing values', () => {
    const f = fixture(); expect(readGoogleOAuthClient(f.file)).toBeNull()
    expect(() => readGoogleOAuthClient(f.file, true)).toThrow('配布元')
    for (const bad of ['bad-secret-json', JSON.stringify({ ...client, refreshToken: 'private-refresh' }), JSON.stringify({ ...client, accessToken: 'private-access' }), JSON.stringify({ ...client, clientId: 'placeholder' }), JSON.stringify({ ...client, clientSecret: '' }), ' '.repeat(4097)]) {
      fs.writeFileSync(f.file, bad)
      try { readGoogleOAuthClient(f.file); throw new Error('Accepted invalid client') }
      catch (cause) { expect(String(cause)).toContain('配布元'); expect(String(cause)).not.toMatch(/private-refresh|private-access|bad-secret-json/) }
    }
  })
  it('packages only validated client fields and preserves other assets', () => {
    const f = fixture(); const icon = path.join(f.assets, 'icon.ico'); fs.writeFileSync(icon, 'icon bytes')
    writeGoogleOAuthClient(f.file, client)
    expect(JSON.parse(fs.readFileSync(f.file, 'utf8'))).toEqual(client)
    expect(fs.readFileSync(icon, 'utf8')).toBe('icon bytes')
    expect(() => writeGoogleOAuthClient(f.file, { ...client, refreshToken: 'private-refresh' } as typeof client)).toThrow()
    expect(readGoogleOAuthClient(f.file)).toEqual(client)
  })
})

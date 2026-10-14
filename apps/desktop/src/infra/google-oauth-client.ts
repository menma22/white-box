import fs from 'node:fs'
import path from 'node:path'
import { GoogleOAuthClientSchema, type GoogleOAuthClient } from '@white-box/contracts'

export function readGoogleOAuthClient(file: string, required = false): GoogleOAuthClient | null {
  try {
    if (fs.statSync(file).size > 4096) throw new Error('Invalid client configuration')
    return GoogleOAuthClientSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (cause) {
    if (!required && (cause as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('アプリの Google 接続設定を読み込めません。配布元へ確認してください')
  }
}

export function writeGoogleOAuthClient(file: string, client: GoogleOAuthClient): void {
  fs.writeFileSync(file, JSON.stringify(GoogleOAuthClientSchema.parse(client)), { encoding: 'utf8', mode: 0o600 })
}

export function appGoogleOAuthClient(appRoot: string, packaged: boolean, developerFile?: string): GoogleOAuthClient | null {
  return readGoogleOAuthClient(!packaged && developerFile ? developerFile : path.join(appRoot, 'assets', 'google-oauth-client.json'), !packaged && Boolean(developerFile))
}

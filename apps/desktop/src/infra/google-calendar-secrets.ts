import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { GoogleCalendarProfileSchema, type GoogleCalendarProfile } from '../app/google-calendar-service.js'

export function googleCalendarSecrets(file: string) {
  const available = () => {
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('OS の安全な資格情報保存が利用できません')
  }
  return {
    load(): GoogleCalendarProfile | null {
      let encrypted: Buffer
      try { encrypted = fs.readFileSync(file) }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Google の接続設定を読み込めません') }
      available()
      return GoogleCalendarProfileSchema.parse(JSON.parse(safeStorage.decryptString(encrypted)))
    },
    save(profile: GoogleCalendarProfile): void {
      available()
      const encrypted = safeStorage.encryptString(JSON.stringify(GoogleCalendarProfileSchema.parse(profile)))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      let descriptor: number | undefined
      try {
        descriptor = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(descriptor, encrypted); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined
        fs.renameSync(temp, file)
      } catch {
        if (descriptor !== undefined) fs.closeSync(descriptor)
        throw new Error('Google の接続設定を安全に保存できません')
      } finally { try { fs.unlinkSync(temp) } catch { /* Rename consumes the temporary file. */ } }
    },
  }
}

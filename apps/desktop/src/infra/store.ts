/**
 * ローカル保存。JSON 1 ファイル + 日次バックアップ。
 *
 * 書き込みは一時ファイル経由の置き換えのみ（途中で落ちても本体が壊れない）。
 * 直接 fs.writeFile で data.json を上書きしないこと。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Database, Settings } from '@white-box/core/types'

const DB_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  defaultSessionMinutes: 50,
  defaultExtendMinutes: 15,
  extendOptions: [5, 10, 15, 25, 50],
  // 既定値を埋めると他アプリのショートカットと衝突する。初回オンボーディングで本人に割り当ててもらう
  shortcuts: {
    startPause: '',
    currentWork: '',
    dashboard: '',
  },
  launchAtLogin: false,
  autoPauseOnSuspend: true,
  soundOnExpire: true,
  dayStartHour: 4,
  lastWelcomeDate: null,
  stallWarningDays: 3,
  showSessionCard: true,
  onboardedAt: null,
}

function emptyDb(): Database {
  return { version: DB_VERSION, projects: [], tasks: [], sessions: [], settings: { ...DEFAULT_SETTINGS }, dayNotes: {} }
}

/** 人が既に使っている DB か。初回オンボーディングを出してよいかの判定に使う。 */
function hasBeenUsed(db: Database): boolean {
  // data.json の有無では判定しない——入れて即終了しただけの新規ユーザーにも既定値のファイルが書かれる
  return (
    db.sessions.length > 0 ||
    db.tasks.length > 0 ||
    db.projects.length > 0 ||
    Object.keys(db.dayNotes).length > 0 ||
    Object.values(db.settings.shortcuts).some((accel) => accel !== '') ||
    db.settings.displayName !== ''
  )
}

export class Store {
  readonly dir: string
  readonly dbPath: string
  readonly runtimePath: string
  private db: Database

  constructor(dir?: string) {
    this.dir = dir ?? process.env['WHITEBOX_DATA_DIR'] ?? path.join(app.getPath('userData'), 'data')
    this.dbPath = path.join(this.dir, 'data.json')
    this.runtimePath = path.join(this.dir, 'runtime.json')
    fs.mkdirSync(path.join(this.dir, 'backups'), { recursive: true })
    this.db = this.load()
  }

  private load(): Database {
    if (!fs.existsSync(this.dbPath)) return emptyDb()
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<Database>
      const db: Database = {
        version: parsed.version ?? DB_VERSION,
        projects: parsed.projects ?? [],
        tasks: parsed.tasks ?? [],
        sessions: parsed.sessions ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        dayNotes: parsed.dayNotes ?? {},
      }
      if (db.settings.onboardedAt === null && hasBeenUsed(db)) db.settings.onboardedAt = Date.now()
      return db
    } catch (err) {
      const broken = path.join(this.dir, `data.corrupt-${Date.now()}.json`)
      fs.copyFileSync(this.dbPath, broken)
      console.error('[white-box] data.json を読めなかったので退避しました:', broken, err)
      return emptyDb()
    }
  }

  get data(): Database {
    return this.db
  }

  save(): void {
    const tmp = `${this.dbPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf-8')
    fs.renameSync(tmp, this.dbPath)
    this.backupOncePerDay()
  }

  private backupOncePerDay(): void {
    const stamp = new Date().toISOString().slice(0, 10)
    const target = path.join(this.dir, 'backups', `data-${stamp}.json`)
    if (fs.existsSync(target)) return
    try {
      fs.copyFileSync(this.dbPath, target)
      this.pruneBackups()
    } catch (err) {
      console.error('[white-box] バックアップに失敗:', err)
    }
  }

  private pruneBackups(): void {
    const dir = path.join(this.dir, 'backups')
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('data-')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - 30))) {
      fs.rmSync(path.join(dir, f), { force: true })
    }
  }

  /** 実行中セッションの復旧用。PC が落ちた時刻の近似値としてだけ使う。 */
  markAlive(): void {
    try {
      fs.writeFileSync(this.runtimePath, JSON.stringify({ lastTickAt: Date.now() }), 'utf-8')
    } catch {
      /* 実行中の記録が 1 回書けなくても致命ではない */
    }
  }

  readLastAlive(): number | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.runtimePath, 'utf-8')) as { lastTickAt?: number }
      return raw.lastTickAt ?? null
    } catch {
      return null
    }
  }

  replace(next: Database): void {
    this.db = next
    this.save()
  }
}

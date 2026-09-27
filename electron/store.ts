/**
 * ローカル保存。JSON 1 ファイル + 日次バックアップ。
 *
 * 書き込みは一時ファイル経由の置き換えのみ（途中で落ちても本体が壊れない）。
 * 直接 fs.writeFile で data.json を上書きしないこと。
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Database, Settings } from '../shared/types.js'
import { emptyGoalMap, parseGoalMap, validGoalDue } from '../shared/goal-map.js'

const DB_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  defaultSessionMinutes: 50,
  defaultExtendMinutes: 15,
  extendOptions: [5, 10, 15, 25, 50],
  shortcuts: {
    startPause: 'Control+Alt+S',
    currentWork: 'Control+Alt+W',
    dashboard: 'Control+Alt+D',
  },
  launchAtLogin: false,
  autoPauseOnSuspend: true,
  soundOnExpire: true,
  dayStartHour: 4,
  lastWelcomeDate: null,
  stallWarningDays: 3,
}

function emptyDb(): Database {
  return normalizeDatabase({})
}

export function normalizeDatabase(parsed: Partial<Database>): Database {
  const goalMap = parsed.goalMap === undefined ? emptyGoalMap() : parseGoalMap(parsed.goalMap)
  const tasks = parsed.tasks ?? []
  for (const task of tasks) {
    validGoalDue(task.due)
    if (task.goalNodeId != null && !Object.hasOwn(goalMap.nodes, task.goalNodeId)) throw new Error('タスクが存在しない目標を参照しています')
  }
  if (parsed.goalMapImports !== undefined && (!Array.isArray(parsed.goalMapImports) || parsed.goalMapImports.some((item) => typeof item !== 'string'))) throw new Error('道標の取込履歴が不正です')
  return {
    version: parsed.version ?? DB_VERSION,
    projects: parsed.projects ?? [], tasks, sessions: parsed.sessions ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    dayNotes: parsed.dayNotes ?? {}, goalMap,
    goalMapImports: parsed.goalMapImports ?? [],
  }
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
      return normalizeDatabase(parsed)
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
    const normalized = normalizeDatabase(next)
    fs.writeFileSync(path.join(this.dir, 'backups', `before-import-${Date.now()}.json`), JSON.stringify(this.db, null, 2), 'utf-8')
    this.db = normalized
    this.save()
  }
}

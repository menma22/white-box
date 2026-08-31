/**
 * ユースケーステスト用の偽 Port。Electron を一切使わず Ctx を満たす。
 * 起きたこと（開いた窓・開始/停止・保存）は calls に記録され、テストが検証できる。
 */
import type { Database, Task } from '@white-box/core/types'
import type { Ctx } from '../src/app/ports.js'
import { newRuntime } from '../src/app/state.js'

export function emptyDb(): Database {
  return {
    version: 1,
    projects: [],
    tasks: [],
    sessions: [],
    settings: {
      displayName: '',
      defaultSessionMinutes: 50,
      defaultExtendMinutes: 15,
      extendOptions: [5, 10, 15],
      shortcuts: { startPause: '', currentWork: '', dashboard: '' },
      launchAtLogin: false,
      autoPauseOnSuspend: true,
      soundOnExpire: true,
      dayStartHour: 4,
      lastWelcomeDate: null,
      stallWarningDays: 3,
      showSessionCard: true,
      onboardedAt: null,
    },
    dayNotes: {},
  }
}

export function task(over: Partial<Task> & { id: string }): Task {
  return {
    projectId: null,
    parentId: null,
    title: over.id,
    notes: '',
    status: 'todo',
    progress: 0,
    priority: 'normal',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    doneAt: null,
    createdInSessionId: null,
    ...over,
  }
}

export interface FakeCtx extends Ctx {
  calls: string[]
  /** テストが時間を進めるための操作。 */
  advance(ms: number): void
  setLastAlive(ts: number | null): void
}

export function fakeCtx(initial: Database = emptyDb()): FakeCtx {
  let db = initial
  let now = 1_000_000_000
  let lastAlive: number | null = null
  const calls: string[] = []

  const ctx: FakeCtx = {
    calls,
    advance: (ms) => {
      now += ms
    },
    setLastAlive: (ts) => {
      lastAlive = ts
    },
    store: {
      get data() {
        return db
      },
      save: () => calls.push('save'),
      replace: (next) => {
        db = next
        calls.push('replace')
      },
      markAlive: () => calls.push('markAlive'),
      readLastAlive: () => lastAlive,
    },
    windows: {
      open: (kind) => calls.push(`open:${kind}`),
      close: (kind) => calls.push(`close:${kind}`),
      toggle: (kind) => calls.push(`toggle:${kind}`),
      minimizeFocused: () => calls.push('minimize'),
      closeLater: (...kinds) => calls.push(`closeLater:${kinds.join(',')}`),
    },
    ticker: {
      start: () => calls.push('ticker:start'),
      stop: () => calls.push('ticker:stop'),
    },
    system: {
      applyShortcuts: () => calls.push('applyShortcuts'),
      applyLoginItem: () => calls.push('applyLoginItem'),
      quit: () => calls.push('quit'),
    },
    dataIO: {
      exportData: async () => {
        calls.push('export')
        return 'C:\\fake\\export.json'
      },
      importData: async () => {
        calls.push('import')
        return 'C:\\fake\\import.json'
      },
      revealDataDir: () => calls.push('reveal'),
    },
    runtime: newRuntime(),
    now: () => now,
    publish: () => calls.push('publish'),
  }
  return ctx
}

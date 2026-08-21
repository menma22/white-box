/**
 * メインプロセス。セッションの真実はここが持ち、レンダラは表示と入力だけを担う。
 *
 * タイマーをレンダラに持たせないこと（ウィンドウを閉じても計測は続く必要がある）。
 */
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Store } from './store.js'
import { APP_ROOT, broadcast, closeWindow, getWindow, openWindow, toggleWindow } from './windows.js'
import * as mut from './mutations.js'
import { isCommand, parseArgs, type ArgsOf, type CommandName, type ResultOf } from '@white-box/contracts'
import type { AppState, Database, ID, LiveTick, Session, WindowKind } from '@white-box/core/types'
import { activeTaskId, dayKey, focusMs, formatDuration, isPaused, MINUTE, remainingMs } from '@white-box/core/engine'
import * as ops from '../shared/session-ops.js'

const ALIVE_WRITE_INTERVAL_MS = 15_000
/** これより長く記録が途切れていたら、PC が落ちていたとみなす。 */
const CRASH_GAP_MS = 90_000

let store: Store
let tray: Tray | null = null
let ticker: NodeJS.Timeout | null = null
let lastAliveWrite = 0
let pendingReview: { sessionId: ID; thenStart: boolean } | null = null
let recovery: { sessionId: ID; lastKnownAt: number } | null = null
let quitting = false

// ── セッション取得 ────────────────────────────────────────────────

function db(): Database {
  return store.data
}

function liveSession(): Session | null {
  return db().sessions.find((s) => s.state !== 'ended') ?? null
}

function replaceSession(next: Session): void {
  const list = db().sessions
  const i = list.findIndex((s) => s.id === next.id)
  if (i >= 0) list[i] = next
  else list.push(next)
}

function taskTitle(id: ID): string {
  return db().tasks.find((t) => t.id === id)?.title ?? '（削除されたタスク）'
}

// ── 状態の配信 ────────────────────────────────────────────────────

let revision = 0

function buildState(): AppState {
  return {
    revision: ++revision,
    projects: db().projects,
    tasks: db().tasks,
    sessions: db().sessions,
    settings: db().settings,
    dayNotes: db().dayNotes,
    live: buildTick(),
    recovery,
    pendingReview,
  }
}

function buildTick(): LiveTick | null {
  const s = liveSession()
  if (!s) return null
  const now = Date.now()
  return {
    sessionId: s.id,
    state: isPaused(s) ? 'paused' : 'running',
    elapsedMs: focusMs(s, now),
    remainingMs: remainingMs(s, now),
    plannedMs: s.plannedMs,
    activeTaskId: activeTaskId(s),
  }
}

function push(save = true): void {
  if (save) store.save()
  broadcast('whitebox:state', buildState())
  updateTray()
}

// ── タイマー ──────────────────────────────────────────────────────

function startTicker(): void {
  if (ticker) return
  ticker = setInterval(tick, 1000)
}

function stopTicker(): void {
  if (!ticker) return
  clearInterval(ticker)
  ticker = null
}

function tick(): void {
  const session = liveSession()
  if (!session) {
    stopTicker()
    updateTray()
    return
  }
  const now = Date.now()
  broadcast('whitebox:tick', buildTick())
  updateTray()

  if (now - lastAliveWrite > ALIVE_WRITE_INTERVAL_MS) {
    lastAliveWrite = now
    store.markAlive()
  }

  if (!isPaused(session) && session.expiredNotifiedAt === null && remainingMs(session, now) <= 0) {
    replaceSession(ops.markExpired(session, now))
    push()
    openWindow('expire')
  }
}

// ── トレイ ────────────────────────────────────────────────────────

function iconPath(name: string): string {
  return path.join(APP_ROOT, 'assets', name)
}

function updateTray(): void {
  if (!tray) return
  const s = liveSession()
  if (!s) {
    tray.setToolTip('White Box — 停止中')
  } else {
    const state = isPaused(s) ? '一時停止' : '実行中'
    tray.setToolTip(`White Box — ${state} ${formatDuration(focusMs(s, Date.now()), 'hms')} / ${taskTitle(activeTaskId(s) ?? '')}`)
  }
  tray.setContextMenu(trayMenu())
}

function trayMenu(): Menu {
  const s = liveSession()
  return Menu.buildFromTemplate([
    { label: 'White Box を開く', click: () => openWindow('main') },
    { label: '現在の仕事', click: () => openWindow('current') },
    { type: 'separator' },
    s
      ? isPaused(s)
        ? { label: '再開', click: () => void run('session:resume', {}) }
        : { label: '一時停止', click: () => void run('session:pause', {}) }
      : { label: 'セッションを開始', click: () => openWindow('start') },
    ...(s ? [{ label: 'セッションを終了', click: () => void run('session:end', {}) }] : []),
    { type: 'separator' },
    { label: '終了', click: () => { quitting = true; app.quit() } },
  ])
}

// ── コマンド ──────────────────────────────────────────────────────

/**
 * 呼び出し元のウィンドウを閉じるときに使う。
 * setImmediate では IPC の返事の送信と競合し、呼び出し側の待機が終わらないことがある。
 */
function closeLater(...kinds: WindowKind[]): void {
  setTimeout(() => kinds.forEach(closeWindow), 150)
}

/** コマンド 1 つ = 関数 1 つ。引数・返り値の型は @white-box/contracts の契約から決まる。 */
type Handlers = {
  [N in CommandName]: (args: ArgsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>
}

const handlers: Handlers = {
  'state:get': () => buildState(),

  // ── Project
  'project:create': (a) => {
    const p = mut.createProject(db(), { name: a.name })
    push()
    return p
  },
  'project:update': (a) => {
    mut.updateProject(db(), a.id, a.patch)
    push()
    return null
  },
  'project:delete': (a) => {
    mut.deleteProject(db(), a.id)
    push()
    return null
  },

  // ── Task
  'task:create': (a) => {
    const t = mut.createTask(db(), a)
    const s = liveSession()
    if (s && a.fromSession) replaceSession(ops.noteTaskCreated(s, t.title, t.id, Date.now()))
    push()
    return t
  },
  'task:update': (a) => {
    mut.updateTask(db(), a.id, a.patch)
    push()
    return null
  },
  'task:move': (a) => {
    mut.moveTask(db(), a.id, a.status, a.index)
    push()
    return null
  },
  'task:delete': (a) => {
    mut.deleteTask(db(), a.id)
    push()
    return null
  },
  'task:hasTime': (a) => mut.hasRecordedTime(db(), a.id),

  // ── Session
  'session:start': (a) => {
    if (liveSession()) return null
    const now = Date.now()
    let taskId = a.taskId
    if (!taskId && a.newTask) {
      const t = mut.createTask(db(), {
        title: a.newTask.title,
        projectId: a.newTask.projectId ?? null,
        status: 'doing',
      })
      taskId = t.id
    }
    if (!taskId) return null
    const minutes = a.minutes || db().settings.defaultSessionMinutes
    const session = ops.createSession({ taskId, taskTitle: taskTitle(taskId), plannedMs: minutes * MINUTE, now })
    db().sessions.push(session)
    mut.updateTask(db(), taskId, { status: 'doing' })
    push()
    openWindow('hud', false)
    startTicker()
    closeLater('start')
    return session
  },
  'session:pause': (a) => {
    const s = liveSession()
    if (!s) return null
    replaceSession(ops.pauseSession(s, Date.now(), a.reason ?? 'manual'))
    push()
    openWindow('hud', false)
    return null
  },
  'session:resume': () => {
    const s = liveSession()
    if (!s) return null
    replaceSession(ops.resumeSession(s, Date.now()))
    push()
    return null
  },
  'session:toggle': async () => {
    const s = liveSession()
    if (!s) {
      openWindow('start')
      return null
    }
    return run(isPaused(s) ? 'session:resume' : 'session:pause', {})
  },
  'session:extend': (a) => {
    const s = liveSession()
    if (!s) return null
    const minutes = a.minutes || db().settings.defaultExtendMinutes
    replaceSession(ops.extendSession(s, minutes, Date.now()))
    push()
    closeLater('expire')
    return null
  },
  'session:switchTask': (a) => {
    const s = liveSession()
    if (!s) return null
    const now = Date.now()
    const prev = activeTaskId(s)
    replaceSession(ops.switchTask(s, a.taskId, taskTitle(a.taskId), now))
    mut.updateTask(db(), a.taskId, { status: 'doing' })
    if (prev && prev !== a.taskId) {
      const prevTask = db().tasks.find((t) => t.id === prev)
      if (prevTask && prevTask.status === 'doing') mut.updateTask(db(), prev, { status: 'todo' })
    }
    push()
    return null
  },
  'session:end': (a) => {
    const s = liveSession()
    if (!s) return null
    const ended = ops.endSession(s, Date.now())
    replaceSession(ended)
    stopTicker()
    pendingReview = { sessionId: ended.id, thenStart: Boolean(a.thenStart) }
    push()
    openWindow('review')
    closeLater('expire', 'hud')
    return null
  },
  'session:review': (a) => {
    const s = db().sessions.find((x) => x.id === a.sessionId)
    if (!s) return null
    const updated = ops.recordProgress(s, a.changes, Date.now())
    updated.note = a.note ?? ''
    replaceSession(updated)
    for (const c of a.changes) {
      mut.updateTask(db(), c.taskId, {
        progress: c.to,
        ...(c.markedDone ? { status: 'done' as const } : {}),
      })
    }
    const thenStart = pendingReview?.thenStart ?? false
    pendingReview = null
    push()
    if (thenStart) openWindow('start')
    closeLater('review')
    return null
  },
  'session:skipReview': () => {
    pendingReview = null
    push()
    closeLater('review')
    return null
  },
  'session:update': (a) => {
    const s = db().sessions.find((x) => x.id === a.id)
    if (!s) return null
    if (typeof a.patch.startedAt === 'number') s.startedAt = a.patch.startedAt
    if (typeof a.patch.endedAt === 'number') s.endedAt = a.patch.endedAt
    if (typeof a.patch.plannedMs === 'number') s.plannedMs = a.patch.plannedMs
    if (typeof a.patch.note === 'string') s.note = a.patch.note
    if (a.segmentTaskId && s.segments[0]) {
      for (const seg of s.segments) seg.taskId = a.segmentTaskId
    }
    if (s.endedAt !== null && s.startedAt > s.endedAt) s.endedAt = s.startedAt
    const now = Date.now()
    s.editedAt = now
    s.events.push({ at: now, type: 'session_edited', label: '記録を手で修正' })
    push()
    return null
  },
  'session:delete': (a) => {
    db().sessions = db().sessions.filter((s) => s.id !== a.id)
    push()
    return null
  },

  // ── 復旧
  'recovery:close': () => {
    const s = db().sessions.find((x) => x.id === recovery?.sessionId)
    if (s && recovery) {
      replaceSession(ops.closeAtLastKnown(s, recovery.lastKnownAt))
      pendingReview = { sessionId: s.id, thenStart: false }
    }
    recovery = null
    push()
    openWindow('review')
    return null
  },
  'recovery:resume': () => {
    const s = db().sessions.find((x) => x.id === recovery?.sessionId)
    if (s) replaceSession(ops.resumeSession(s, Date.now()))
    recovery = null
    push()
    startTicker()
    return null
  },

  // ── ウィンドウ / 設定 / データ
  'window:open': (a) => {
    openWindow(a.kind)
    return null
  },
  'window:close': (a) => {
    closeWindow(a.kind)
    return null
  },
  'window:toggle': (a) => {
    toggleWindow(a.kind)
    return null
  },
  'window:minimize': () => {
    BrowserWindow.getFocusedWindow()?.minimize()
    return null
  },

  'settings:update': (a) => {
    Object.assign(db().settings, a.patch)
    applyShortcuts()
    applyLoginItem()
    push()
    return null
  },
  'day:note': (a) => {
    db().dayNotes[a.key] = a.text
    push()
    return null
  },
  'welcome:dismiss': () => {
    db().settings.lastWelcomeDate = dayKey(Date.now(), db().settings.dayStartHour)
    push()
    return null
  },

  'data:export': async () => {
    const res = await dialog.showSaveDialog({
      title: 'データを書き出す',
      defaultPath: `white-box-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (res.canceled || !res.filePath) return null
    fs.writeFileSync(res.filePath, JSON.stringify(db(), null, 2), 'utf-8')
    return res.filePath
  },
  'data:import': async () => {
    const res = await dialog.showOpenDialog({
      title: 'データを読み込む（現在のデータは置き換わります）',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    const confirm = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['読み込む', 'やめる'],
      defaultId: 1,
      cancelId: 1,
      message: '現在のデータを、選んだファイルの内容で置き換えます。',
      detail: '直前のデータは backups フォルダに残ります。',
    })
    if (confirm.response !== 0) return null
    const parsed = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8')) as Database
    store.replace(parsed)
    push()
    return res.filePaths[0]
  },
  'data:reveal': () => {
    void shell.openPath(store.dir)
    return null
  },

  'app:quit': () => {
    quitting = true
    app.quit()
    return null
  },
}

async function run<N extends CommandName>(name: N, args: ArgsOf<N>): Promise<ResultOf<N>> {
  // handlers[name] はコマンド名ごとの関数の合併型になり、そのままでは呼べないので 1 箇所だけ絞り込む
  const handler = handlers[name] as (a: ArgsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>
  return await handler(args)
}

// ── ショートカット / 起動設定 ───────────────────────────────────────

function applyShortcuts(): void {
  globalShortcut.unregisterAll()
  const sc = db().settings.shortcuts
  const bind = (accel: string, fn: () => void) => {
    if (!accel) return
    try {
      globalShortcut.register(accel, fn)
    } catch (err) {
      console.error('[white-box] ショートカットを登録できません:', accel, err)
    }
  }
  bind(sc.startPause, () => void run('session:toggle', {}))
  bind(sc.currentWork, () => toggleWindow('current'))
  bind(sc.dashboard, () => openWindow('main'))
}

function applyLoginItem(): void {
  const open = db().settings.launchAtLogin
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] })
  } else {
    app.setLoginItemSettings({ openAtLogin: open, path: process.execPath, args: [APP_ROOT, '--hidden'] })
  }
}

// ── 起動 ──────────────────────────────────────────────────────────

function restoreOpenSession(): void {
  const s = liveSession()
  if (!s) return
  const lastAlive = store.readLastAlive()
  const gap = lastAlive ? Date.now() - lastAlive : Infinity
  if (lastAlive && gap > CRASH_GAP_MS) {
    if (!isPaused(s)) replaceSession(ops.pauseSession(s, lastAlive, 'suspend'))
    recovery = { sessionId: s.id, lastKnownAt: lastAlive }
    store.save()
    return
  }
  startTicker()
}

function shouldShowWelcome(): boolean {
  return db().settings.lastWelcomeDate !== dayKey(Date.now(), db().settings.dayStartHour)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openWindow('main'))

  void app.whenReady().then(() => {
    app.setAppUserModelId('dev.whitebox.app')
    store = new Store()

    ipcMain.handle('whitebox:cmd', async (_e, payload: { name?: unknown; args?: unknown }) => {
      const name = typeof payload?.name === 'string' ? payload.name : ''
      try {
        if (!isCommand(name)) throw new Error(`未知のコマンド: ${name}`)
        // 契約（zod）で検証してから実行する。壊れた引数はここで {ok:false} になり、状態に触れない
        return { ok: true, data: await run(name, parseArgs(name, payload.args)) }
      } catch (err) {
        console.error('[white-box] コマンド失敗:', name, err)
        return { ok: false, error: String(err) }
      }
    })

    const trayIcon = nativeImage.createFromPath(iconPath('tray.png'))
    tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon)
    tray.on('click', () => openWindow('main'))
    updateTray()

    restoreOpenSession()
    applyShortcuts()
    applyLoginItem()

    const hidden = process.argv.includes('--hidden')
    if (!hidden || shouldShowWelcome()) openWindow('main')
    if (liveSession()) openWindow('hud', false)

    // --open=start,current のように指定して、目的の画面から立ち上げる
    const openArg = process.argv.find((a) => a.startsWith('--open='))
    if (openArg) {
      for (const kind of openArg.slice('--open='.length).split(',')) {
        if (kind) openWindow(kind as WindowKind, false)
      }
    }

    powerMonitor.on('suspend', () => autoPause('suspend'))
    powerMonitor.on('lock-screen', () => autoPause('lock'))
    powerMonitor.on('resume', onWake)
    powerMonitor.on('unlock-screen', onWake)
  })

  app.on('window-all-closed', () => {
    // トレイ常駐。ウィンドウを全部閉じても計測は続ける。
  })

  app.on('before-quit', () => {
    quitting = true
    store?.markAlive()
    store?.save()
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
}

function autoPause(reason: 'suspend' | 'lock'): void {
  const s = liveSession()
  if (!s || isPaused(s) || !db().settings.autoPauseOnSuspend) return
  void run('session:pause', { reason })
}

function onWake(): void {
  store?.markAlive()
  if (liveSession()) openWindow('hud', false)
  else if (shouldShowWelcome()) openWindow('main')
}

export { quitting }

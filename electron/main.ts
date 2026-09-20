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
import type { AppState, Database, ID, LiveTick, Session, WindowKind } from '../shared/types.js'
import { activeTaskId, dayKey, focusMs, formatDuration, isPaused, MINUTE, remainingMs } from '../shared/engine.js'
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
    breakTimer: buildBreakTimer(),
    recovery,
    pendingReview,
  }
}

function buildBreakTimer(): AppState['breakTimer'] {
  const pause = liveSession()?.pauses.find(
    (item) => item.endedAt === null && item.reason === 'break' && item.plannedEndAt !== undefined,
  )
  return pause?.plannedEndAt === undefined
    ? null
    : { startedAt: pause.startedAt, endsAt: pause.plannedEndAt, notifiedAt: pause.notifiedAt ?? null }
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

  const breakTimer = buildBreakTimer()
  if (breakTimer && breakTimer.notifiedAt === null && now >= breakTimer.endsAt) {
    replaceSession(ops.markBreakExpired(session, now))
    push()
    openWindow('expire')
    return
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
        ? { label: '再開', click: () => void run('session:resume') }
        : { label: '一時停止', click: () => void run('session:pause') }
      : { label: 'セッションを開始', click: () => openWindow('start') },
    ...(s ? [{ label: 'セッションを終了', click: () => void run('session:end') }] : []),
    { type: 'separator' },
    { label: '終了', click: () => { quitting = true; app.quit() } },
  ])
}

// ── コマンド ──────────────────────────────────────────────────────

type Args = Record<string, any>

/**
 * 呼び出し元のウィンドウを閉じるときに使う。
 * setImmediate では IPC の返事の送信と競合し、呼び出し側の待機が終わらないことがある。
 */
function closeLater(...kinds: WindowKind[]): void {
  setTimeout(() => kinds.forEach(closeWindow), 150)
}

async function run(name: string, args: Args = {}): Promise<unknown> {
  const now = Date.now()

  switch (name) {
    case 'state:get':
      return buildState()

    // ── Project
    case 'project:create': {
      const p = mut.createProject(db(), { name: args['name'] })
      push()
      return p
    }
    case 'project:update':
      mut.updateProject(db(), args['id'], args['patch'])
      push()
      return null
    case 'project:delete':
      mut.deleteProject(db(), args['id'])
      push()
      return null

    // ── Task
    case 'task:create': {
      const t = mut.createTask(db(), args as any)
      const s = liveSession()
      if (s && args['fromSession']) replaceSession(ops.noteTaskCreated(s, t.title, t.id, now))
      push()
      return t
    }
    case 'task:update':
      mut.updateTask(db(), args['id'], args['patch'])
      push()
      return null
    case 'task:move':
      mut.moveTask(db(), args['id'], args['status'], args['index'])
      push()
      return null
    case 'task:delete':
      mut.deleteTask(db(), args['id'])
      push()
      return null
    case 'task:hasTime':
      return mut.hasRecordedTime(db(), args['id'])

    // ── Session
    case 'session:start': {
      if (liveSession()) return null
      let taskId: ID = args['taskId']
      if (!taskId && args['newTask']) {
        const t = mut.createTask(db(), {
          title: args['newTask'].title,
          projectId: args['newTask'].projectId ?? null,
          status: 'doing',
        })
        taskId = t.id
      }
      if (!taskId) return null
      const minutes = Number(args['minutes']) || db().settings.defaultSessionMinutes
      const session = ops.createSession({ taskId, taskTitle: taskTitle(taskId), plannedMs: minutes * MINUTE, now })
      db().sessions.push(session)
      mut.updateTask(db(), taskId, { status: 'doing' })
      push()
      openWindow('hud', false)
      startTicker()
      closeLater('start')
      return session
    }
    case 'session:pause': {
      const s = liveSession()
      if (!s) return null
      replaceSession(ops.pauseSession(s, now, (args['reason'] as any) ?? 'manual'))
      push()
      openWindow('hud', false)
      return null
    }
    case 'session:resume': {
      const s = liveSession()
      if (!s) return null
      const resumingBreak = buildBreakTimer() !== null
      replaceSession(ops.resumeSession(s, now))
      push()
      if (resumingBreak) closeLater('expire')
      return null
    }
    case 'session:toggle': {
      const s = liveSession()
      if (!s) {
        openWindow('start')
        return null
      }
      return run(isPaused(s) ? 'session:resume' : 'session:pause')
    }
    case 'session:extend': {
      const s = liveSession()
      if (!s) return null
      const minutes = Number(args['minutes']) || db().settings.defaultExtendMinutes
      replaceSession(ops.extendSession(s, minutes, now))
      push()
      closeLater('expire')
      return null
    }
    case 'session:break': {
      const s = liveSession()
      if (!s) return null
      const minutes = Number(args['minutes']) || 5
      const next = ops.startBreak(s, minutes, now)
      if (next === s) return null
      replaceSession(next)
      push()
      openWindow('hud', false)
      closeLater('expire')
      return null
    }
    case 'session:switchTask': {
      const s = liveSession()
      if (!s) return null
      const id: ID = args['taskId']
      const prev = activeTaskId(s)
      replaceSession(ops.switchTask(s, id, taskTitle(id), now))
      mut.updateTask(db(), id, { status: 'doing' })
      if (prev && prev !== id) {
        const prevTask = db().tasks.find((t) => t.id === prev)
        if (prevTask && prevTask.status === 'doing') mut.updateTask(db(), prev, { status: 'todo' })
      }
      push()
      return null
    }
    case 'session:end': {
      const s = liveSession()
      if (!s) return null
      const ended = ops.endSession(s, now)
      replaceSession(ended)
      stopTicker()
      pendingReview = { sessionId: ended.id, thenStart: Boolean(args['thenStart']) }
      push()
      openWindow('review')
      closeLater('expire', 'hud')
      return null
    }
    case 'session:review': {
      const s = db().sessions.find((x) => x.id === args['sessionId'])
      if (!s) return null
      const changes = (args['changes'] ?? []) as { taskId: ID; from: number; to: number; markedDone: boolean }[]
      const updated = ops.recordProgress(s, changes, now)
      updated.note = args['note'] ?? ''
      replaceSession(updated)
      for (const c of changes) {
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
    }
    case 'session:skipReview': {
      pendingReview = null
      push()
      closeLater('review')
      return null
    }
    case 'session:update': {
      const s = db().sessions.find((x) => x.id === args['id'])
      if (!s) return null
      const patch = args['patch'] as Partial<Session>
      if (typeof patch.startedAt === 'number') s.startedAt = patch.startedAt
      if (typeof patch.endedAt === 'number') s.endedAt = patch.endedAt
      if (typeof patch.plannedMs === 'number') s.plannedMs = patch.plannedMs
      if (typeof patch.note === 'string') s.note = patch.note
      if (args['segmentTaskId'] && s.segments[0]) {
        for (const seg of s.segments) seg.taskId = args['segmentTaskId']
      }
      if (s.endedAt !== null && s.startedAt > s.endedAt) s.endedAt = s.startedAt
      s.editedAt = now
      s.events.push({ at: now, type: 'session_edited', label: '記録を手で修正' })
      push()
      return null
    }
    case 'session:delete': {
      db().sessions = db().sessions.filter((s) => s.id !== args['id'])
      push()
      return null
    }

    // ── 復旧
    case 'recovery:close': {
      const s = db().sessions.find((x) => x.id === recovery?.sessionId)
      if (s && recovery) {
        replaceSession(ops.closeAtLastKnown(s, recovery.lastKnownAt))
        pendingReview = { sessionId: s.id, thenStart: false }
      }
      recovery = null
      push()
      openWindow('review')
      return null
    }
    case 'recovery:resume': {
      const s = db().sessions.find((x) => x.id === recovery?.sessionId)
      if (s) replaceSession(ops.resumeSession(s, now))
      recovery = null
      push()
      startTicker()
      return null
    }

    // ── ウィンドウ / 設定 / データ
    case 'window:open':
      openWindow(args['kind'] as WindowKind)
      return null
    case 'window:close':
      closeWindow(args['kind'] as WindowKind)
      return null
    case 'window:toggle':
      toggleWindow(args['kind'] as WindowKind)
      return null
    case 'window:minimize':
      BrowserWindow.getFocusedWindow()?.minimize()
      return null

    case 'settings:update': {
      Object.assign(db().settings, args['patch'])
      applyShortcuts()
      applyLoginItem()
      push()
      return null
    }
    case 'day:note':
      db().dayNotes[args['key']] = args['text']
      push()
      return null
    case 'welcome:dismiss':
      db().settings.lastWelcomeDate = dayKey(now, db().settings.dayStartHour)
      push()
      return null

    case 'data:export': {
      const res = await dialog.showSaveDialog({
        title: 'データを書き出す',
        defaultPath: `white-box-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (res.canceled || !res.filePath) return null
      fs.writeFileSync(res.filePath, JSON.stringify(db(), null, 2), 'utf-8')
      return res.filePath
    }
    case 'data:import': {
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
    }
    case 'data:reveal':
      void shell.openPath(store.dir)
      return null

    case 'app:quit':
      quitting = true
      app.quit()
      return null

    default:
      throw new Error(`未知のコマンド: ${name}`)
  }
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
  bind(sc.startPause, () => void run('session:toggle'))
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
  if (buildBreakTimer()) {
    startTicker()
    return
  }
  const lastAlive = store.readLastAlive()
  const lastRecordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
  const lastKnownAt = lastAlive ? Math.max(lastAlive, lastRecordedAt) : null
  const gap = lastKnownAt ? Date.now() - lastKnownAt : Infinity
  if (lastKnownAt && gap > CRASH_GAP_MS) {
    if (!isPaused(s)) replaceSession(ops.pauseSession(s, lastKnownAt, 'suspend'))
    recovery = { sessionId: s.id, lastKnownAt }
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

    ipcMain.handle('whitebox:cmd', async (_e, payload: { name: string; args?: Args }) => {
      try {
        return { ok: true, data: await run(payload.name, payload.args ?? {}) }
      } catch (err) {
        console.error('[white-box] コマンド失敗:', payload.name, err)
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

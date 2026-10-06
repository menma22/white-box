/**
 * メインプロセスの組み立てと起動だけを行う。
 * 業務ルールは app/、実装詳細は infra/ にあり、ここでは Port を実物に結線する。
 *
 * タイマーをレンダラに持たせないこと（ウィンドウを閉じても計測は続く必要がある）。
 */
import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dayKey } from '@white-box/core/engine'
import type { WindowKind } from '@white-box/core/types'
import { createHandlers, dispatch, type Handlers } from '../app/handlers.js'
import { checkExpire, prepareQuit, restoreOpenSession, setCurrentWorkOpen } from '../app/lifecycle.js'
import type { Ctx } from '../app/ports.js'
import { buildState, buildTick, liveSession, newRuntime } from '../app/state.js'
import { createDataIO } from '../infra/dataio.js'
import { createStartReminderService } from '../infra/start-reminder-service.js'
import { createNoteReminders } from '../infra/note-reminders.js'
import { applyShortcuts, unregisterShortcuts } from '../infra/shortcuts.js'
import { Store } from '../infra/store.js'
import { createTray } from '../infra/tray.js'
import { createTicker } from '../infra/ticker.js'
import { APP_ROOT, broadcast, closeWindow, openWindow, toggleWindow, observeCurrentWorkWindow, setWindowOpeningGuard, setWindowCloseGuard, setWindowDraftProfile, getWindow } from '../infra/windows.js'
import { RendererFlush } from '../infra/renderer-flush.js'
import { registerIpc } from './ipc.js'
import { createAgentService } from '../infra/agent-service.js'

const ALIVE_WRITE_INTERVAL_MS = 15_000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openWindow('main'))

  void app.whenReady().then(() => {
    app.setAppUserModelId('dev.whitebox.app')

    let store: Store
    try { store = new Store() }
    catch (cause) {
      dialog.showErrorBox('データを読み込めません', `既存のデータを保持して、起動を停止しました。保存先のデータとバックアップを確認してください。\n${String(cause)}`)
      app.quit()
      return
    }
    setWindowDraftProfile(createHash('sha256').update(path.resolve(store.dir).toLowerCase()).digest('hex'))
    const runtime = newRuntime()
    setWindowOpeningGuard(() => !runtime.quitting && !runtime.preparingQuit)
    const editors = new RendererFlush((kinds = ['main', 'current']) => kinds.flatMap((kind) => {
      const win = getWindow(kind)
      return win ? [{ id: win.webContents.id, kind,
        send: (channel: string, payload: unknown) => { if (!win.isDestroyed()) win.webContents.send(channel, payload) },
        onClosed: (callback: () => void) => { win.once('closed', callback); return () => win.removeListener('closed', callback) },
        focus: () => { if (!win.isDestroyed()) { win.show(); win.focus() } },
      }] : []
    }))
    ipcMain.on('whitebox:flush-ready', (event, ready: unknown) => {
      if (typeof ready === 'boolean') editors.setReady(event.sender.id, ready)
    })
    ipcMain.on('whitebox:flush-reply', (event, reply: unknown) => editors.reply(event.sender.id, reply))
    setWindowCloseGuard((kind) => editors.prepare('close', [kind]), () => runtime.quitting, () => !runtime.preparingQuit)
    let handlers: Handlers
    let agentService: ReturnType<typeof createAgentService> | undefined
    let lastAliveWrite = 0
    let startReminderService: ReturnType<typeof createStartReminderService> | null = null
    const reportCommandFailure = (cause: unknown) => {
      try { openWindow('current') } catch (error) { console.error('[white-box] 現在の仕事を開けません:', error) }
      dialog.showErrorBox('操作を実行できません', String(cause))
    }

    const tray = createTray({
      getDb: () => store.data,
      onCommand: (name) => void dispatch(handlers, name, {}).catch(reportCommandFailure),
      onQuit: () => app.quit(),
    })

    const ticker = createTicker(() => {
      if (!liveSession(store.data)) {
        ticker.stop()
        tray.update()
        return
      }
      const now = Date.now()
      checkExpire(ctx)
      broadcast('whitebox:tick', buildTick(store.data, now))
      tray.update()
      if (now - lastAliveWrite > ALIVE_WRITE_INTERVAL_MS) {
        lastAliveWrite = now
        store.markAlive()
      }
    }, () => !runtime.quitting)

    const ctx: Ctx = {
      store,
      windows: {
        prepareEditors: (reason, kinds) => editors.prepare(reason, kinds),
        open: (kind, focus) => void openWindow(kind, focus),
        close: closeWindow,
        toggle: toggleWindow,
        minimizeFocused: () => BrowserWindow.getFocusedWindow()?.minimize(),
        closeLater: (...kinds) => void setTimeout(() => kinds.forEach(closeWindow), 150),
      },
      ticker,
      system: {
        agentConfig: () => JSON.stringify({ mcpServers: { 'white-box': { command: process.execPath, args: [path.join(APP_ROOT, 'scripts', 'white-box-mcp.mjs')], env: { ELECTRON_RUN_AS_NODE: '1', WHITEBOX_AGENT_CONFIG: path.join(store.dir, 'agent-connection.json') } } } }, null, 2),
        applyShortcuts: () =>
          applyShortcuts(store.data.settings.shortcuts, () => void dispatch(handlers, 'session:toggle', {}).catch(reportCommandFailure)),
        applyLoginItem: () => {
          const open = store.data.settings.launchAtLogin
          if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] })
          else app.setLoginItemSettings({ openAtLogin: open, path: process.execPath, args: [APP_ROOT, '--hidden'] })
        },
        quit: () => app.quit(),
      },
      dataIO: createDataIO(store, () => !runtime.preparingQuit && !runtime.quitting),
      runtime,
      now: () => Date.now(),
      publish: (persist = true) => {
        if (persist) store.save()
        broadcast('whitebox:state', buildState(store.data, runtime, Date.now()))
        tray.update()
        startReminderService?.refresh()
        agentService?.refresh()
      },
    }

    handlers = createHandlers(ctx)
    observeCurrentWorkWindow((open) => setCurrentWorkOpen(ctx, open))
    agentService = createAgentService(ctx, store.dir, handlers)
    registerIpc(handlers)
    startReminderService = createStartReminderService(ctx)
    const noteReminders = createNoteReminders(ctx)

    restoreOpenSession(ctx)
    ctx.system.applyShortcuts()
    ctx.system.applyLoginItem()
    tray.update()

    const shouldShowWelcome = store.data.settings.lastWelcomeDate !== dayKey(Date.now(), store.data.settings.dayStartHour)
    const hidden = process.argv.includes('--hidden')
    if (!hidden || shouldShowWelcome) openWindow('main')
    if (liveSession(store.data)) openWindow('hud', false)

    // --open=start,current のように指定して、目的の画面から立ち上げる
    const openArg = process.argv.find((a) => a.startsWith('--open='))
    if (openArg) {
      for (const kind of openArg.slice('--open='.length).split(',')) {
        if (kind) openWindow(kind as WindowKind, false)
      }
    }

    const autoPause = (reason: 'suspend' | 'lock') => {
      if (runtime.quitting) return
      const s = liveSession(store.data)
      if (!s || !store.data.settings.autoPauseOnSuspend) return
      void dispatch(handlers, 'session:pause', { reason }).catch(reportCommandFailure)
    }
    const onWake = () => {
      if (runtime.quitting) return
      store.markAlive()
      if (liveSession(store.data)) openWindow('hud', false)
      else if (store.data.settings.lastWelcomeDate !== dayKey(Date.now(), store.data.settings.dayStartHour)) openWindow('main')
    }
    powerMonitor.on('suspend', () => autoPause('suspend'))
    powerMonitor.on('lock-screen', () => autoPause('lock'))
    powerMonitor.on('resume', onWake)
    powerMonitor.on('unlock-screen', onWake)

    let quitPrepared = false
    app.on('before-quit', (event) => {
      if (quitPrepared) return
      event.preventDefault()
      if (runtime.preparingQuit) return
      runtime.preparingQuit = true
      void editors.prepare('quit').then((release) => {
        try {
          prepareQuit(ctx)
          startReminderService?.stop()
          agentService?.stop()
          noteReminders.stop()
          quitPrepared = true
          app.quit()
        } catch (cause) { release(); throw cause }
      }).catch((cause) => {
        console.error('[white-box] 終了前の保存に失敗:', cause)
        dialog.showErrorBox('終了できません', `データを保存できなかったため、終了を取り消しました。\n${String(cause)}`)
      }).finally(() => { runtime.preparingQuit = false })
    })
  })

  app.on('window-all-closed', () => {
    // トレイ常駐。ウィンドウを全部閉じても計測は続ける。
  })

  app.on('will-quit', () => unregisterShortcuts())
}

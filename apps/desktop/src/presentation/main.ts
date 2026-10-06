/**
 * メインプロセスの組み立てと起動だけを行う。
 * 業務ルールは app/、実装詳細は infra/ にあり、ここでは Port を実物に結線する。
 *
 * タイマーをレンダラに持たせないこと（ウィンドウを閉じても計測は続く必要がある）。
 */
import { app, BrowserWindow, dialog, powerMonitor } from 'electron'
import path from 'node:path'
import { dayKey } from '@white-box/core/engine'
import type { WindowKind } from '@white-box/core/types'
import { createHandlers, dispatch, type Handlers } from '../app/handlers.js'
import { checkExpire, restoreOpenSession, setCurrentWorkOpen } from '../app/lifecycle.js'
import type { Ctx } from '../app/ports.js'
import { buildState, buildTick, liveSession, newRuntime } from '../app/state.js'
import { createDataIO } from '../infra/dataio.js'
import { createStartReminderService } from '../infra/start-reminder-service.js'
import { createNoteReminders } from '../infra/note-reminders.js'
import { applyShortcuts, unregisterShortcuts } from '../infra/shortcuts.js'
import { Store } from '../infra/store.js'
import { createTray } from '../infra/tray.js'
import { createTicker } from '../infra/ticker.js'
import { APP_ROOT, broadcast, closeWindow, openWindow, toggleWindow, observeCurrentWorkWindow } from '../infra/windows.js'
import { registerIpc } from './ipc.js'
import { createAgentService } from '../infra/agent-service.js'

const ALIVE_WRITE_INTERVAL_MS = 15_000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openWindow('main'))

  void app.whenReady().then(() => {
    app.setAppUserModelId('dev.whitebox.app')

    const store = new Store()
    const runtime = newRuntime()
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
    })

    const ctx: Ctx = {
      store,
      windows: {
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
      dataIO: createDataIO(store),
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
      const s = liveSession(store.data)
      if (!s || !store.data.settings.autoPauseOnSuspend) return
      void dispatch(handlers, 'session:pause', { reason }).catch(reportCommandFailure)
    }
    const onWake = () => {
      store.markAlive()
      if (liveSession(store.data)) openWindow('hud', false)
      else if (store.data.settings.lastWelcomeDate !== dayKey(Date.now(), store.data.settings.dayStartHour)) openWindow('main')
    }
    powerMonitor.on('suspend', () => autoPause('suspend'))
    powerMonitor.on('lock-screen', () => autoPause('lock'))
    powerMonitor.on('resume', onWake)
    powerMonitor.on('unlock-screen', onWake)

    app.on('before-quit', () => {
      runtime.quitting = true
      startReminderService?.stop()
      agentService?.stop()
      noteReminders.stop()
      store.markAlive()
      store.save()
    })
  })

  app.on('window-all-closed', () => {
    // トレイ常駐。ウィンドウを全部閉じても計測は続ける。
  })

  app.on('will-quit', () => unregisterShortcuts())
}

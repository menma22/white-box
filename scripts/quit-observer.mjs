import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const traceDirectory = process.env.WHITEBOX_QUIT_TRACE_DIR
if (!traceDirectory || !process.env.WHITEBOX_DATA_DIR || !process.argv.some((arg) => arg.startsWith('--user-data-dir='))) throw new Error('Quit observation requires an isolated data directory, profile and trace directory')
const append = fs.appendFileSync.bind(fs)
const tracePath = path.join(traceDirectory, `quit-${process.pid}.jsonl`)
const trace = (event, detail = {}) => append(tracePath, JSON.stringify({ at: Date.now(), pid: process.pid, event, ...detail }) + '\n')
const windows = () => BrowserWindow.getAllWindows().map((win) => {
  try { return { id: win.id, url: win.webContents.getURL(), loading: win.webContents.isLoading(), rendererPid: win.webContents.getOSProcessId(), visible: win.isVisible(), focused: win.isFocused() } }
  catch (error) { return { id: win.id, error: String(error) } }
})
let quitting = false

trace('bootstrap', { main: path.join(ROOT, 'dist-electron', 'presentation', 'main.js') })
app.on('before-quit', () => { quitting = true; trace('before-quit', { windows: windows() }) })
for (const event of ['will-quit', 'quit', 'window-all-closed']) app.on(event, () => trace(event, { windows: windows() }))
process.on('uncaughtExceptionMonitor', (error) => trace('uncaught-exception', { error: error.stack || String(error) }))
process.on('exit', (code) => trace('process-exit', { code }))
app.on('browser-window-created', (_event, win) => {
  trace('window-created', { id: win.id, quitting })
  for (const event of ['close', 'closed', 'ready-to-show']) win.on(event, () => trace(`window-${event}`, { id: win.id, quitting }))
  win.on('close', (event) => queueMicrotask(() => trace('window-close-decision', { id: win.id, prevented: event.defaultPrevented, quitting })))
  for (const event of ['did-finish-load', 'destroyed', 'unresponsive', 'responsive', 'render-process-gone']) {
    win.webContents.on(event, (_event, detail) => trace(`renderer-${event}`, { id: win.id, detail, quitting }))
  }
  const send = win.webContents.send
  win.webContents.send = function (channel, ...args) {
    const flush = channel === 'whitebox:flush-request' || channel === 'whitebox:flush-release'
    if (flush) trace('renderer-flush-send', { id: win.id, senderId: this.id, channel, payload: args[0] })
    try { return send.call(this, channel, ...args) }
    catch (error) { if (flush) trace('renderer-flush-send-throw', { id: win.id, channel, error: String(error) }); throw error }
  }
})
app.whenReady().then(() => {
  for (const event of ['resume', 'unlock-screen', 'suspend', 'lock-screen']) powerMonitor.on(event, () => trace(`power-${event}`, { quitting }))
})

const on = app.on
app.on = function (event, listener) {
  if (event !== 'before-quit') return on.call(this, event, listener)
  return on.call(this, event, function (...args) {
    trace('before-quit-listener-start')
    try {
      const result = listener.apply(this, args)
      trace('before-quit-listener-return')
      return result
    } catch (error) {
      trace('before-quit-listener-throw', { error: error.stack || String(error) })
      throw error
    }
  })
}
const handle = ipcMain.handle
ipcMain.handle = function (channel, listener) {
  if (channel !== 'whitebox:cmd') return handle.call(this, channel, listener)
  return handle.call(this, channel, async function (...args) {
    const quit = args[1]?.name === 'app:quit'
    if (quit) trace('quit-ipc-received')
    try {
      const reply = await listener.apply(this, args)
      if (quit) trace('quit-ipc-return', { reply })
      return reply
    } catch (error) {
      if (quit) trace('quit-ipc-throw', { error: error.stack || String(error) })
      throw error
    }
  })
}
const ipcOn = ipcMain.on
ipcMain.on = function (channel, listener) {
  if (channel !== 'whitebox:flush-ready' && channel !== 'whitebox:flush-reply') return ipcOn.call(this, channel, listener)
  return ipcOn.call(this, channel, function (event, ...args) {
    trace('renderer-flush-ipc-received', { channel, senderId: event.sender.id, payload: args[0] })
    try {
      const result = listener.call(this, event, ...args)
      trace('renderer-flush-ipc-return', { channel, senderId: event.sender.id })
      return result
    } catch (error) { trace('renderer-flush-ipc-throw', { channel, error: String(error) }); throw error }
  })
}
const showErrorBox = dialog.showErrorBox
dialog.showErrorBox = function (title, content) {
  trace('native-error-box-start', { title, content, quitting })
  try { return showErrorBox.call(this, title, content) }
  finally { trace('native-error-box-return', { quitting }) }
}
for (const method of ['writeFileSync', 'renameSync', 'existsSync', 'copyFileSync']) {
  const original = fs[method]
  fs[method] = function (...args) {
    const observe = quitting && String(args[0]).startsWith(process.env.WHITEBOX_DATA_DIR)
    if (observe) trace(`fs-${method}-start`, { path: String(args[0]) })
    try {
      const result = original.apply(this, args)
      if (observe) trace(`fs-${method}-return`)
      return result
    } catch (error) {
      if (observe) trace(`fs-${method}-throw`, { error: error.stack || String(error) })
      throw error
    }
  }
}
setInterval(() => { if (quitting) trace('quitting-window-snapshot', { windows: windows() }) }, 1000).unref()
await import(pathToFileURL(path.join(ROOT, 'dist-electron', 'presentation', 'main.js')).href)

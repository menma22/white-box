import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'start-reminder-run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = []
let child, page

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`)
  assert.ok(condition, name)
}

async function until(test, label, timeout = 10000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try { const value = await test(); if (value) return value } catch (error) { last = error }
    await wait(100)
  }
  throw new Error(`Timed out: ${label}${last ? ' / ' + last.message : ''}`)
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const assigned = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return assigned
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')) }, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  ws.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP connection closed')) }
    pending.clear()
  })
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, method === 'Page.captureScreenshot' ? 30000 : 10000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Log.enable')
  return {
    send, close: () => ws.close(),
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    },
  }
}

const read = () => JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'))
async function raw(name, args = {}) { return page.evaluate(`window.whitebox.call(${JSON.stringify(name)},${JSON.stringify(args)})`) }
async function call(name, args = {}) {
  const response = await raw(name, args)
  assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`)
  return response.data
}

async function launch(label) {
  const port = await freePort()
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(RUN, `${label}-app.log`), 'a')
  const args = ['--hidden', '--open=main', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`]
  if (!process.env.WHITEBOX_EXE) args.unshift(ROOT)
  child = spawn(electron, args, { cwd: ROOT, env, stdio: ['ignore', log, log], windowsHide: true })
  fs.closeSync(log)
  let spawnError
  child.once('error', (error) => { spawnError = error })
  const target = await until(async () => {
    if (spawnError) throw spawnError
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    return (await response.json()).find((item) => item.type === 'page' && item.url.endsWith('#main'))
  }, 'main window', 20000)
  const buildRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
  const expected = pathToFileURL(path.join(buildRoot, 'dist', 'index.html')).href + '#main'
  check(`${label}: CDP is attached to this build`, decodeURI(target.url) === decodeURI(expected), target.url)
  page = await connect(target.webSocketDebuggerUrl)
  await until(() => page.evaluate('Boolean(window.whitebox && document.querySelector(".rail-tabs"))'), 'renderer ready')
  await page.send('Page.bringToFront')
}

async function stop() {
  const owned = child
  if (!owned) { page?.close(); page = undefined; return }
  let exitEventObserved = false
  let quitRequested = false
  let quitError = null
  let forcedKill = false
  let killAccepted = null
  const onExit = () => { exitEventObserved = true }
  owned.on('exit', onExit)
  const pidAlive = () => {
    if (!owned.pid) return false
    try { process.kill(owned.pid, 0); return true } catch (error) {
      if (error.code === 'ESRCH') return false
      throw error
    }
  }
  const exited = () => exitEventObserved || owned.exitCode !== null || owned.signalCode !== null || !pidAlive()
  const waitForExit = async (timeout) => {
    const deadline = Date.now() + timeout
    while (!exited()) {
      if (Date.now() >= deadline) return false
      await wait(100)
    }
    return true
  }
  try {
    if (exited()) return
    quitRequested = Boolean(page)
    try { await page?.evaluate('void window.whitebox.call("app:quit")') } catch (error) { quitError = error.message }
    page?.close()
    if (await waitForExit(15000)) return
    forcedKill = true
    console.log(`Cleanup: terminating owned Electron PID ${owned.pid} after quit timeout`)
    killAccepted = owned.kill('SIGKILL')
    if (!await waitForExit(5000)) throw new Error('Owned Electron did not exit after cleanup')
    throw new Error('Owned Electron required forced cleanup instead of exiting after app:quit')
  } finally {
    page?.close()
    owned.off('exit', onExit)
    const alive = pidAlive()
    const observation = { pid: owned.pid, quitRequested, quitError, forcedKill, killAccepted,
      exitEventObserved, exitCode: owned.exitCode, signalCode: owned.signalCode, pidAlive: alive,
      confirmedBy: exitEventObserved || owned.exitCode !== null || owned.signalCode !== null ? 'child exit state' : !alive ? 'PID absent' : null }
    fs.writeFileSync(path.join(RUN, `shutdown-${owned.pid ?? 'unspawned'}.json`), JSON.stringify(observation, null, 2))
    console.log(`Cleanup: ${JSON.stringify(observation)}`)
    if (exited()) { child = undefined; page = undefined }
  }
}

async function screenshot(name) {
  await page.send('Page.bringToFront')
  await wait(350)
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
}

async function key(key, code, modifiers = 0) {
  const params = { key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function click(selector) {
  const point = await until(() => page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const p={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && p.x>0 && p.x<innerWidth && p.y>0 && p.y<innerHeight && el.contains(document.elementFromPoint(p.x,p.y)) ? p : null })()`), selector)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait(100)
}

async function fill(selector, value) {
  await click(selector)
  await key('a', 'KeyA', 2)
  await page.send('Input.insertText', { text: value })
}

async function inputHelpers() {
  assert.ok(Number.isInteger(child.pid) && child.pid > 0)
  const command = `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid} AND Name = 'powershell.exe'" | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress`
  const output = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())))
  const value = output ? JSON.parse(output) : []
  return Array.isArray(value) ? value : [value]
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
async function settingsControls() {
  await key('4', 'Digit4', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".settings"))'), 'settings view')
  await page.evaluate(`(() => {
    const rows=[...document.querySelectorAll('.set-row')];
    const toggle=rows.find(row=>row.querySelector('.set-row-label')?.textContent==='入力が続いたら開始を思い出す')?.querySelector('[role="switch"]');
    const minutes=rows.find(row=>row.querySelector('.set-row-label')?.textContent==='通知までの入力時間')?.querySelector('input');
    if(!toggle || !minutes) throw Error('Missing start reminder settings');
    toggle.setAttribute('data-start-reminder-toggle','true'); minutes.setAttribute('data-start-reminder-minutes','true');
  })()`)
}
const now = Date.now()
const day = new Date(now - 4 * 3600000)
const today = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify({ version: 1, projects: [], tasks: [], sessions: [], dayNotes: {},
  settings: { onboardedAt: now, lastWelcomeDate: today, shortcuts: { startPause: '', currentWork: '', dashboard: '' } },
}))
let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  const initial = await call('state:get')
  check('Legacy settings default to disabled with a three minute threshold', initial.settings.remindToStart === false && initial.settings.startReminderMinutes === 3)
  check('Disabled startup has no input helper', (await inputHelpers()).length === 0)
  await settingsControls()
  check('Settings UI displays disabled state and the default threshold', await page.evaluate(`document.querySelector('[data-start-reminder-toggle]').getAttribute('aria-checked')==='false' && document.querySelector('[data-start-reminder-minutes]').value==='3'`))
  await click('[data-start-reminder-toggle]')
  await until(() => read().settings.remindToStart === true, 'enabled setting saved')
  const firstHelpers = await until(async () => { const ids=await inputHelpers(); return ids.length===1 ? ids : null }, 'one owned input helper')
  check('Enabling starts exactly one owned Windows input helper', firstHelpers.length === 1 && pidAlive(firstHelpers[0]))
  await fill('[data-start-reminder-minutes]', '4')
  await until(() => read().settings.startReminderMinutes === 4, 'four minute threshold saved')
  check('Changing the threshold keeps the same helper', (await inputHelpers())[0] === firstHelpers[0])
  const invalid = await raw('settings:update', { patch: { startReminderMinutes: 0 } })
  check('Strict IPC rejects invalid threshold without changing the setting', invalid.ok === false && read().settings.startReminderMinutes === 4)
  await screenshot('01-settings-enabled')
  await stop()
  await until(() => !pidAlive(firstHelpers[0]), 'input helper stopped after quit')
  check('Quitting stops the owned input helper', !pidAlive(firstHelpers[0]))
  await launch('restart')
  const restored = await call('state:get')
  check('Restart restores the opt-in and threshold', restored.settings.remindToStart === true && restored.settings.startReminderMinutes === 4)
  const restartHelpers = await until(async () => { const ids=await inputHelpers(); return ids.length===1 ? ids : null }, 'restarted input helper')
  await settingsControls()
  await click('[data-start-reminder-toggle]')
  await until(() => read().settings.remindToStart === false && !pidAlive(restartHelpers[0]), 'disabled setting and helper stopped')
  check('Disabling from the real UI stops the helper and saves OFF', !pidAlive(restartHelpers[0]) && read().settings.remindToStart === false)
  await screenshot('02-settings-disabled')
  check('Renderer has no console errors or uncaught exceptions', errors.length === 0, errors)
  exitCode = 0
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN,'failure.txt'), error.stack || String(error))
  if(page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN,'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {} }
} finally {
  try { await stop() } catch (error) { console.error(error); exitCode=1 }
  fs.writeFileSync(path.join(RUN,'result.json'), JSON.stringify({ exitCode, checks, errors },null,2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}

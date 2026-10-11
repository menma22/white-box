import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { OwnedProcesses, readWindowsProcesses, sameProcess } from './owned-processes.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e')
fs.mkdirSync(OUTPUT, { recursive: true })
const restorationProbe = process.env.WHITEBOX_NATIVE_RESTORATION_PROBE === '1'
const captionBoundaryProbe = process.env.WHITEBOX_CALENDAR_CAPTION_BOUNDARY_PROBE === '1'
const layoutPreview = ['1','initial'].includes(process.env.WHITEBOX_WEEK_PREVIEW)
const previewInitialOnly = process.env.WHITEBOX_WEEK_PREVIEW === 'initial'
const RUN = fs.mkdtempSync(path.join(OUTPUT, restorationProbe ? 'native-restoration-probe-' : captionBoundaryProbe ? 'calendar-caption-boundary-run-' : layoutPreview ? 'week-preview-run-' : 'week-calendar-run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const startedAt = new Date().toISOString()
const buildRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
const packageRoot = process.env.WHITEBOX_EXE ? 'node_modules/@white-box' : 'packages'
const runtimeFiles = ['dist-electron/presentation/main.js', 'apps/desktop/src/presentation/preload.cjs', 'dist-electron/app/handlers.js', 'dist-electron/app/planning-handlers.js', 'dist-electron/domain/calendar-ops.js', packageRoot + '/core/dist/calendar.js', packageRoot + '/core/dist/weekly-budget.js', packageRoot + '/contracts/dist/calendar.js', 'dist-electron/app/lifecycle.js', 'dist-electron/app/state.js', 'dist-electron/infra/agent-service.js', 'dist-electron/infra/dataio.js', 'dist-electron/infra/renderer-flush.js', 'dist-electron/infra/windows.js', 'dist/index.html', ...fs.readdirSync(path.join(buildRoot, 'dist', 'assets')).filter((file) => /\.(?:js|css)$/.test(file)).map((file) => 'dist/assets/' + file)]
const runtime = { startedAt, harnessSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), ownedProcessesSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-processes.mjs'))).digest('hex'), executable: electron, buildRoot, executableSha256: createHash('sha256').update(fs.readFileSync(electron)).digest('hex'), files: runtimeFiles.map((file) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(buildRoot, file))).digest('hex') })) }
fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = [], ownedProcesses = new OwnedProcesses(), pages = new Set(), expectedErrorWindows = []
let child, childIdentity, processObservation, page, port, appLog, faultLog, faultOwned = false

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`)
  assert.ok(condition, name)
}
async function until(test, label, timeout = 10000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
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
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push({ url, ...message })
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (method === 'Input.dispatchKeyEvent') fs.appendFileSync(path.join(RUN, 'key-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), method, params }) + '\n')
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, method === 'Page.captureScreenshot' ? 30000 : 10000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Log.enable')
  const connection = { send, close: () => ws.close(), async evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  } }
  pages.add(connection)
  return connection
}
async function windowPage(kind) {
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    return (await response.json()).find((item) => item.type === 'page' && item.url.endsWith('#' + kind))
  }, kind + ' window', 20000)
  const expected = pathToFileURL(path.join(buildRoot, 'dist', 'index.html')).href + '#' + kind
  check(`${kind}: CDP is attached to this build`, decodeURI(target.url) === decodeURI(expected), target.url)
  const connection = await connect(target.webSocketDebuggerUrl)
  await until(() => connection.evaluate('Boolean(window.whitebox && document.querySelector(".win"))'), kind + ' renderer ready')
  await connection.send('Page.bringToFront')
  return connection
}
function processSnapshot(inventory = readWindowsProcesses()) {
  processObservation = ownedProcesses.observe(inventory)
  fs.writeFileSync(path.join(RUN, 'owned-process-observation.json'), JSON.stringify(processObservation, null, 2))
  return processObservation.remaining
}
const nativeHelperSource = "using System; using System.Runtime.InteropServices; public static class QaWindow { [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr h); [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr h,int mode); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }"
const nativeHelperCS = path.join(RUN, 'native-window-helper.cs')
const nativeHelperDLL = path.join(RUN, 'native-window-helper.dll')
const nativeHelperInvocations = []
const psQuote = value => "'" + String(value).replaceAll("'", "''") + "'"
function nativeShell(command, label, timeout = 5000) {
  const startedAt = Date.now()
  const prefix = '$qaShell=Get-Process -Id $PID;[pscustomobject]@{kind="native-helper-identity";pid=$PID;creationDate=$qaShell.StartTime.ToUniversalTime().ToString("o")} | ConvertTo-Json -Compress;'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);' + prefix + command], { encoding: 'utf8', windowsHide: true, timeout })
  const values = (result.stdout ?? '').split(/\r?\n/).filter(line => line.trim()).map(line => { try { return JSON.parse(line) } catch { return { unexpectedOutput: line } } })
  const identity = values.find(value => value.kind === 'native-helper-identity')
  const observation = { label, pid: result.pid, parentPid: process.pid, startedAt: new Date(startedAt).toISOString(), elapsedMs: Date.now() - startedAt, deadlineMs: timeout, creationDate: identity?.creationDate ?? null, identityMatches: identity?.pid === result.pid, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null }
  nativeHelperInvocations.push(observation)
  fs.appendFileSync(path.join(RUN, 'native-helper-invocations.jsonl'), JSON.stringify(observation) + '\n')
  assert.equal(result.status, 0, 'Native helper ' + label + ': ' + (result.error?.message ?? result.stderr))
  assert.ok(observation.identityMatches, 'Native helper PID is returned by its owned spawn')
  assert.ok(values.every(value => !value.unexpectedOutput), 'Native helper returns only structured measurements')
  return values.filter(value => value.kind !== 'native-helper-identity').at(-1)
}
function ensureNativeWindowHelper() {
  if (runtime.nativeHelper) {
    assert.equal(createHash('sha256').update(fs.readFileSync(nativeHelperDLL)).digest('hex'), runtime.nativeHelper.dllSha256, 'The run-specific native DLL stays unchanged')
    return
  }
  fs.writeFileSync(nativeHelperCS, nativeHelperSource, 'utf8')
  nativeShell('Add-Type -Path ' + psQuote(nativeHelperCS) + ' -OutputAssembly ' + psQuote(nativeHelperDLL) + ';[pscustomobject]@{compiled=(Test-Path -LiteralPath ' + psQuote(nativeHelperDLL) + ')} | ConvertTo-Json -Compress', 'compile', 20000)
  const preflight = nativeShell('Add-Type -Path ' + psQuote(nativeHelperDLL) + ';[pscustomobject]@{invalidVisible=[QaWindow]::IsWindowVisible([IntPtr]::Zero);invalidIconic=[QaWindow]::IsIconic([IntPtr]::Zero)} | ConvertTo-Json -Compress', 'DLL preflight')
  assert.ok(preflight && !preflight.invalidVisible && !preflight.invalidIconic, 'The actual Win32 DLL rejects an invalid HWND')
  const copyRoot = path.join(RUN, 'native-helper-runtime')
  fs.mkdirSync(copyRoot)
  fs.copyFileSync(nativeHelperCS, path.join(copyRoot, 'native-window-helper.cs'))
  fs.copyFileSync(nativeHelperDLL, path.join(copyRoot, 'native-window-helper.dll'))
  runtime.nativeHelper = { sourceFile: nativeHelperCS, sourceSha256: createHash('sha256').update(fs.readFileSync(nativeHelperCS)).digest('hex'), dllFile: nativeHelperDLL, dllSha256: createHash('sha256').update(fs.readFileSync(nativeHelperDLL)).digest('hex'), compileDeadlineMs: 20000, probeDeadlineMs: 5000, preflight, runtimeCopy: copyRoot }
  fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2))
}

function nativeMainWindow(restore = false) {
  ensureNativeWindowHelper()
  const identity = readWindowsProcesses().find((item) => item.ProcessId === child.pid)
  assert.ok(identity && sameProcess(childIdentity, identity), 'Native visibility is measured on the owned Electron')
  const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);
    Add-Type -Path ${psQuote(nativeHelperDLL)};
    $owned=Get-Process -Id ${child.pid} -ErrorAction Stop; $owned.Refresh(); $handle=$owned.MainWindowHandle; [uint32]$windowOwner=0;
    [void][QaWindow]::GetWindowThreadProcessId($handle,[ref]$windowOwner);
    if($windowOwner -ne ${child.pid}) { throw "Owned window PID changed" }; $wasIconic=[QaWindow]::IsIconic($handle);
    if(${restore ? "$true" : "$false"}) { if($wasIconic) { [void][QaWindow]::ShowWindowAsync($handle,9) }; [void][QaWindow]::SetForegroundWindow($handle) };
    [pscustomobject]@{pid=$owned.Id;windowPid=$windowOwner;handle=$handle.ToInt64();title=$owned.MainWindowTitle;visible=[QaWindow]::IsWindowVisible($handle);iconic=[QaWindow]::IsIconic($handle);wasIconic=$wasIconic;restoreRequested=${restore ? "$true" : "$false"}} | ConvertTo-Json -Compress`
  return nativeShell(command, restore ? 'owned restore/probe' : 'owned read-only probe')
}
async function launch(label) {
  ensureNativeWindowHelper()
  port = await freePort()
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  appLog = path.join(RUN, `${label}-app.log`)
  const log = fs.openSync(appLog, 'a')
  const args = ['--hidden', '--open=main', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`]
  if (!process.env.WHITEBOX_EXE) args.unshift(ROOT)
  const launchStartedAt = Date.now()
  child = spawn(electron, args, { cwd: ROOT, env, stdio: ['ignore', log, log], windowsHide: true })
  fs.closeSync(log)
  child.once('error', (error) => { errors.push({ launch: label, error: error.message }) })
  assert.ok(child.pid, 'Electron has an owned PID')
  const inventory = readWindowsProcesses()
  childIdentity = inventory.find((process) => process.ProcessId === child.pid)
  assert.ok(childIdentity && child.exitCode === null && child.signalCode === null, 'Launched Electron is live when its identity is registered')
  ownedProcesses.registerRoot(childIdentity, { parentPid: process.pid, name: path.basename(electron), notBefore: launchStartedAt })
  processSnapshot(inventory)
  const native = await until(() => { const value = nativeMainWindow(true); return value.visible && !value.iconic && value.windowPid === child.pid && value.title === 'White Box' ? value : null }, 'owned native Main window visible', 20000)
  fs.writeFileSync(path.join(RUN, label + '-native-window.json'), JSON.stringify(native, null, 2))
  check(label + ': owned native Main window is visible', native.visible && native.windowPid === child.pid, native)
  page = await windowPage('main')
  await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs"))'), 'main navigation ready')
  fs.writeFileSync(path.join(RUN, `${label}-processes.json`), JSON.stringify(processSnapshot(), null, 2))
}
async function stop(label) {
  const current = child
  assert.ok(current, 'An owned app is running')
  processSnapshot()
  const quitStartedAt = Date.now()
  const beforeQuit = await page.evaluate('({calendarEditors:document.querySelectorAll(".calendar-editor").length,budgetEditors:document.querySelectorAll(".week-budget-dialog").length,errors:[...document.querySelectorAll(".task-command-error[role=alert]")].map(el=>el.textContent)})')
  check(label + ': quit begins after all editors and save errors are closed', beforeQuit.calendarEditors===0 && beforeQuit.budgetEditors===0 && beforeQuit.errors.length===0, beforeQuit)
  let quitError = null
  try { await page.evaluate('void window.whitebox.call("app:quit")') } catch (error) { quitError = error.message }
  await until(() => current.exitCode !== null || current.signalCode !== null, 'natural process exit', 30000)
  const remaining = await until(() => { const alive = processSnapshot(); return alive.length === 0 ? [] : false }, 'owned descendants exit', 10000)
  for (const connection of pages) connection.close()
  pages.clear()
  const observation = { quitStartedAt: new Date(quitStartedAt).toISOString(), quitElapsedMs: Date.now() - quitStartedAt, beforeQuit, pid: current.pid, creationDate: childIdentity.CreationDate, quitError, exitCode: current.exitCode, signalCode: current.signalCode, forcedCleanup: false, remaining, reused: processObservation.reused }
  fs.writeFileSync(path.join(RUN, `${label}-shutdown.json`), JSON.stringify(observation, null, 2))
  check(`${label}: natural quit exits with zero and leaves no owned PID`, current.exitCode === 0 && current.signalCode === null && remaining.length === 0, observation)
  child = undefined
  page = undefined
}
const read = () => JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'))
async function raw(name, args = {}) { return page.evaluate(`window.whitebox.call(${JSON.stringify(name)},${JSON.stringify(args)})`) }
async function call(name, args = {}) { const response = await raw(name, args); assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`); return response.data }
const exposedDatabaseFields = ['projects', 'tasks', 'sessions', 'settings', 'dayNotes', 'taskSuggestions', 'notes', 'goalMap', 'presenceCandidates', 'weeklyBudgets', 'weeklyBudgetDefaults', 'fixedWork', 'calendarBlocks']
const stateMatchesDatabase = (state, database) => exposedDatabaseFields.every((field) => isDeepStrictEqual(state[field], database[field]))
async function screenshot(name, selector, alignment = 'start') {
  const native = await until(() => { const value = nativeMainWindow(true); return value.visible && !value.iconic && value.windowPid === child.pid ? value : null }, 'owned capture window is visible and not minimized')
  fs.appendFileSync(path.join(RUN, 'screenshot-native-observations.jsonl'), JSON.stringify({ at: new Date().toISOString(), name, native }) + '\n')
  await page.send('Page.bringToFront')
  if (selector) await page.evaluate(`(() => { const target=document.querySelector(${JSON.stringify(selector)}); if(!target) throw Error('Missing screenshot target'); target.scrollIntoView({block:${JSON.stringify(alignment)}}); })()`)
  await wait(350)
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
}
async function key(key, code, modifiers = 0) {
  const params = { key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Enter: 13, ArrowDown: 40, Home: 36, Escape: 27, Tab: 9 }[key] ?? 0) }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}
async function click(selector) {
  const point = await until(() => page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled) return null; for(let ancestor=el;ancestor;ancestor=ancestor.parentElement) if(ancestor.getAnimations().some(animation=>animation.playState==='running' && animation.effect?.getTiming().iterations!==Infinity)) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const p={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && p.x>0 && p.x<innerWidth && p.y>0 && p.y<innerHeight && el.contains(document.elementFromPoint(p.x,p.y)) ? p : null })()`), selector)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait(100)
}
async function button(text, scope = 'body') {
  const selector = await page.evaluate(`(() => { const all=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})]; const el=all.find(el=>el.textContent.trim()===${JSON.stringify(text)}); if(!el) return null; el.setAttribute('data-week-e2e-click','true'); return '[data-week-e2e-click="true"]' })()`)
  assert.ok(selector, `button ${text} in ${scope}`)
  await click(selector)
  try { await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-week-e2e-click')`) } catch (error) { if (!/closed|context|target/i.test(error.message)) throw error }
}
async function fill(selector, value) { await click(selector); await key('a', 'KeyA', 2); await page.send('Input.insertText', { text: value }) }
async function select(selector, value) {
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled || ![...el.options].some(option=>option.value===${JSON.stringify(value)})) throw Error('Missing select option'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await wait(100)
  const expected = selector === '[aria-label="配分するプロジェクトを追加"]' ? '' : value
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), expected, `Select ${selector} accepts ${value}`)
}
async function tab(number, selector) { await key(String(number), 'Digit' + number, 2); await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector) }
const faultPath = path.join(DATA, 'data.json.tmp')
function beginExpectedErrors(label, commands, kind) {
  const observation = { label, file: path.basename(appLog), start: fs.statSync(appLog).size, end: null, commands, kind }
  expectedErrorWindows.push(observation)
  return observation
}
function endExpectedErrors(observation) { observation.end = fs.statSync(path.join(RUN, observation.file)).size }
function beginSaveFault(label, commands) {
  assert.equal(path.dirname(faultPath), DATA)
  assert.equal(path.dirname(DATA), RUN)
  assert.equal(path.dirname(RUN), OUTPUT)
  assert.equal(fs.existsSync(faultPath), false, 'The isolated temporary save path starts absent')
  fs.mkdirSync(faultPath)
  faultOwned = true
  faultLog = beginExpectedErrors(label, commands, 'filesystem')
  assert.throws(() => fs.writeFileSync(faultPath, 'fault probe'), /EISDIR|EACCES|EPERM/, 'The real filesystem write must fail')
}
function endSaveFault() { if (faultOwned) { endExpectedErrors(faultLog); faultLog = undefined; assert.equal(fs.readdirSync(faultPath).length, 0); fs.renameSync(faultPath, path.join(RUN, 'completed-save-fault-' + Date.now())); faultOwned = false } }
function applicationErrors() {
  const expected = [], unexpected = []
  for (const file of fs.readdirSync(RUN).filter((file) => file.endsWith('-app.log'))) {
    let offset = 0
    for (const rawLine of fs.readFileSync(path.join(RUN, file), 'utf8').split(/(?<=\n)/)) {
      const line = rawLine.trimEnd(), at = offset
      offset += Buffer.byteLength(rawLine)
      if (!/uncaught|unhandled\s*(?:promise|rejection)|\[white-box\].*(?:失敗|できません|読めなかった|窓を閉じません)/i.test(line)) continue
      const record = { file, offset: at, line }
      const command = line.match(/\[white-box\] コマンド失敗:\s+(\S+)/)?.[1] ?? (line.includes('[white-box] 入力の保存を待つため窓を閉じません:') ? 'window:close' : null)
      const window = expectedErrorWindows.find((item) => item.file === file && item.start <= at && item.end > at && item.commands.includes(command))
      const known = window && !/uncaught|unhandled/i.test(line) && (
        window.kind === 'filesystem' && (/EISDIR|EACCES|EPERM/.test(line) && line.includes(faultPath) || ['session:end', 'session:switchTask', 'window:close'].includes(command) && line.includes('入力を保存できなかったため、操作を取り消しました。')) ||
        window.kind === 'validation' && /ZodError/.test(line) || window.kind === 'native-import' && /SyntaxError/.test(line))
      if (known) expected.push({ ...record, reason: window.label })
      else unexpected.push(record)
    }
  }
  return { expected, unexpected }
}
async function unchangedAfterFailure(before, label, memoryBefore = before) {
  const state = await call('state:get')
  check(label + ': disk and exposed memory roll back completely', isDeepStrictEqual(read(), before) && stateMatchesDatabase(state, memoryBefore))
}

const MINUTE = 60_000
const calendar = (value) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const shift = (key, days) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return calendar(date) }
const at = (key, hour, minute = 0) => { const date = new Date(`${key}T00:00:00`); date.setHours(hour, minute, 0, 0); return date.getTime() }
const localDateTime = (value) => { const date = new Date(value); return `${calendar(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
const monday = new Date()
monday.setHours(0, 0, 0, 0)
monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
const thisWeek = calendar(monday), nextWeek = shift(thisWeek, 7)
const labels = ['Calendar Alpha', 'Calendar Beta', 'Calendar Gamma']
let projects, tasks, fixedTask, baselineSessions, uiBlock, recurringBlock, projectBlock, draggedBlock, persisted

async function navigateWeek() { await tab(8, '.week-workspace'); await until(() => page.evaluate('document.querySelectorAll(".calendar-day-header[data-calendar-day]").length===7'), 'seven calendar headers') }
async function nativeValue(selector, value, expected = value) {
  await click(selector)
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await until(() => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(expected)}`), selector + ' accepts input')
}
async function createDialog() { await click('[aria-label="予定を追加"]'); await until(() => page.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("予定をつくる")'), 'create calendar dialog') }
async function form(title, start, end, category = 'work') {
  await fill('[role="dialog"] [aria-label="タイトル"]', title)
  await nativeValue('[role="dialog"] [aria-label="開始"]', localDateTime(start))
  await nativeValue('[role="dialog"] [aria-label="終了"]', localDateTime(end))
  await select('[role="dialog"] [aria-label="種類"]', category)
}
async function saveCalendar(title) {
  await button('予定を保存', '[role="dialog"]')
  await until(() => !page || page.evaluate('!document.querySelector("[role=dialog]")'), 'saved calendar modal closes')
  await until(() => read().calendarBlocks?.some((item) => item.title === title && !item.cancelled), title + ' persisted')
  return read().calendarBlocks.find((item) => item.title === title && !item.cancelled)
}
async function editCalendar(id) { await click(`[data-calendar-block-id="${id}"]`); await until(() => page.evaluate('document.querySelector("[role=dialog]")?.innerText.includes("予定を編集")'), 'edit calendar dialog') }
async function discardCalendar() {
  await button('閉じる', '[role="dialog"]')
  if (await page.evaluate('Boolean(document.querySelector(".calendar-confirm"))')) await button('入力を破棄して閉じる', '[role="dialog"]')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'calendar dialog closes')
}
async function recorded(taskId, start, end, note) {
  const session = await call('session:start', { taskId, mode: 'stopwatch' })
  await call('session:end')
  await call('session:skipReview')
  await call('session:update', { id: session.id, patch: { startedAt: start, endedAt: end, note } })
  return session.id
}
async function createFixture() {
  const initial = await call('state:get')
  check('Isolated profile starts with no projects, tasks or sessions', initial.projects.length === 0 && initial.tasks.length === 0 && initial.sessions.length === 0)
  const now = Date.now(), today = calendar(now - 4 * 60 * MINUTE)
  await call('settings:update', { patch: { onboardedAt: now, lastWelcomeDate: today, dayStartHour: 4, showSessionCard: false, soundOnExpire: false, autoPauseOnSuspend: false, launchAtLogin: false, shortcuts: { startPause: '', currentWork: '', dashboard: '' } } })
  await page.send('Page.reload')
  await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs")) && !document.querySelector(".onboarding") && !document.querySelector(".welcome")'), 'isolated onboarding dismissed')
  projects = []
  tasks = []
  for (let index = 0; index < 3; index++) {
    projects.push(await call('project:create', { name: labels[index] }))
    tasks.push(await call('task:create', { title: index === 2 ? '短い記録と、予定が重なっても読み取れる長いタイトルの実作業 ' + '具体的な調査事項を保持する '.repeat(8) : labels[index] + ' の実作業', projectId: projects[index].id, status: 'todo' }))
  }
  fixedTask = await call('task:create', { title: '外部の固定ミーティング', projectId: projects[1].id, status: 'todo' })
  for (let index = 0; index < 7; index++) await recorded(tasks[index % 3].id, at(shift(thisWeek, index), 9), at(shift(thisWeek, index), 10), '実IPCで作成した日別記録 ' + index)
  await recorded(tasks[1].id, at(thisWeek, 9, 30), at(thisWeek, 10, 30), '重なる記録の追加30分')
  await recorded(tasks[2].id, at(shift(thisWeek, 2), 12), at(shift(thisWeek, 2), 12) + 20_000, '20秒の短い記録')
  await recorded(tasks[0].id, at(shift(thisWeek, 5), 23, 30), at(shift(thisWeek, 6), 0, 30), '夜を跨ぐ60分の記録')
  await recorded(tasks[0].id, at(thisWeek, 0, 15), at(thisWeek, 0, 45), '設定した日境界4時より前でも暦の月曜に属する30分')
  const paused = await call('session:start', { taskId: tasks[2].id, mode: 'stopwatch' })
  await wait(250)
  await call('session:pause')
  await wait(650)
  await call('session:resume')
  await wait(250)
  await call('session:end')
  await call('session:skipReview')
  const ended = read().sessions.find((item) => item.id === paused.id)
  const start = ended.endedAt - 10 * MINUTE
  await call('session:update', { id: paused.id, patch: { startedAt: start, exclusions: [{ startedAt: start, endedAt: start + 2 * MINUTE }], note: '観測された一時停止と申告された除外を持つ記録' } })
  const fixedNow = Date.now(), fixedSlot = Math.floor(Math.min(60 * MINUTE, (at(nextWeek, 0) - fixedNow) / 4))
  assert.ok(fixedSlot > MINUTE, 'This fixture has room for a future fixed appointment within the current week')
  await call('fixedWork:create', { taskId: fixedTask.id, startedAt: fixedNow + fixedSlot, endedAt: fixedNow + 2 * fixedSlot, externalReason: '他者と合意したミーティング' })
  const input = { title: '先に置いた作業予定', category: 'work', taskId: tasks[0].id, projectId: projects[0].id, startedAt: at(thisWeek, 9, 15), endedAt: at(thisWeek, 10, 15), repeat: 'none', weekdays: [], until: null }
  await call('calendar:create', input)
  await call('calendar:create', { ...input, title: '重なる予定 ' + '長いタイトルでも他の予定を選べる '.repeat(10), taskId: null, projectId: projects[1].id, startedAt: at(thisWeek, 9, 30), endedAt: at(thisWeek, 11) })
  await call('calendar:create', { ...input, title: '睡眠の定型時間', category: 'sleep', taskId: null, projectId: null, startedAt: at(thisWeek, 23), endedAt: at(shift(thisWeek, 1), 7), repeat: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], until: shift(nextWeek, 6) })
  await call('calendar:create', { ...input, title: '定型の食事', category: 'meal', taskId: null, projectId: null, startedAt: at(thisWeek, 12, 30), endedAt: at(thisWeek, 13), repeat: 'weekly', weekdays: [1, 3, 5], until: shift(nextWeek, 6) })
  await call('weeklyBudget:set', { weekStart: thisWeek, plan: { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 420, allocations: [] } })
  baselineSessions = read().sessions
  const pausedSaved = baselineSessions.find((item) => item.id === paused.id)
  check('Fixture preserves observed pauses and separate declared exclusions', pausedSaved.pauses.some((pause) => pause.reason === 'manual' && pause.endedAt > pause.startedAt) && pausedSaved.pauses.some((pause) => pause.reason === 'excluded' && pause.endedAt - pause.startedAt === 2 * MINUTE))
  check('All fixture records were created through IPC', baselineSessions.length === 12 && baselineSessions.every((session) => session.editedAt !== null))
  fs.writeFileSync(path.join(RUN, 'fixture-database.json'), JSON.stringify(read(), null, 2))
}

function expectedFocusMs(from, to) {
  const endpoints = [...new Set([from, to, ...baselineSessions.flatMap((session) => [session.startedAt, session.endedAt, ...session.pauses.flatMap((pause) => [pause.startedAt, pause.endedAt])])])].filter((value) => value >= from && value <= to).sort((a, b) => a - b)
  return endpoints.slice(0, -1).reduce((total, start, index) => {
    const end = endpoints[index + 1], midpoint = (start + end) / 2
    return total + (baselineSessions.some((session) => session.startedAt <= midpoint && session.endedAt > midpoint && !session.pauses.some((pause) => pause.startedAt <= midpoint && pause.endedAt > midpoint)) ? end - start : 0)
  }, 0)
}
function displayedMinutes(value) {
  const match = value.replace(/\s/g, '').match(/^(?:(\d+)h)?(?:(\d+)m)?$/)
  assert.ok(match && (match[1] || match[2]), 'Valid displayed duration: ' + value)
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

async function calendarSurface() {
  await until(() => page.evaluate("(() => { const root=document.querySelector('.week-workspace'); if(!root)return false; for(let ancestor=root;ancestor;ancestor=ancestor.parentElement)if(ancestor.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations!==Infinity))return false; return true; })()"), 'finite calendar entrance motion finishes', 10000)
  return page.evaluate("(() => { const rect=el=>el.getBoundingClientRect().toJSON(), main=document.querySelector('.main-content'), calendar=document.querySelector('.week-calendar'), scroll=document.querySelector('.calendar-scroll'), header=document.querySelector('.week-workspace-head'), secondary=document.querySelector('.week-secondary'); return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,main:{...rect(main),clientWidth:main.clientWidth,clientHeight:main.clientHeight,scrollTop:main.scrollTop,scrollHeight:main.scrollHeight},header:rect(header),calendar:rect(calendar),scroll:{...rect(scroll),scrollTop:scroll.scrollTop,clientHeight:scroll.clientHeight,scrollHeight:scroll.scrollHeight},hourHeight:document.querySelector('.calendar-day-column').getBoundingClientRect().height/24,zoom:[...document.querySelectorAll('.week-zoom-switch button')].map(el=>({text:el.textContent,pressed:el.getAttribute('aria-pressed')})),days:[...document.querySelectorAll('.calendar-day-header')].map(el=>({key:el.dataset.calendarDay,...rect(el)})),axis:[...document.querySelectorAll('.calendar-axis > span')].map(el=>({label:el.textContent,...rect(el),fontSize:parseFloat(getComputedStyle(el).fontSize)})),secondary:rect(secondary),overview:rect(document.querySelector('.week-overview')),budget:rect(document.querySelector('.week-budget-panel')),overflow:[document.documentElement,document.body,main,calendar].map(el=>({className:el.className,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}))}; })()")
}
function primaryCalendarFits(surface) {
  return surface.days.length===7 && surface.days.every(day=>day.x>=surface.main.left-1 && day.right<=surface.main.right+1 && day.top>=0 && day.bottom<=surface.height && day.width>=28) && surface.calendar.width>=surface.main.clientWidth*.97 && surface.calendar.height>=Math.min(surface.main.bottom,surface.height)-surface.header.bottom-4 && surface.calendar.bottom<=Math.min(surface.main.bottom,surface.height)+2 && surface.secondary.top>=Math.min(surface.main.bottom,surface.height)-2 && surface.main.scrollTop===0 && surface.overflow.every(box=>box.scrollWidth-box.clientWidth<=1)
}
async function scrollMainTo(selector, block='center') {
  await page.evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:'+JSON.stringify(block)+'})')
  await wait(150)
  return page.evaluate('(() => { const element=document.querySelector('+JSON.stringify(selector)+'),main=document.querySelector(".main-content"),r=element.getBoundingClientRect(),m=main.getBoundingClientRect();return {scrollTop:main.scrollTop,element:r.toJSON(),main:m.toJSON(),visible:r.width>0&&r.height>0&&r.top>=m.top-1&&r.bottom<=Math.min(m.bottom,innerHeight)+1};})()')
}
function sparseAxis(surface, step) {
  const expected=Array.from({length:24/step+1},(_,index)=>String(index*step).padStart(2,'0')+':00')
  return isDeepStrictEqual(surface.axis.map(entry=>entry.label),expected) && surface.axis.every(entry=>entry.fontSize>=12) && surface.axis.slice(1).every((entry,index)=>surface.axis[index].bottom<=entry.top+.5)
}
async function resetPrimary() {
  await page.evaluate('document.querySelector(".main-content").scrollTop=0')
  await button('拡大','.week-workspace')
  await page.evaluate('document.querySelector(".main-content").scrollTop=0;document.querySelector(".calendar-scroll").scrollTop=336')
  await wait(150)
}
async function verifyEventCaptions(label) {
  const values=await page.evaluate("(() => { const rect=el=>el?.getBoundingClientRect().toJSON()??null,scroll=document.querySelector('.calendar-scroll').getBoundingClientRect(),header=document.querySelector('.calendar-day-header').getBoundingClientRect(); const collect=el=>{const box=el.getBoundingClientRect(),style=getComputedStyle(el),title=el.querySelector('.calendar-event-title'),time=el.querySelector('.calendar-event-time'),ts=getComputedStyle(title);return {text:el.title,narrow:el.classList.contains('is-narrow'),event:box.toJSON(),title:rect(title),time:rect(time),innerTop:box.top+parseFloat(style.borderTopWidth)+parseFloat(style.paddingTop),innerBottom:box.bottom-parseFloat(style.borderBottomWidth)-parseFloat(style.paddingBottom),whiteSpace:ts.whiteSpace,textOverflow:ts.textOverflow,lineHeight:parseFloat(ts.lineHeight)}}; const actual=[...document.querySelectorAll('[data-calendar-event=actual]')].filter(el=>!el.classList.contains('is-narrow')&&Math.abs(el.getBoundingClientRect().height-56)<.5&&el.getBoundingClientRect().top>=header.bottom&&el.getBoundingClientRect().bottom<=scroll.bottom).map(collect);const narrow=[...document.querySelectorAll('.calendar-day-column:first-of-type .is-narrow, .calendar-event.is-narrow')].filter(el=>el.getBoundingClientRect().top>=header.bottom&&el.getBoundingClientRect().bottom<=scroll.bottom).map(collect);const sleep=[...document.querySelectorAll('[data-calendar-event=routine]')].filter(el=>el.title.includes('睡眠')&&el.getBoundingClientRect().top<header.bottom&&el.getBoundingClientRect().bottom>header.bottom+20&&el.getBoundingClientRect().bottom<scroll.bottom).map(collect);return {actual,narrow,sleep,visibleTop:header.bottom,visibleBottom:scroll.bottom};})()")
  check(label+': visible one-hour cards retain title and time inside button content',values.actual.length>0&&values.actual.every(item=>item.time&&item.title.top>=item.innerTop-.5&&item.time.bottom<=item.innerBottom+.5),values.actual)
  check(label+': narrow overlapping lanes use single-line ellipsis without partial time text',values.narrow.length>=3&&values.narrow.every(item=>item.whiteSpace==='nowrap'&&item.textOverflow==='ellipsis'&&item.title.height<=item.lineHeight+.5&&!item.time),values.narrow)
  check(label+': overnight sleep captions and times stay visible at the 06:00 viewport start',values.sleep.filter(item=>!item.narrow).length>=5&&values.sleep.every(item=>item.title.top>=values.visibleTop-.5&&item.title.bottom<=Math.min(values.visibleBottom,item.innerBottom)+.5&&(item.narrow?!item.time&&item.whiteSpace==='nowrap'&&item.textOverflow==='ellipsis':item.time&&item.time.bottom<=Math.min(values.visibleBottom,item.innerBottom)+.5)),values.sleep)
  return values
}
async function verifyCaptionBoundary() {
  await createFixture()
  const diagnosticTask=await call('task:create',{title:'58分境界の長いタイトルを省略して表示する '.repeat(5),projectId:projects[1].id,status:'todo'})
  const diagnosticSession=await recorded(diagnosticTask.id,at(shift(thisWeek,1),14),at(shift(thisWeek,1),14)+58*MINUTE,'58分の表示境界だけを測る独立診断記録')
  const sleep=read().calendarBlocks.find(block=>block.category==='sleep')
  await call('calendar:update',{id:sleep.id,patch:{title:'長い睡眠の継続キャプションを二行で読む '.repeat(5)}})
  await navigateWeek()
  await calendarSurface()
  const collect=()=>page.evaluate("(() => {const rect=el=>el?.getBoundingClientRect().toJSON()??null,header=document.querySelector('.calendar-day-header').getBoundingClientRect(),scroll=document.querySelector('.calendar-scroll');const row=el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el),title=el.querySelector('.calendar-event-title'),time=el.querySelector('.calendar-event-time');return {text:el.title,event:r.toJSON(),short:el.classList.contains('is-short'),narrow:el.classList.contains('is-narrow'),title:rect(title),time:rect(time),lineHeight:parseFloat(getComputedStyle(title).lineHeight),lineClamp:getComputedStyle(title).getPropertyValue('-webkit-line-clamp'),innerBottom:r.bottom-parseFloat(style.paddingBottom)-parseFloat(style.borderBottomWidth),visibleHeight:r.bottom-header.bottom}};return {short:[...document.querySelectorAll('[data-calendar-event=actual]')].filter(el=>el.title.includes('58分境界')).map(row),normal:[...document.querySelectorAll('[data-calendar-event=actual]')].filter(el=>Math.abs(el.getBoundingClientRect().height-56)<.5&&!el.classList.contains('is-narrow')&&el.getBoundingClientRect().top>=header.bottom&&el.getBoundingClientRect().bottom<=scroll.getBoundingClientRect().bottom).map(row),sleep:[...document.querySelectorAll('[data-calendar-event=routine]')].filter(el=>el.title.includes('長い睡眠')&&!el.classList.contains('is-narrow')&&el.getBoundingClientRect().top<header.bottom&&el.getBoundingClientRect().bottom>header.bottom&&el.getBoundingClientRect().bottom<scroll.getBoundingClientRect().bottom).map(row),visibleTop:header.bottom,visibleBottom:scroll.getBoundingClientRect().bottom,scrollTop:scroll.scrollTop}})()")
  const initial=await collect()
  check('A real 58-minute actual record renders as a short single-line title without time',initial.short.length===1&&initial.short[0].short&&!initial.short[0].time&&initial.short[0].lineClamp==='1'&&initial.short[0].title.height<=initial.short[0].lineHeight+.5&&Math.abs(initial.short[0].event.height-58/60*56)<.1,initial.short)
  check('Normal 60-minute actual cards retain their two-line title and time inside content bounds',initial.normal.some(item=>Math.abs(item.title.height-2*item.lineHeight)<.5)&&initial.normal.every(item=>!item.short&&item.time&&item.time.bottom<=item.innerBottom+.5),initial.normal)
  await screenshot('01-caption-58-minute-boundary')
  const surface=await calendarSurface(),point={x:surface.scroll.left+25,y:surface.scroll.top+150}
  await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-14})
  await until(()=>page.evaluate('Math.abs(document.querySelector(".calendar-scroll").scrollTop-322)<1'),'real wheel reaches 05:45')
  await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:14})
  await until(()=>page.evaluate('Math.abs(document.querySelector(".calendar-scroll").scrollTop-336)<1'),'real wheel reaches the sleep caption end with 56px visible')
  await wait(150)
  const terminal=await collect()
  check('Long two-line sleep captions fit inside their event and viewport while at least 56px remains visible',terminal.sleep.length>=5&&terminal.sleep.every(item=>item.visibleHeight>=55.5&&Math.abs(item.title.height-2*item.lineHeight)<.5&&item.time&&item.title.top>=terminal.visibleTop-.5&&item.time.bottom<=Math.min(item.innerBottom,terminal.visibleBottom)+.5),terminal.sleep)
  await screenshot('02-long-sleep-caption-terminal')
  check('The independent caption probe preserves all twelve original fixture sessions',isDeepStrictEqual(read().sessions.filter(session=>session.id!==diagnosticSession),baselineSessions))
  const savedSleep=read().calendarBlocks.find(block=>block.id===sleep.id)
  check('Caption diagnostics preserve the original sleep timestamps and recurrence fields',savedSleep.startedAt===sleep.startedAt&&savedSleep.endedAt===sleep.endedAt&&savedSleep.repeat===sleep.repeat&&isDeepStrictEqual(savedSleep.weekdays,sleep.weekdays)&&savedSleep.until===sleep.until)
  fs.writeFileSync(path.join(RUN,'caption-boundary-measurement.json'),JSON.stringify({diagnosticTask,diagnosticSession,initial,terminal,baselineSessionCount:baselineSessions.length},null,2))
  const appErrors=applicationErrors()
  fs.writeFileSync(path.join(RUN,'application-errors.json'),JSON.stringify(appErrors,null,2))
  check('Caption boundary probe has no renderer or unexpected app errors',errors.length===0&&appErrors.unexpected.length===0,{renderer:errors,app:appErrors})
  await stop('boundary')
}

async function verifyPreviewScreens() {
  await createFixture()
  for(let index=0;index<3;index++) {
    await call('project:update',{id:projects[index].id,patch:{name:['White Box','Quri','研究・学習'][index]}})
    await call('task:update',{id:tasks[index].id,patch:{title:['週間カレンダーの実装','定例ミーティング','論文を読む'][index]}})
  }
  await navigateWeek()
  const observations=[]
  for(const [label,width,height]of (previewInitialOnly?[['01-preview-native',null,null],['03-preview-900x650',900,650]]:[['01-preview-native',null,null],['02-preview-1440x900',1440,900],['03-preview-900x650',900,650]])) {
    if(width) { await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); await page.evaluate('document.querySelector(".main-content").scrollTop=0;document.querySelector(".calendar-scroll").scrollTop=336') }
    await wait(250)
    await screenshot(label)
    const surface=await calendarSurface()
    fs.writeFileSync(path.join(RUN,label+'-layout.json'),JSON.stringify(surface,null,2))
    check(label+': full-width seven-day calendar fills the remaining initial main area and keeps secondary content below the fold',primaryCalendarFits(surface),surface)
    check(label+': expanded initial axis uses 56px per hour, 06:00 scroll start and two-hour labels',Math.abs(surface.hourHeight-56)<.1&&Math.abs(surface.scroll.scrollTop-336)<1&&isDeepStrictEqual(surface.axis.map(entry=>entry.label),Array.from({length:13},(_,index)=>String(index*2).padStart(2,'0')+':00'))&&surface.axis.every(entry=>entry.fontSize>=12),{hourHeight:surface.hourHeight,scrollTop:surface.scroll.scrollTop,axis:surface.axis.map(entry=>entry.label)})
    const captions=await verifyEventCaptions(label)
    observations.push({label,surface,captions})
  }
  let lower=null,edit=null
  if(!previewInitialOnly) {
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  await scrollMainTo('.week-secondary','start')
  await screenshot('04-preview-secondary-scroll')
  lower=await calendarSurface();edit=await scrollMainTo('[aria-label="時間予算を編集"]')
  check('Preview main scrolling reaches the budget editor and secondary overview',lower.main.scrollTop>0&&lower.secondary.top>=lower.main.top-1&&lower.overview.top>=lower.main.top&&lower.overview.bottom<=lower.height&&edit.visible,{lower,edit})
  }
  check('Preview layout actions preserve all fixture sessions',isDeepStrictEqual(read().sessions,baselineSessions))
  fs.writeFileSync(path.join(RUN,'preview-layouts.json'),JSON.stringify({observations,lower,edit,rendererErrors:errors},null,2))
  const appErrors=applicationErrors()
  fs.writeFileSync(path.join(RUN,'application-errors.json'),JSON.stringify(appErrors,null,2))
  check('Preview has no renderer or unexpected application errors',errors.length===0&&appErrors.unexpected.length===0,{renderer:errors,app:appErrors})
  await stop('preview')
}

async function verifyInitialCalendar() {
  await navigateWeek()
  const initial=await calendarSurface()
  check('Initial view devotes the full main width and remaining height to the seven-day calendar with secondary content below',primaryCalendarFits(initial),initial)
  check('Initial calendar starts at 06:00 with 56px hours and readable two-hour labels',Math.abs(initial.hourHeight-56)<.1&&Math.abs(initial.scroll.scrollTop-336)<1&&sparseAxis(initial,2),initial.axis)
  await screenshot('00-calendar-expanded-initial')
  await verifyEventCaptions('Initial calendar captions')
  await button('24時間', '.week-workspace')
  const surface = await page.evaluate(`(() => { const headers=[...document.querySelectorAll('.calendar-day-header[data-calendar-day]')]; return {days:headers.map(el=>el.dataset.calendarDay), layers:[...new Set([...document.querySelectorAll('[data-calendar-event]')].map(el=>el.dataset.calendarEvent))], short:[...document.querySelectorAll('[data-calendar-event="actual"]')].filter(el=>el.textContent.includes('短い記録')).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})), text:document.querySelector('.week-workspace').innerText}; })()`)
  check('Calendar shows Monday through Sunday in chronological order', isDeepStrictEqual(surface.days, Array.from({ length: 7 }, (_, index) => shift(thisWeek, index))), surface.days)
  check('Planned, actual, recurring and external fixed layers are all present', ['planned', 'actual', 'routine', 'fixed'].every((layer) => surface.layers.includes(layer)), surface.layers)
  check('Planning leaves all session records byte-for-byte unchanged', isDeepStrictEqual(read().sessions, baselineSessions) && (await call('state:get')).live === null)
  const actualTotals = await page.evaluate('({week:document.querySelector(".week-overview strong").textContent, days:[...document.querySelectorAll(".calendar-day-total")].map(el=>el.firstChild.textContent)})')
  const expectedDays = Array.from({ length: 7 }, (_, index) => Math.floor(expectedFocusMs(at(shift(thisWeek, index), 0), at(shift(thisWeek, index + 1), 0)) / MINUTE))
  check('Weekly and all seven daily actual totals match an independent interval sweep at calendar midnight', displayedMinutes(actualTotals.week) === Math.floor(expectedFocusMs(at(thisWeek, 0), at(nextWeek, 0)) / MINUTE) && isDeepStrictEqual(actualTotals.days.map(displayedMinutes), expectedDays), { actualTotals, expectedDays })
  const short = await page.evaluate('([...document.querySelectorAll(\'[data-calendar-column="' + shift(thisWeek, 2) + '"] [data-calendar-event="actual"]\')].find(el=>el.title.includes("12:00"))?.getBoundingClientRect().toJSON())')
  check('A 20-second record has a visible and selectable minimum height', short && short.height >= 17 && short.width > 6, short)
  await screenshot('01-calendar-24h')
  await button('拡大', '.week-workspace')
  await screenshot('02-calendar-expanded')
  for (const block of read().calendarBlocks.filter((item) => item.category === 'work')) {
    await editCalendar(block.id)
    check('Overlapping planned block is independently selectable: ' + block.id, await page.evaluate('document.querySelector(' + JSON.stringify('[aria-label="タイトル"]') + ').value===' + JSON.stringify(block.title)))
    await discardCalendar()
  }
  await click('[data-calendar-event="actual"]')
  check('An actual calendar event opens its original session record', await page.evaluate('document.querySelector(".week-event-detail")?.innerText.includes("実績の記録") && Boolean(document.querySelector(".week-event-detail .srow"))'))
  await button('閉じる', '[role="dialog"]')
  await button('予定', '.week-workspace')
  check('Planned-only layer hides actual activity while retaining planned time', await page.evaluate('document.querySelectorAll("[data-calendar-event=actual]").length===0 && document.querySelectorAll("[data-calendar-event=planned]").length>0'))
  await button('実績', '.week-workspace')
  check('Actual-only layer retains activity and hides every planned layer', await page.evaluate('document.querySelectorAll("[data-calendar-event=actual]").length>0 && document.querySelectorAll("[data-calendar-event=planned],[data-calendar-event=routine],[data-calendar-event=fixed]").length===0'))
  await button('予定・実績', '.week-workspace')
  await button('24時間', '.week-workspace')
}
async function verifyCreationEditingAndFailure() {
  await createDialog()
  await form('UIから作るタスクなしの予定', at(thisWeek, 13), at(thisWeek, 14))
  await button('閉じる', '[role="dialog"]')
  check('Unsaved close asks inside the modal and retains every input', await page.evaluate('document.querySelector(".calendar-confirm[role=alert]")?.textContent.includes("破棄") && document.querySelector("[aria-label=タイトル]").value==="UIから作るタスクなしの予定"'))
  await button('編集へ戻る', '[role="dialog"]')
  uiBlock = await saveCalendar('UIから作るタスクなしの予定')
  check('Task-free planned time persists without invented links', uiBlock.taskId === null && uiBlock.projectId === null && uiBlock.startedAt === at(thisWeek, 13) && uiBlock.endedAt === at(thisWeek, 14))
  await editCalendar(uiBlock.id)
  await fill('[role="dialog"] [aria-label="タイトル"]', 'UIで編集した作業予定')
  await select('[role="dialog"] [aria-label="プロジェクト"]', projects[0].id)
  await select('[role="dialog"] [aria-label="タスク"]', tasks[0].id)
  uiBlock = await saveCalendar('UIで編集した作業予定')
  check('Editing updates the existing planned block with project and task', uiBlock.projectId === projects[0].id && uiBlock.taskId === tasks[0].id)
  await createDialog()
  await form('プロジェクトだけの予定', at(shift(thisWeek, 1), 14), at(shift(thisWeek, 1), 15))
  await select('[role="dialog"] [aria-label="プロジェクト"]', projects[1].id)
  projectBlock = await saveCalendar('プロジェクトだけの予定')
  check('Project-only planned time persists with no task', projectBlock.projectId === projects[1].id && projectBlock.taskId === null)
  await editCalendar(projectBlock.id)
  await button('予定を取り消す', '[role="dialog"]')
  check('Cancellation requires a visible confirmation and preserves the block before confirmation', await page.evaluate('document.querySelector(".calendar-confirm[role=alert]")?.textContent.includes("取り消す")') && read().calendarBlocks.find((block) => block.id === projectBlock.id).cancelled === false)
  await button('取り消す', '[role="dialog"]')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'cancelled planned modal closes')
  check('Cancellation preserves planned history and hides the cancelled occurrence', read().calendarBlocks.find((block) => block.id === projectBlock.id).cancelled === true && await page.evaluate(`!document.querySelector('[data-calendar-block-id="${projectBlock.id}"]')`))
  await createDialog()
  await form('保存失敗でも残る予定', at(shift(thisWeek, 2), 14), at(shift(thisWeek, 2), 15))
  const before = read(), memoryBefore = await call('state:get')
  beginSaveFault('Calendar isolated write rejection', ['calendar:create'])
  try {
    await button('予定を保存', '[role="dialog"]')
    await until(() => page.evaluate('Boolean(document.querySelector(".calendar-editor [role=alert]"))'), 'calendar real filesystem save failure')
    check('Real save failure retains title and start/end in an operable modal', await page.evaluate(`document.querySelector('[role=dialog] [aria-label="タイトル"]').value==='保存失敗でも残る予定' && document.querySelector('[aria-label="開始"]').value===${JSON.stringify(localDateTime(at(shift(thisWeek, 2), 14)))} && !document.querySelector('[role=dialog] button[type=submit]').disabled`))
    await unchangedAfterFailure(before, 'Calendar save failure', memoryBefore)
    await key('2', 'Digit2', 2)
    check('Failed unsaved calendar input blocks navigation away', await page.evaluate('Boolean(document.querySelector(".week-workspace")) && Boolean(document.querySelector(".calendar-editor"))'))
    await screenshot('03-calendar-save-failure', '.calendar-editor [role="alert"]', 'center')
  } finally { endSaveFault() }
  await saveCalendar('保存失敗でも残る予定')
  check('Retry after the actual filesystem failure saves exactly one block', read().calendarBlocks.filter((block) => block.title === '保存失敗でも残る予定').length === 1)
}
async function verifyPreciseCalendarTimes() {
  const base = at(shift(thisWeek, 4), 9), startedAt = base + 12_345, endedAt = base + 32_345
  const input = { title: '秒とミリ秒を持つ20秒予定', category: 'work', taskId: null, projectId: null, startedAt, endedAt, repeat: 'none', weekdays: [], until: null }
  const original = await call('calendar:create', input)
  await editCalendar(original.id)
  await fill('[role="dialog"] [aria-label="タイトル"]', 'タイトルだけを変更した20秒予定')
  const titleOnly = await saveCalendar('タイトルだけを変更した20秒予定')
  check('A title-only UI edit preserves both second/millisecond timestamps of a 20-second block exactly', titleOnly.id === original.id && titleOnly.startedAt === startedAt && titleOnly.endedAt === endedAt && titleOnly.endedAt - titleOnly.startedAt === 20_000)
  await editCalendar(original.id)
  await nativeValue('[aria-label="開始"]', localDateTime(base - MINUTE))
  const startOnly = await saveCalendar(titleOnly.title)
  check('Changing only the start field preserves the unchanged precise end timestamp', startOnly.startedAt === base - MINUTE && startOnly.endedAt === endedAt)
  const second = await call('calendar:create', { ...input, title: '終了日時だけを変更する精密予定' })
  await editCalendar(second.id)
  await nativeValue('[aria-label="終了"]', localDateTime(base + MINUTE))
  const endOnly = await saveCalendar(second.title)
  check('Changing only the end field preserves the unchanged precise start timestamp', endOnly.startedAt === startedAt && endOnly.endedAt === base + MINUTE)
  await editCalendar(original.id)
  await screenshot('07c-short-timestamps-editor', '.calendar-editor', 'center')
  await discardCalendar()
  await call('calendar:update', { id: original.id, patch: { cancelled: true } })
  await call('calendar:update', { id: second.id, patch: { cancelled: true } })
  check('Precise-time probes leave all original sessions unchanged', isDeepStrictEqual(read().sessions, baselineSessions))
  fs.writeFileSync(path.join(RUN, 'precise-calendar-times.json'), JSON.stringify({ original, titleOnly, startOnly, second, endOnly, expected: { startedAt, endedAt, startISO: new Date(startedAt).toISOString(), endISO: new Date(endedAt).toISOString() } }, null, 2))
}
async function verifyPreciseFixedTime() {
  const future = new Date(Date.now() + 60 * MINUTE)
  future.setSeconds(0, 0)
  const startedAt = future.getTime() + 12_345, endedAt = future.getTime() + 32_345
  const original = await call('fixedWork:create', { taskId: fixedTask.id, startedAt, endedAt, externalReason: '秒とミリ秒を持つ検証専用の固定予定' })
  await click('[data-calendar-block-id="' + original.id + '"]')
  await until(() => page.evaluate('Boolean(document.querySelector(".week-event-detail"))'), 'precise fixed event detail')
  await button('外部固定予定を編集', '.week-event-detail')
  await until(() => page.evaluate('Boolean(document.querySelector("#fixed-work-editor-title"))'), 'precise fixed editor')
  await fill('[aria-label="時刻が固定される外部の理由"]', '理由だけを変更して精密日時を保持する')
  await screenshot('07d-fixed-precise-reason-edit', '#fixed-work-editor-title', 'center')
  await button('固定予定を保存', '[role="dialog"]')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'precise fixed reason edit closes')
  const reasonOnly = read().fixedWork.find((work) => work.id === original.id)
  check('A reason-only UI edit preserves both precise timestamps of a 20-second external fixed block', reasonOnly.externalReason === '理由だけを変更して精密日時を保持する' && reasonOnly.startedAt === startedAt && reasonOnly.endedAt === endedAt)
  await call('fixedWork:update', { id: original.id, patch: { cancelled: true } })
  check('The dedicated precise fixed probe changes no original session', isDeepStrictEqual(read().sessions, baselineSessions))
  fs.writeFileSync(path.join(RUN, 'precise-fixed-times.json'), JSON.stringify({ original, reasonOnly, expected: { startedAt, endedAt, startISO: new Date(startedAt).toISOString(), endISO: new Date(endedAt).toISOString() } }, null, 2))
}
async function verifyRecurring() {
  await createDialog()
  await form('UIから登録した夜跨ぎの定型時間', at(thisWeek, 22, 30), at(shift(thisWeek, 1), 6, 30), 'sleep')
  await click('[role="dialog"] [aria-label="毎週繰り返す"]')
  for (const label of ['月', '火', '水', '木', '金', '土', '日']) {
    const selector = '[aria-label="' + label + '曜日に繰り返す"]'
    const pressed = await page.evaluate('document.querySelector(' + JSON.stringify(selector) + ').getAttribute("aria-pressed")==="true"')
    if (pressed !== ['月', '水', '金'].includes(label)) await click(selector)
  }
  await nativeValue('[aria-label="繰り返しの終了日"]', shift(thisWeek, 9))
  recurringBlock = await saveCalendar('UIから登録した夜跨ぎの定型時間')
  check('Recurring overnight time persists three weekdays and an inclusive end date', recurringBlock.repeat === 'weekly' && isDeepStrictEqual(recurringBlock.weekdays.slice().sort(), [1, 3, 5]) && recurringBlock.until === shift(thisWeek, 9) && recurringBlock.endedAt - recurringBlock.startedAt === 8 * 60 * MINUTE)
  await editCalendar(recurringBlock.id)
  check('Recurring editor explicitly explains that edits and cancellation apply to the whole schedule', await page.evaluate('document.querySelector(".calendar-editor").innerText.includes("定型予定全体に適用")'))
  await nativeValue('[aria-label="終了"]', localDateTime(at(shift(thisWeek, 1), 7)))
  recurringBlock = await saveCalendar('UIから登録した夜跨ぎの定型時間')
  check('Editing a recurring schedule changes the original block as a whole', read().calendarBlocks.filter((block) => block.id === recurringBlock.id).length === 1 && recurringBlock.endedAt - recurringBlock.startedAt === 8.5 * 60 * MINUTE)
  await screenshot('04-recurring-planned-time')
  await createDialog()
  await form('取消を確認する定型食事', at(thisWeek, 18), at(thisWeek, 18, 30), 'meal')
  await click('[aria-label="毎週繰り返す"]')
  await button('毎日', '[role="dialog"]')
  const cancelled = await saveCalendar('取消を確認する定型食事')
  await editCalendar(cancelled.id)
  await button('予定を取り消す', '[role="dialog"]')
  check('Recurring cancellation explicitly confirms the whole schedule', await page.evaluate('document.querySelector(".calendar-confirm")?.innerText.includes("定型予定全体")'))
  await button('取り消す', '[role="dialog"]')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'recurring cancellation completes')
  check('Cancelling recurring time retains history and removes all occurrences', read().calendarBlocks.find((block) => block.id === cancelled.id).cancelled && await page.evaluate('!document.querySelector(' + JSON.stringify('[data-calendar-block-id="' + cancelled.id + '"]') + ')'))
}
async function verifyDrag() {
  await button('24時間', '.week-workspace')
  await click('[aria-label="' + shift(thisWeek, 3) + 'に予定を追加"]')
  check('The date-header add button preselects that specific day', await page.evaluate('document.querySelector(' + JSON.stringify('[aria-label="開始"]') + ').value.slice(0,10)===' + JSON.stringify(shift(thisWeek, 3))))
  await discardCalendar()
  const points = await page.evaluate(`(() => { const day=document.querySelector('[data-calendar-column="${shift(thisWeek, 3)}"]'); if(!day) throw Error('Missing drag day'); let scroller=day.parentElement; while(scroller && !(scroller.scrollHeight>scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller=scroller.parentElement; if(scroller) scroller.scrollTop=day.offsetTop+day.offsetHeight*14/24; const rect=day.getBoundingClientRect(); return {start:{x:rect.x+rect.width*.6,y:rect.y+rect.height*(15*60+1)/1440},end:{x:rect.x+rect.width*.6,y:rect.y+rect.height*(16*60-1)/1440},innerHeight}; })()`)
  check('Drag coordinates target visible empty calendar time', points.start.y > 0 && points.end.y < points.innerHeight && points.end.y > points.start.y, points)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.start })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 })
  for (let fraction = 1; fraction <= 4; fraction++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.end.x, y: points.start.y + (points.end.y - points.start.y) * fraction / 4, button: 'left', buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', clickCount: 1 })
  await until(() => page.evaluate('Boolean(document.querySelector(".calendar-editor"))'), 'drag opens planned editor')
  const selected = await page.evaluate('({start:document.querySelector("[aria-label=開始]").value,end:document.querySelector("[aria-label=終了]").value})')
  check('Dragging creates a nonzero range on the selected calendar day', selected.start === localDateTime(at(shift(thisWeek, 3), 15)) && selected.end === localDateTime(at(shift(thisWeek, 3), 16)), selected)
  await fill('[role="dialog"] [aria-label="タイトル"]', 'ドラッグして作った予定')
  draggedBlock = await saveCalendar('ドラッグして作った予定')
  check('The dragged range persists exactly as selected in the UI', draggedBlock.startedAt === new Date(selected.start).getTime() && draggedBlock.endedAt === new Date(selected.end).getTime())
}
async function verifyNavigation() {
  await click('[aria-label="次の週"]')
  await until(() => page.evaluate(`document.querySelector('.calendar-day-header')?.dataset.calendarDay===${JSON.stringify(nextWeek)}`), 'next calendar week')
  check('Next week includes recurring time but no previous actual records', await page.evaluate('document.querySelectorAll("[data-calendar-event=actual]").length===0 && document.querySelectorAll("[data-calendar-event=routine]").length>0'))
  await click('[aria-label="前の週"]')
  await until(() => page.evaluate(`document.querySelector('.calendar-day-header')?.dataset.calendarDay===${JSON.stringify(thisWeek)}`), 'previous calendar week')
  await nativeValue('[aria-label="表示する週の日付"]', shift(thisWeek, 30), shift(thisWeek, 28))
  await until(() => page.evaluate(`document.querySelector('.calendar-day-header')?.dataset.calendarDay===${JSON.stringify(shift(thisWeek, 28))}`), 'date input selects its calendar week')
  check('An empty future week shows all seven days without stale events', await page.evaluate('document.querySelectorAll(".calendar-day-header").length===7 && document.querySelectorAll("[data-calendar-event]").length===0'))
  await screenshot('05-empty-future-week')
  await button('今週', '.week-workspace')
  await until(() => page.evaluate(`document.querySelector('.calendar-day-header')?.dataset.calendarDay===${JSON.stringify(thisWeek)}`), 'return to current calendar week')
  await click('[aria-label="前の週"]')
  check('The previous empty week starts before every recurring schedule', await page.evaluate('document.querySelectorAll("[data-calendar-event]").length===0'))
  await button('今週', '.week-workspace')
}
async function verifyUnsupportedWeekPicker() {
  const selector = '[aria-label="表示する週の日付"]'
  const database = read(), disk = fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')
  const inspect = () => page.evaluate(`(() => { const input=document.querySelector('[aria-label="表示する週の日付"]');const error=document.querySelector('#week-date-error');return {days:[...document.querySelectorAll('.calendar-day-header[data-calendar-day]')].map(el=>el.dataset.calendarDay),input:input ? {value:input.value,min:input.min,max:input.max,invalid:input.getAttribute('aria-invalid'),describedBy:input.getAttribute('aria-describedby'),rangeUnderflow:input.validity.rangeUnderflow,rangeOverflow:input.validity.rangeOverflow,badInput:input.validity.badInput} : null,error:error ? {id:error.id,role:error.getAttribute('role'),text:error.textContent} : null}; })()`)
  const before = await inspect(), observations = []
  assert.equal(before.days.length, 7)
  for (const [name, value] of [['05a-unsupported-week-year-0002', '0002-01-01'], ['05b-unsupported-week-year-10000', '10000-01-01']]) {
    await nativeValue(selector, value)
    await until(() => page.evaluate('Boolean(document.querySelector("#week-date-error")?.textContent.trim())'), 'unsupported week date is explained locally')
    await wait(300)
    const observed = await inspect()
    observations.push({ attempted: value, ...observed })
    check('Unsupported week picker date ' + value + ' retains its draft and the seven selected days with an accessible local error', observed.input?.value === value && isDeepStrictEqual(observed.days, before.days) && observed.input.invalid === 'true' && observed.input.describedBy?.split(/\s+/).includes('week-date-error') && observed.error?.role === 'alert' && observed.error.text.trim().length > 0, observed)
    check('Unsupported week picker date ' + value + ' produces no renderer console error or uncaught exception', errors.length === 0, errors)
    await screenshot(name)
  }
  const validDate = '2026-10-21', validWeek = '2026-10-19'
  const validDays = Array.from({ length: 7 }, (_, index) => shift(validWeek, index))
  await nativeValue(selector, validDate, validWeek)
  await until(() => page.evaluate("document.querySelector('.calendar-day-header')?.dataset.calendarDay==='2026-10-19'"), 'valid 2026 picker date selects a new week')
  const recovered = await inspect()
  check('A valid 2026 date clears the local picker error and displays the new seven-day week', isDeepStrictEqual(recovered.days, validDays) && !isDeepStrictEqual(recovered.days, before.days) && recovered.input.value === validWeek && recovered.input.invalid !== 'true' && !recovered.error && !recovered.input.describedBy && errors.length === 0, recovered)
  await screenshot('05c-week-picker-recovered')
  await nativeValue(selector, '')
  const empty = await inspect()
  check('An empty week picker keeps its input draft and the current seven days without an error', empty.input?.value === '' && isDeepStrictEqual(empty.days, validDays) && !empty.error && empty.input.invalid !== 'true' && errors.length === 0, empty)
  check('Unsupported, recovered and empty date picker changes preserve the complete database and exposed state', fs.readFileSync(path.join(DATA, 'data.json'), 'utf8') === disk && isDeepStrictEqual(read(), database) && stateMatchesDatabase(await call('state:get'), database))
  await button('今週', '.week-workspace')
  const restored = await inspect()
  check('Today-week navigation clears the empty date draft and restores all seven current dates', restored.input?.value === thisWeek && isDeepStrictEqual(restored.days, Array.from({ length: 7 }, (_, index) => shift(thisWeek, index))) && !restored.error)
  fs.writeFileSync(path.join(RUN, 'week-picker-unsupported-dates.json'), JSON.stringify({ before, observations, recovered, empty, restored, rendererErrors: errors }, null, 2))
}
async function verifyWeekDateBoundaries() {
  const selector='[aria-label="表示する週の日付"]',database=read(),disk=fs.readFileSync(path.join(DATA,'data.json'),'utf8'),observations=[]
  const inspect=()=>page.evaluate(`(()=>{const input=document.querySelector('[aria-label="表示する週の日付"]'),error=document.querySelector('#week-date-error');return {days:[...document.querySelectorAll('.calendar-day-header[data-calendar-day]')].map(el=>el.dataset.calendarDay),input:{value:input.value,min:input.min,max:input.max,invalid:input.getAttribute('aria-invalid'),describedBy:input.getAttribute('aria-describedby')},error:error?{text:error.textContent,role:error.getAttribute('role')}:null}})()`)
  for(const [label,week,arrow] of [['low','1000-01-13','前の週'],['high','9999-12-20','次の週']]){
    await nativeValue(selector,week)
    const expectedDays=Array.from({length:7},(_,index)=>shift(week,index)),selected=await inspect()
    check('Supported '+label+' date boundary displays the exact seven-day week without a local error',isDeepStrictEqual(selected.days,expectedDays)&&selected.input.value===week&&selected.input.min==='1000-01-13'&&!selected.error&&errors.length===0,selected)
    await click('[aria-label="'+arrow+'"]')
    await until(()=>page.evaluate('Boolean(document.querySelector("#week-date-error")?.textContent.trim())'),'adjacent unsupported '+label+' week is rejected locally')
    await wait(300)
    const rejected=await inspect()
    check('The '+label+' boundary rejects the adjacent week and retains its exact seven dates and picker value',isDeepStrictEqual(rejected.days,expectedDays)&&rejected.input.value===week&&rejected.input.invalid==='true'&&rejected.input.describedBy==='week-date-error'&&rejected.error?.role==='alert'&&errors.length===0,rejected)
    await screenshot('05-boundary-'+label+'-week')
    if(!await page.evaluate('document.querySelector(".week-record-details").open'))await click('.week-record-details > summary')
    if(!await page.evaluate('document.querySelector(".activity-trend > details").open'))await click('.activity-trend > details > summary')
    const trend=await page.evaluate(`(()=>{const section=document.querySelector('.activity-trend'),svg=section.querySelector('svg'),numeric=['viewBox','x','y','x1','x2','y1','y2','cx','cy','r','width','height','points'];return {caption:section.querySelector('.activity-note').textContent,pointTitles:[...section.querySelectorAll('.trend-point title')].map(el=>el.textContent),dates:[...section.querySelectorAll('.trend-values li > span:first-child')].map(el=>el.textContent),values:[...section.querySelectorAll('.trend-values li > span:last-child')].map(el=>el.textContent),text:[...svg.querySelectorAll('text')].map(el=>el.textContent),attributes:[svg,...svg.querySelectorAll('*')].flatMap(el=>numeric.filter(name=>el.hasAttribute(name)).map(name=>({tag:el.tagName,name,value:el.getAttribute(name)}))),rect:svg.getBoundingClientRect().toJSON()}})()`)
    const last=expectedDays[6],trendDays=Array.from({length:14},(_,index)=>shift(last,index-13)),ticks=[0,6,13].map(index=>trendDays[index].slice(5).replace('-','/'))
    check('The '+label+' boundary trend has fourteen exact calendar dates, zero-hour values and the selected-week-end label',trend.caption.includes(last+'（この週の終わり）')&&isDeepStrictEqual(trend.dates,trendDays)&&isDeepStrictEqual(trend.pointTitles,trendDays.map(day=>day+'：0m'))&&trend.values.every(value=>value==='0m')&&ticks.every(tick=>trend.text.includes(tick)),trend)
    check('The '+label+' boundary trend renders finite visible SVG geometry without NaN, infinity or invalid dates',trend.rect.width>0&&trend.rect.height>0&&trend.attributes.length>40&&trend.attributes.every(attribute=>attribute.value.trim().length>0&&attribute.value.trim().split(/[\s,]+/).every(value=>Number.isFinite(Number(value))))&&!/NaN|Infinity|Invalid Date|undefined/.test(JSON.stringify(trend))&&errors.length===0,trend.attributes)
    await screenshot('05-boundary-'+label+'-trend','.activity-trend','center')
    observations.push({label,week,selected,rejected,trend})
  }
  check('Both date boundaries and expanded trends preserve the entire database and exposed state',fs.readFileSync(path.join(DATA,'data.json'),'utf8')===disk&&isDeepStrictEqual(read(),database)&&stateMatchesDatabase(await call('state:get'),database))
  await button('今週','.week-workspace')
  const restored=await inspect()
  check('Returning from a boundary clears the local error and restores the seven current dates without renderer errors',restored.input.value===thisWeek&&isDeepStrictEqual(restored.days,Array.from({length:7},(_,index)=>shift(thisWeek,index)))&&!restored.error&&restored.input.invalid!=='true'&&errors.length===0,restored)
  if(await page.evaluate('document.querySelector(".week-record-details").open'))await click('.week-record-details > summary')
  await page.evaluate('document.querySelector(".main-content").scrollTop=0;document.querySelector(".calendar-scroll").scrollTop=0')
  fs.writeFileSync(path.join(RUN,'week-date-boundary-trends.json'),JSON.stringify({observations,restored,rendererErrors:errors},null,2))
}
async function editBudget() {
  const target=await scrollMainTo('[aria-label="時間予算を編集"]')
  assert.ok(target.visible&&target.scrollTop>0,'Budget trigger is reached through actual main scrolling')
  await click('[aria-label="時間予算を編集"]')
  await until(() => page.evaluate('Boolean(document.querySelector("[aria-label=\\"睡眠（週の合計時間）\\"]"))'), 'weekly budget form')
}
async function saveBudget(week) {
  await button('時間配分を保存', '.weekly-budget')
  await until(() => read().weeklyBudgets?.some((budget) => budget.weekStart === week), 'week budget persists')
  await until(() => page.evaluate('!document.querySelector(".weekly-budget form")'), 'budget editor closes')
}
async function verifyBudget() {
  await editBudget()
  for (const [label, value] of [['睡眠（週の合計時間）', '56'], ['食事（週の合計時間）', '14'], ['その他の固定時間（週の合計時間）', '7']]) await fill(`[aria-label="${label}"]`, value)
  for (let index = 0; index < 3; index++) {
    await select('[aria-label="配分するプロジェクトを追加"]', projects[index].id)
    await select(`[aria-label="配分の方式: ${labels[index]}"]`, ['minimum', 'maximum', 'range'][index])
    if (index === 0 || index === 2) await fill(`[aria-label="最小時間: ${labels[index]}"]`, index === 0 ? '12' : '8')
    if (index === 1 || index === 2) await fill(`[aria-label="最大時間: ${labels[index]}"]`, index === 1 ? '20' : '16')
  }
  await click('.weekly-budget form input[type="checkbox"]')
  await screenshot('06-week-budget-editor', '.weekly-budget form', 'center')
  await saveBudget(thisWeek)
  let budget = read().weeklyBudgets.find((item) => item.weekStart === thisWeek)
  check('Living totals and minimum, maximum and range allocations persist through the UI', budget.sleepMinutes === 3360 && budget.mealMinutes === 840 && budget.fixedMinutes === 420 && isDeepStrictEqual(budget.allocations, [{ projectId: projects[0].id, mode: 'minimum', minutes: 720 }, { projectId: projects[1].id, mode: 'maximum', minutes: 1200 }, { projectId: projects[2].id, mode: 'range', minimumMinutes: 480, maximumMinutes: 960 }]))
  await editBudget()
  await select(`[aria-label="配分の方式: ${labels[2]}"]`, 'unlimited')
  await click('.weekly-budget form input[type="checkbox"]')
  await saveBudget(thisWeek)
  budget = read().weeklyBudgets.find((item) => item.weekStart === thisWeek)
  check('Unlimited allocation remains available alongside bounded allocations', budget.allocations[2].mode === 'unlimited' && isDeepStrictEqual(read().weeklyBudgetDefaults.allocations, budget.allocations))
  await click('[aria-label="次の週"]')
  await editBudget()
  await button('既定の配分を使う', '.weekly-budget')
  await until(() => page.evaluate('Boolean(document.querySelector(".weekly-budget form"))'), 'default budget opens as a draft')
  check('Default reuse retains input without silently saving a new week', !read().weeklyBudgets.some((item) => item.weekStart === nextWeek) && await page.evaluate('document.querySelector("[aria-label=\\"睡眠（週の合計時間）\\"]").value==="56" && document.querySelectorAll(".weekly-allocation").length===3'))
  await saveBudget(nextWeek)
  const reused = read().weeklyBudgets.find((item) => item.weekStart === nextWeek)
  check('Reuse preserves all saved allocations and living totals', ['sleepMinutes', 'mealMinutes', 'fixedMinutes', 'allocations'].every((field) => isDeepStrictEqual(reused[field], budget[field])))
  await button('今週', '.week-workspace')
  await screenshot('07-week-budget-summary')
}
async function verifyLayout(label, width, height, scale = 1) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  await resetPrimary()
  const layout=await calendarSurface()
  fs.writeFileSync(path.join(RUN,label+'-layout.json'),JSON.stringify(layout,null,2))
  check(label+': expanded time labels use readable two-hour spacing without overlap',Math.abs(layout.hourHeight-56)<.1&&sparseAxis(layout,2),{axis:layout.axis,hourHeight:layout.hourHeight})
  check(label+': the calendar fills the main width and remaining initial height while secondary content stays below',primaryCalendarFits(layout),layout)
  check(label+': every container avoids horizontal overflow',layout.overflow.every(box=>box.scrollWidth-box.clientWidth<=1),layout.overflow)
  check(label+': all seven date headers fit visibly across the calendar',layout.days.length===7&&layout.days.every(day=>day.left>=layout.main.left-1&&day.right<=width+1&&day.top>=0&&day.bottom<=height&&day.width>=28&&day.height>=20),layout.days)
  await screenshot(label)
  const point={x:layout.scroll.left+25,y:layout.scroll.top+Math.min(150,layout.scroll.height/2)}
  await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:2000})
  await until(()=>page.evaluate('(() => {const scroll=document.querySelector(".calendar-scroll"),marker=document.querySelector(".calendar-midnight"),r=marker.getBoundingClientRect(),s=scroll.getBoundingClientRect();return scroll.scrollTop>336&&r.top>=s.top&&r.bottom<=s.bottom&&r.bottom<=innerHeight})()'),'calendar wheel reaches 24:00')
  const midnight=await page.evaluate('(() => {const scroll=document.querySelector(".calendar-scroll"),marker=document.querySelector(".calendar-midnight");return {marker:marker.getBoundingClientRect().toJSON(),scroll:scroll.getBoundingClientRect().toJSON(),scrollTop:scroll.scrollTop,mainScrollTop:document.querySelector(".main-content").scrollTop}})()')
  check(label+': the calendar scroll reaches 24:00 independently of the main scroll',midnight.scrollTop>336&&midnight.mainScrollTop===0&&midnight.marker.top>=midnight.scroll.top&&midnight.marker.bottom<=Math.min(height,midnight.scroll.bottom),midnight)
  fs.writeFileSync(path.join(RUN,label+'-midnight-layout.json'),JSON.stringify(midnight,null,2))
  await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:2000})
  await until(()=>page.evaluate('document.querySelector(".main-content").scrollTop>0'),'continued calendar wheel reaches main secondary content')
  const lower=await scrollMainTo('[aria-label="時間予算を編集"]')
  check(label+': main scrolling reaches an operable budget trigger below the calendar',lower.scrollTop>0&&lower.visible,lower)
  await screenshot(label+'-secondary','.week-budget-panel','center')
  await page.evaluate('document.querySelector(".main-content").scrollTop=0')
  await button('24時間','.week-workspace')
  await wait(200)
  const overview=await calendarSurface(),step=height<=720?4:2
  check(label+': the 24-hour overview uses sparse readable labels appropriate to the available height',sparseAxis(overview,step),{expectedStep:step,axis:overview.axis,hourHeight:overview.hourHeight})
  fs.writeFileSync(path.join(RUN,label+'-overview-layout.json'),JSON.stringify(overview,null,2))
  await screenshot(label+'-overview')
  await resetPrimary()
  await createDialog()
  await form('狭い画面でも保持する入力 ' + label, at(thisWeek, 16), at(thisWeek, 17))
  await click('[aria-label="毎週繰り返す"]')
  await click('[aria-label="水曜日に繰り返す"]')
  await nativeValue('[aria-label="繰り返しの終了日"]', shift(thisWeek, 30))
  const savePoint = await page.evaluate(`(() => { const save=document.querySelector('.calendar-editor button[type=submit]'); save.scrollIntoView({block:'center'}); const r=save.getBoundingClientRect(), m=document.querySelector('[role=dialog]').getBoundingClientRect(); return {save:{top:r.top,bottom:r.bottom,width:r.width,height:r.height},modal:{top:m.top,bottom:m.bottom,width:m.width},scroll:[...document.querySelectorAll('[role=dialog],.calendar-editor,[role=dialog] form')].map(el=>({className:el.className,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,scrollTop:el.scrollTop}))}; })()`)
  check(label + ': the modal remains inside the viewport and its save control is reachable', savePoint.modal.top >= -1 && savePoint.modal.bottom <= height + 1 && savePoint.save.top >= 0 && savePoint.save.bottom <= height && savePoint.save.height >= 24, savePoint)
  await screenshot(label + '-calendar-modal')
  await discardCalendar()
  await editBudget()
  const budgetLayout = await page.evaluate('(() => { const control=document.querySelector(".weekly-budget button[type=submit]"); control.scrollIntoView({block:"center"}); const r=control.getBoundingClientRect(), m=document.querySelector("[role=dialog]").getBoundingClientRect(); return {save:{top:r.top,bottom:r.bottom,height:r.height},modal:{top:m.top,bottom:m.bottom,width:m.width},overflow:document.querySelector(".weekly-budget").scrollWidth-document.querySelector(".weekly-budget").clientWidth}; })()')
  check(label + ': the budget modal scroll reaches saving without horizontal overflow', budgetLayout.modal.top >= -1 && budgetLayout.modal.bottom <= height + 1 && budgetLayout.save.top >= 0 && budgetLayout.save.bottom <= height && budgetLayout.save.height >= 24 && budgetLayout.overflow <= 1, budgetLayout)
  await screenshot(label + '-budget-modal')
  await click('[aria-label="時間予算を閉じる"]')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'budget modal closes')
  await page.send('Emulation.clearDeviceMetricsOverride')
}

const modalControls = `(() => { const dialog=[...document.querySelectorAll('[role="dialog"]')].at(-1); return [...dialog.querySelectorAll('button,input,textarea,select,a[href],summary,[tabindex]')].filter(el=>!el.disabled && el.tabIndex>=0 && el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0); })()`
async function verifyDialogKeyboard(label) {
  check(label + ': initial focus is on a form field inside the active dialog', await page.evaluate(`(() => { const dialog=[...document.querySelectorAll('[role="dialog"]')].at(-1); return dialog.contains(document.activeElement) && document.activeElement.matches('input,select,textarea'); })()`))
  await page.evaluate(`(${modalControls}).at(-1).focus()`)
  await key('Tab', 'Tab')
  check(label + ': Tab at the final control wraps to the first control', await page.evaluate(`document.activeElement===(${modalControls})[0]`))
  await key('Tab', 'Tab', 8)
  check(label + ': Shift+Tab at the first control wraps to the final control', await page.evaluate(`document.activeElement===(${modalControls}).at(-1)`))
}
async function verifyBudgetKeyboard() {
  await editBudget()
  await verifyDialogKeyboard('Weekly budget dialog')
  await fill('[aria-label="睡眠（週の合計時間）"]', '57')
  await key('Escape', 'Escape')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'budget Escape closes the dialog')
  check('Budget Escape restores trigger focus and preserves the saved budget', await page.evaluate('document.activeElement.getAttribute("aria-label")==="時間予算を編集"') && read().weeklyBudgets.find((budget) => budget.weekStart === thisWeek).sleepMinutes === 3360)
  await editBudget()
  check('Reopening after Escape retains the unsaved budget input', await page.evaluate('document.querySelector(' + JSON.stringify('[aria-label="睡眠（週の合計時間）"]') + ').value==="57"'))
  await fill('[aria-label="睡眠（週の合計時間）"]', '56')
  await key('Escape', 'Escape')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'budget Escape closes the restored input')
}
async function verifyFixedUnsavedClose() {
  const before = read().fixedWork
  await button('外部固定予定を追加', '.week-calendar-foot')
  await until(() => page.evaluate('Boolean(document.querySelector("#fixed-work-editor-title"))'), 'new external fixed editor')
  await verifyDialogKeyboard('External fixed dialog')
  const start = localDateTime(Date.now() + 2 * 60 * MINUTE), end = localDateTime(Date.now() + 3 * 60 * MINUTE), reason = '保存前の外部予定の入力を保持する'
  await select('[aria-label="固定予定のタスク"]', fixedTask.id)
  await nativeValue('[aria-label="固定予定の開始日時"]', start)
  await nativeValue('[aria-label="固定予定の終了日時"]', end)
  await fill('[aria-label="時刻が固定される外部の理由"]', reason)
  for (const route of ['close', 'backdrop', 'Escape']) {
    if (route === 'close') await button('閉じる', '[role="dialog"]')
    if (route === 'Escape') await key('Escape', 'Escape')
    if (route === 'backdrop') {
      const point = await page.evaluate('({x:10,y:innerHeight/2})')
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    }
    await until(() => page.evaluate('Boolean(document.querySelector(".calendar-confirm[role=alert]"))'), 'fixed unsaved ' + route + ' confirmation')
    const values = await page.evaluate('({task:document.querySelector(' + JSON.stringify('[aria-label="固定予定のタスク"]') + ').value,start:document.querySelector(' + JSON.stringify('[aria-label="固定予定の開始日時"]') + ').value,end:document.querySelector(' + JSON.stringify('[aria-label="固定予定の終了日時"]') + ').value,reason:document.querySelector(' + JSON.stringify('[aria-label="時刻が固定される外部の理由"]') + ').value,confirmation:document.querySelector(".calendar-confirm").textContent})')
    check('External fixed unsaved ' + route + ' retains all inputs and asks before discarding', values.task === fixedTask.id && values.start === start && values.end === end && values.reason === reason && values.confirmation.includes('入力を破棄') && isDeepStrictEqual(read().fixedWork, before), values)
    if (route !== 'Escape') await button('編集を続ける', '[role="dialog"]')
  }
  await screenshot('07b-fixed-unsaved-escape', '.calendar-confirm', 'center')
  await button('入力を破棄して閉じる', '[role="dialog"]')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'explicit fixed draft discard closes editor')
  check('Explicit fixed draft discard creates no schedule and changes no session', isDeepStrictEqual(read().fixedWork, before) && isDeepStrictEqual(read().sessions, baselineSessions))
}
async function verifyLifeDetails() {
  check('Project comparisons precede the initially closed life-time details', await page.evaluate(`(() => { const projects=document.querySelector('.week-projects'), details=document.querySelector('.week-life-details'); return !details.open && Boolean(projects.compareDocumentPosition(details)&Node.DOCUMENT_POSITION_FOLLOWING); })()`))
  await click('.week-life-details > summary')
  await page.evaluate('document.querySelector(".week-life-time").scrollIntoView({block:"center"})')
  const details = await page.evaluate(`(() => { const element=document.querySelector('.week-life-details'); return {open:element.open,width:innerWidth,height:innerHeight,rows:[...element.querySelectorAll('.week-life-time > div')].map(el=>{const r=el.getBoundingClientRect();return {label:el.querySelector('dt').textContent,value:el.querySelector('dd').textContent,top:r.top,bottom:r.bottom,width:r.width,height:r.height,fontSize:parseFloat(getComputedStyle(el).fontSize)}})}; })()`)
  const external = read().fixedWork[0]
  check('Life-time details open with four readable labels and independently expected totals', details.open && isDeepStrictEqual(details.rows.map((row) => row.label), ['睡眠', '食事', 'その他の固定時間', '外部固定作業']) && isDeepStrictEqual(details.rows.map((row) => displayedMinutes(row.value)), [3360, 840, 420, Math.floor((external.endedAt - external.startedAt) / MINUTE)]) && details.rows.every((row) => row.top >= 0 && row.bottom <= details.height && row.width >= 120 && row.height >= 18 && row.fontSize >= 12), details)
  await screenshot('07a-week-life-details-open', '.week-life-time', 'center')
  await click('.week-life-details > summary')
  check('Life-time details close again without changing budget or activity data', await page.evaluate('!document.querySelector(".week-life-details").open') && isDeepStrictEqual(read().sessions, baselineSessions))
  await page.evaluate('document.querySelector(".main-content").scrollTop=0;document.querySelector(".week-budget-panel").scrollTop=0')
  fs.writeFileSync(path.join(RUN, 'life-details-layout.json'), JSON.stringify(details, null, 2))
}
async function verifyDemoScreenshots() {
  const projectNames = ['White Box', 'Quri', '研究・学習']
  const taskTitles = ['週間カレンダーの実装', '定例ミーティング', '論文を読む']
  for (let index = 0; index < 3; index++) {
    await call('project:update', { id: projects[index].id, patch: { name: projectNames[index] } })
    await call('task:update', { id: tasks[index].id, patch: { title: taskTitles[index] } })
  }
  await call('task:update', { id: fixedTask.id, patch: { title: '定例ミーティング' } })
  await call('calendar:update', { id: recurringBlock.id, patch: { cancelled: true } })
  await call('weeklyBudget:set', { weekStart: thisWeek, plan: { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 420, allocations: [{ projectId: projects[0].id, mode: 'range', minimumMinutes: 720, maximumMinutes: 1200 }, { projectId: projects[1].id, mode: 'minimum', minutes: 480 }, { projectId: projects[2].id, mode: 'range', minimumMinutes: 360, maximumMinutes: 720 }] } })
  check('Demo cancels only its added duplicate sleep and preserves the original schedule and all sessions', read().calendarBlocks.find((block) => block.id === recurringBlock.id).cancelled && read().calendarBlocks.some((block) => block.category === 'sleep' && block.id !== recurringBlock.id && !block.cancelled) && isDeepStrictEqual(read().sessions, baselineSessions))
  const plannedTitles = new Map([['先に置いた作業予定', '画面の設計を検討する'], [uiBlock.title, '週間カレンダーの実装'], ['保存失敗でも残る予定', '実装を振り返る'], [draggedBlock.title, '論文を読む'], [recurringBlock.title, '睡眠']])
  for (const block of read().calendarBlocks.filter((item) => !item.cancelled)) {
    const title = plannedTitles.get(block.title) ?? (block.title.startsWith('重なる予定 ') ? '要件と操作を確認する' : null)
    if (title) await call('calendar:update', { id: block.id, patch: { title } })
  }
  uiBlock = read().calendarBlocks.find((item) => item.id === uiBlock.id)
  recurringBlock = read().calendarBlocks.find((item) => item.id === recurringBlock.id)
  draggedBlock = read().calendarBlocks.find((item) => item.id === draggedBlock.id)
  await button('今週', '.week-workspace')
  const inspect=async()=>{const surface=await calendarSurface();const projects=await page.evaluate("[...document.querySelectorAll('.week-project')].slice(0,3).map(el=>({name:el.querySelector('.week-project-name strong').textContent,allocation:el.querySelector('.week-project-allocation').textContent,contentBounds:[...el.querySelectorAll('.week-project-name,.week-project-numbers,.week-project-allocation')].map(el=>el.getBoundingClientRect().toJSON())}))");return {...surface,projects}}
  const comparisonsVisible=surface=>isDeepStrictEqual(surface.projects.map(item=>item.name),['White Box','Quri','研究・学習'])&&surface.projects.every(project=>project.contentBounds.length===3&&project.contentBounds.every(content=>content.top>=Math.max(surface.main.top,surface.budget.top)&&content.bottom<=Math.min(surface.height,surface.budget.bottom-1)))&&surface.projects[0].allocation.includes('12h〜20h')&&surface.projects[1].allocation.includes('最低 8h')&&surface.projects[2].allocation.includes('6h〜12h')
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  await resetPrimary()
  await screenshot('13-demo-1440x900')
  const large=await inspect()
  check('Japanese demo at 1440x900 shows the full-width initial calendar and keeps secondary content below',primaryCalendarFits(large),large)
  await scrollMainTo('.week-budget-panel')
  await screenshot('13-demo-secondary-1440x900')
  large.secondaryView=await inspect()
  check('Japanese demo main scrolling reveals all three project comparisons and explicit range/minimum budgets',comparisonsVisible(large.secondaryView),large.secondaryView)
  await page.send('Emulation.clearDeviceMetricsOverride')
  await resetPrimary()
  await screenshot('14-demo-native-window')
  const native=await inspect()
  check('Japanese demo in the normal native window shows the full-width initial calendar and seven visible days',primaryCalendarFits(native),native)
  await scrollMainTo('.week-budget-panel')
  await screenshot('14-demo-native-secondary')
  native.secondaryView=await inspect()
  check('Japanese demo in the native window reveals three project comparisons after main scrolling',comparisonsVisible(native.secondaryView),native.secondaryView)
  fs.writeFileSync(path.join(RUN,'demo-layout.json'),JSON.stringify({large,native},null,2))
  fs.writeFileSync(path.join(RUN,'demo-database.json'),JSON.stringify(read(),null,2))
}
async function verifyDetachedLinks() {
  const untouchedProjects = read().projects.filter((item) => projects.some((project) => project.id === item.id))
  const untouchedTasks = read().tasks.filter((item) => [...tasks, fixedTask].some((task) => task.id === item.id))
  const originalProject = await call('project:create', { name: '検証専用・予定の元プロジェクト' })
  const movedProject = await call('project:create', { name: '検証専用・タスクの移動先' })
  const linkedTask = await call('task:create', { title: '検証専用・関連先が変わるタスク', projectId: originalProject.id, status: 'todo' })
  const linked = await call('calendar:create', { title: '移動前の関連付き予定', category: 'work', taskId: linkedTask.id, projectId: originalProject.id, startedAt: at(shift(thisWeek, 3), 19), endedAt: at(shift(thisWeek, 3), 20), repeat: 'none', weekdays: [], until: null })
  await call('task:update', { id: linkedTask.id, patch: { projectId: movedProject.id } })
  await editCalendar(linked.id)
  await fill('[role="dialog"] [aria-label="タイトル"]', 'タスク移動後でも編集できる予定')
  await nativeValue('[aria-label="開始"]', localDateTime(at(shift(thisWeek, 3), 19, 15)))
  await nativeValue('[aria-label="終了"]', localDateTime(at(shift(thisWeek, 3), 20, 15)))
  let saved = await saveCalendar('タスク移動後でも編集できる予定')
  check('Editing title and time retains links when the linked task has moved to another project', saved.id === linked.id && saved.taskId === linkedTask.id && saved.projectId === originalProject.id && saved.startedAt === at(shift(thisWeek, 3), 19, 15) && saved.endedAt === at(shift(thisWeek, 3), 20, 15))
  await call('task:delete', { id: linkedTask.id })
  await call('project:delete', { id: originalProject.id })
  check('Only newly created isolated test entities are removed', !read().tasks.some((item) => item.id === linkedTask.id) && !read().projects.some((item) => item.id === originalProject.id) && isDeepStrictEqual(read().tasks.filter((item) => [...tasks, fixedTask].some((task) => task.id === item.id)), untouchedTasks) && isDeepStrictEqual(read().projects.filter((item) => projects.some((project) => project.id === item.id)), untouchedProjects) && isDeepStrictEqual(read().sessions, baselineSessions))
  await editCalendar(linked.id)
  await fill('[role="dialog"] [aria-label="タイトル"]', '関連タスクとプロジェクトの削除後に編集した予定')
  saved = await saveCalendar('関連タスクとプロジェクトの削除後に編集した予定')
  check('A title-only edit succeeds with deleted task and project references retained', saved.id === linked.id && saved.taskId === linkedTask.id && saved.projectId === originalProject.id && saved.startedAt === at(shift(thisWeek, 3), 19, 15))
  await page.send('Page.reload')
  await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs"))'), 'reload after detached-link editing')
  await navigateWeek()
  await editCalendar(linked.id)
  check('Reload reads back title and time after task/project deletion', await page.evaluate('document.querySelector(' + JSON.stringify('[aria-label="タイトル"]') + ').value===' + JSON.stringify(saved.title) + ' && document.querySelector(' + JSON.stringify('[aria-label="開始"]') + ').value===' + JSON.stringify(localDateTime(saved.startedAt))))
  await screenshot('15-deleted-links-editable', '.calendar-editor', 'center')
  await discardCalendar()
}

async function closeFailureEditors() {
  if (!page) return
  for (let attempt = 0; attempt < 4; attempt++) {
    const kind = await page.evaluate('document.querySelector(".calendar-editor") ? "calendar" : document.querySelector(".week-budget-dialog") ? "budget" : document.querySelector("#fixed-work-editor-title") ? "fixed" : document.querySelector("[role=dialog]") ? "other" : null')
    if (!kind) return
    if (kind === 'calendar') await discardCalendar()
    else if (kind === 'budget') { await click('[aria-label="時間予算を閉じる"]'); await until(() => page.evaluate('!document.querySelector(".week-budget-dialog")'), 'failure budget editor closes') }
    else if (kind === 'fixed') { await button('閉じる', '[role="dialog"]'); if (await page.evaluate('Boolean(document.querySelector(".calendar-confirm"))')) await button('入力を破棄して閉じる', '[role="dialog"]') }
    else await key('Escape', 'Escape')
  }
}

let exitCode = 1
try {
  await launch('first')
  if (restorationProbe) {
    const baseline = nativeMainWindow()
    check('Native capture baseline is a visible non-minimized owned window', baseline.visible && !baseline.iconic && baseline.windowPid === child.pid, baseline)
    await raw('window:minimize')
    const minimized = await until(() => { const value = nativeMainWindow(); return value.iconic ? value : null }, 'real IPC minimizes this owned Main window')
    check('The visible-only predicate admits a genuinely minimized window', minimized.visible && minimized.iconic && minimized.windowPid === child.pid, minimized)
    await screenshot('01-restored-native-window')
    const restored = nativeMainWindow()
    check('Restoration allows an actual PNG while the owned window is visible and not minimized', restored.visible && !restored.iconic && restored.windowPid === child.pid && fs.statSync(path.join(RUN, '01-restored-native-window.png')).size > 1000, restored)
    await stop('first')
    check('The native restoration measurement leaves no owned PID', processSnapshot().length === 0)
    exitCode = 0
  } else if (captionBoundaryProbe) {
    await verifyCaptionBoundary()
    exitCode = 0
  } else if (layoutPreview) {
    await verifyPreviewScreens()
    exitCode = 0
  } else {
  await createFixture()
  await verifyInitialCalendar()
  await verifyCreationEditingAndFailure()
  await verifyPreciseCalendarTimes()
  await verifyPreciseFixedTime()
  await verifyRecurring()
  await verifyDrag()
  await verifyNavigation()
  await verifyUnsupportedWeekPicker()
  await verifyWeekDateBoundaries()
  await verifyBudgetKeyboard()
  await verifyFixedUnsavedClose()
  await verifyBudget()
  await verifyLifeDetails()
  for (const [label, width, height, scale] of [['08-layout-1440x900', 1440, 900, 1], ['09-layout-900x650', 900, 650, 1], ['10-layout-1440x500', 1440, 500, 1], ['11-layout-125-percent-equivalent', 1152, 720, 1.25]]) await verifyLayout(label, width, height, scale)
  await verifyDemoScreenshots()
  await verifyDetachedLinks()
  check('Every calendar and budget interaction preserves all existing sessions', isDeepStrictEqual(read().sessions, baselineSessions) && (await call('state:get')).live === null)
  persisted = read()
  fs.writeFileSync(path.join(RUN, 'before-restart-database.json'), JSON.stringify(persisted, null, 2))
  await stop('first')
  check('Natural quit preserves all persisted data', isDeepStrictEqual(read(), persisted))
  await launch('restart')
  const restarted = await call('state:get')
  check('Restart reads back all calendar blocks, cancellations, budgets and sessions', stateMatchesDatabase(restarted, persisted))
  await navigateWeek()
  await until(() => page.evaluate(`Boolean(document.querySelector('[data-calendar-block-id="${uiBlock.id}"]'))`), 'restarted planned block is visible')
  check('Restarted calendar hides cancelled blocks and restores recurring schedules', await page.evaluate(`!document.querySelector('[data-calendar-block-id="${projectBlock.id}"]') && !document.querySelector('[data-calendar-block-id="${recurringBlock.id}"]') && document.querySelector('[data-calendar-event="routine"]') && Boolean(document.querySelector('[data-calendar-block-id="${draggedBlock.id}"]'))`))
  await screenshot('12-calendar-after-restart')
  await editCalendar(uiBlock.id)
  check('Restarted planned editor restores its exact title, project and task', await page.evaluate(`document.querySelector('[aria-label="タイトル"]').value===${JSON.stringify(uiBlock.title)} && document.querySelector('[aria-label="プロジェクト"]').value===${JSON.stringify(projects[0].id)} && document.querySelector('[aria-label="タスク"]').value===${JSON.stringify(tasks[0].id)}`))
  await discardCalendar()
  await stop('restart')
  check('Final natural quit preserves the entire database', isDeepStrictEqual(read(), persisted))
  const appErrors = applicationErrors()
  fs.writeFileSync(path.join(RUN, 'application-errors.json'), JSON.stringify(appErrors, null, 2))
  check('All monitored renderers have no console errors or uncaught exceptions', errors.length === 0, errors)
  check('App logs contain no unexpected application errors', appErrors.unexpected.length === 0, appErrors)
  check('No owned Electron PID remains after both natural shutdowns', processSnapshot().length === 0, processObservation)
  exitCode = 0
  }
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {} }
} finally {
  endSaveFault()
  if (exitCode !== 0 && child && page) { try { await closeFailureEditors() } catch (error) { console.error(error) } }
  if (child) { try { await stop('failure') } catch (error) { console.error(error); exitCode = 1 } }
  if (exitCode !== 0) {
    const remaining = processSnapshot()
    fs.writeFileSync(path.join(RUN, 'failure-owned-processes.json'), JSON.stringify(processObservation, null, 2))
    if (remaining.length) {
      fs.writeFileSync(path.join(RUN, 'forced-cleanup-processes.json'), JSON.stringify(remaining, null, 2))
      for (const item of remaining.reverse()) {
        const current = processSnapshot().find((process) => sameProcess(process, item))
        if (current) try { process.kill(current.ProcessId, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
    }
  }
  for (const connection of pages) connection.close()
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, startedAt, completedAt: new Date().toISOString(), executable: electron, zoomMethod: '125% uses a 1152x720 CSS viewport at device scale 1.25, matching a 1440x900 physical display', checks, errors, expectedErrorWindows, artifacts: fs.readdirSync(RUN) }, null, 2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}
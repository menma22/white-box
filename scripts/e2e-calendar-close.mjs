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
import { connectOwnedPage } from './owned-cdp.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'calendar-close-run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const startedAt = new Date().toISOString()
const buildRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
const packageRoot = process.env.WHITEBOX_EXE ? 'node_modules/@white-box' : 'packages'
const runtimeFiles = ['dist-electron/presentation/main.js', 'apps/desktop/src/presentation/preload.cjs', 'dist-electron/app/handlers.js', 'dist-electron/app/planning-handlers.js', 'dist-electron/domain/calendar-ops.js', packageRoot + '/core/dist/calendar.js', packageRoot + '/core/dist/weekly-budget.js', packageRoot + '/contracts/dist/calendar.js', 'dist-electron/app/lifecycle.js', 'dist-electron/app/state.js', 'dist-electron/infra/agent-service.js', 'dist-electron/infra/dataio.js', 'dist-electron/infra/renderer-flush.js', 'dist-electron/infra/windows.js', 'dist/index.html', ...fs.readdirSync(path.join(buildRoot, 'dist', 'assets')).filter((file) => /\.(?:js|css)$/.test(file)).map((file) => 'dist/assets/' + file)]
const runtime = { startedAt, harnessSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), ownedProcessesSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-processes.mjs'))).digest('hex'), ownedCdpSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-cdp.mjs'))).digest('hex'), executable: electron, buildRoot, executableSha256: createHash('sha256').update(fs.readFileSync(electron)).digest('hex'), files: runtimeFiles.map((file) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(buildRoot, file))).digest('hex') })) }
fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = [], ownedProcesses = new OwnedProcesses(), pages = new Set(), expectedErrorWindows = []
let child, childIdentity, processObservation, page, port, appLog

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
async function windowPage(kind) {
  const expectedUrl = pathToFileURL(path.join(buildRoot, 'dist', 'index.html')).href + '#' + kind
  const connection = await connectOwnedPage({
    port, kind, expectedUrl, child, childIdentity, ownedProcesses,
    onEvent(message) {
      if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message)
    },
    onSend(method, params) {
      if (method === 'Input.dispatchKeyEvent') fs.appendFileSync(path.join(RUN, 'key-events.jsonl'), JSON.stringify({ at: new Date().toISOString(), method, params }) + '\n')
    },
  })
  pages.add(connection)
  check(`${kind}: CDP browser PID and page belong to this launch`, connection.identity.browserPid === child.pid && connection.identity.targetUrl === expectedUrl, connection.identity)
  fs.appendFileSync(path.join(RUN, 'cdp-identities.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, ...connection.identity }) + '\n')
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
  const expectedVetoStatus = '保存できなかった。入力を保持して、この画面を開いたままにしている。'
  check(label + ': quit begins with every editor closed and no unexpected save error', beforeQuit.calendarEditors===0 && beforeQuit.budgetEditors===0 && beforeQuit.errors.every(error => nativeCloseTrace.length > 0 && error === expectedVetoStatus), beforeQuit)
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
async function tab(number, selector) { await key(String(number), 'Digit' + number, 2); await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector) }
const MINUTE = 60_000
const calendar = (value) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const shift = (key, days) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return calendar(date) }
const at = (key, hour, minute = 0) => { const date = new Date(`${key}T00:00:00`); date.setHours(hour, minute, 0, 0); return date.getTime() }
const localDateTime = (value) => { const date = new Date(value); return `${calendar(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
const monday = new Date()
monday.setHours(0, 0, 0, 0)
monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
const thisWeek = calendar(monday)
let baselineSessions, uiBlock, persisted

async function navigateWeek() { await tab(8, '.week-workspace'); await until(() => page.evaluate('document.querySelectorAll(".calendar-day-header[data-calendar-day]").length===7'), 'seven calendar headers') }
async function nativeValue(selector, value, expected = value) {
  await click(selector)
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await until(() => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(expected)}`), selector + ' accepts input')
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

const nativeCloseTrace = []
function applicationErrors() {
  const expected = [], unexpected = []
  for (const file of fs.readdirSync(RUN).filter((file) => file.endsWith('-app.log'))) {
    let offset = 0
    for (const rawLine of fs.readFileSync(path.join(RUN, file), 'utf8').split(/(?<=\n)/)) {
      const line = rawLine.trimEnd(), at = offset
      offset += Buffer.byteLength(rawLine)
      if (!/uncaught|unhandled\s*(?:promise|rejection)|\[white-box\].*(?:失敗|できません|読めなかった|窓を閉じません)/i.test(line)) continue
      const record = { file, offset: at, line }
      const expectedWindow = expectedErrorWindows.find((item) => item.file === file && item.start <= at && item.end > at)
      if (expectedWindow && line.startsWith('[white-box] 入力の保存を待つため窓を閉じません:') && line.includes('入力を保存できなかったため、操作を取り消しました。') && !/uncaught|unhandled/i.test(line)) expected.push({ ...record, reason: expectedWindow.label })
      else unexpected.push(record)
    }
  }
  return { expected, unexpected }
}
async function fixture() {
  const initial = await call('state:get')
  check('Close probe begins in an empty isolated database', initial.projects.length === 0 && initial.tasks.length === 0 && initial.sessions.length === 0)
  const now = Date.now()
  await call('settings:update', { patch: { onboardedAt: now, lastWelcomeDate: calendar(now - 4 * 60 * MINUTE), dayStartHour: 4, showSessionCard: false, soundOnExpire: false, autoPauseOnSuspend: false, launchAtLogin: false, shortcuts: { startPause: '', currentWork: '', dashboard: '' } } })
  await page.send('Page.reload')
  await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs")) && !document.querySelector(".onboarding") && !document.querySelector(".welcome")'), 'isolated onboarding dismissed')
  const project = await call('project:create', { name: '終了拒否の隔離検証' })
  const task = await call('task:create', { title: '窓を閉じても入力を保持する', projectId: project.id, status: 'todo' })
  await recorded(task.id, at(thisWeek, 8), at(thisWeek, 8, 30), 'native close前後に保持する元の実績')
  uiBlock = await call('calendar:create', { title: '閉じる前の保存済み予定', category: 'work', taskId: task.id, projectId: project.id, startedAt: at(thisWeek, 9), endedAt: at(thisWeek, 10), repeat: 'none', weekdays: [], until: null })
  baselineSessions = read().sessions
  check('The close-probe fixture uses real IPC and has no active session', baselineSessions.length === 1 && (await call('state:get')).live === null)
  fs.writeFileSync(path.join(RUN, 'fixture-database.json'), JSON.stringify(read(), null, 2))
  await navigateWeek()
}
const draftValues = () => page.evaluate(`(() => { const editor=document.querySelector('.calendar-editor');return editor ? [...editor.querySelectorAll('input,select,textarea')].map(el=>({label:el.getAttribute('aria-label'),type:el.type,value:el.value,checked:el.checked ?? null})) : null })()`)
async function nativeCloseWhileDirty(label) {
  const database = read(), disk = fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')
  const beforeDraft = await draftValues(), beforeWindow = nativeMainWindow()
  assert.ok(beforeDraft && beforeWindow.visible)
  const observation = { label, file: path.basename(appLog), start: fs.statSync(appLog).size, end: null, commands: ['window:close'], kind: 'calendar-dirty-native-close' }
  expectedErrorWindows.push(observation)
  const requestedAt = new Date().toISOString()
  const response = await raw('window:close', { kind: 'main' })
  assert.equal(response.ok, true, JSON.stringify(response))
  const nativeEventLog = await until(() => fs.readFileSync(appLog).subarray(observation.start).toString('utf8').split(/\r?\n/).find(line => line.startsWith('[white-box] 入力の保存を待つため窓を閉じません:')), 'BrowserWindow close handler reports the real native veto', 10000)
  observation.end = fs.statSync(appLog).size
  const afterWindow = nativeMainWindow(), afterDraft = await draftValues()
  const trace = { label, requestedAt, transport: { command: 'window:close', args: { kind: 'main' }, response }, nativeEvent: 'Electron BrowserWindow close', observedPath: 'window:close invokes closeWindowsLater; BrowserWindow.close emits close; the production close handler logs the rejected prepareClose', nativeEventLog, beforeWindow, afterWindow, beforeDraft, afterDraft, ownedRootPid: child.pid, rootStillRunning: child.exitCode === null && child.signalCode === null, compiledWindowsSha256: runtime.files.find(item => item.file === 'dist-electron/infra/windows.js').sha256 }
  nativeCloseTrace.push(trace)
  fs.writeFileSync(path.join(RUN, 'native-close-event-trace.json'), JSON.stringify(nativeCloseTrace, null, 2))
  check(label + ': the native close event is vetoed and the same Main window remains visible', trace.rootStillRunning && afterWindow.visible && afterWindow.windowPid === child.pid && afterWindow.handle === beforeWindow.handle && nativeEventLog.includes('入力を保存できなかったため、操作を取り消しました。'), trace)
  check(label + ': every dirty calendar input remains exactly unchanged', isDeepStrictEqual(afterDraft, beforeDraft), afterDraft)
  check(label + ': disk and exposed state retain the entire saved database', fs.readFileSync(path.join(DATA, 'data.json'), 'utf8') === disk && isDeepStrictEqual(read(), database) && stateMatchesDatabase(await call('state:get'), database))
  await screenshot(label, '.calendar-editor', 'center')
}
async function closeFailureEditors() {
  if (page && await page.evaluate('Boolean(document.querySelector(".calendar-editor"))')) await discardCalendar()
}
let exitCode = 1
try {
  await launch('first')
  await fixture()
  await editCalendar(uiBlock.id)
  const savedTitle = '実際の窓終了を拒否した後に保存する予定'
  await fill('[role="dialog"] [aria-label="タイトル"]', savedTitle)
  await nativeValue('[role="dialog"] [aria-label="開始"]', localDateTime(at(thisWeek, 9, 15)))
  await nativeValue('[role="dialog"] [aria-label="終了"]', localDateTime(at(thisWeek, 10, 15)))
  await nativeCloseWhileDirty('01-dirty-calendar-save-path')
  const saved = await saveCalendar(savedTitle)
  check('The retained draft saves through the real CalendarEditor after the native close veto', saved.id === uiBlock.id && saved.startedAt === at(thisWeek, 9, 15) && saved.endedAt === at(thisWeek, 10, 15) && saved.projectId === uiBlock.projectId && saved.taskId === uiBlock.taskId)
  await screenshot('02-saved-after-native-veto')
  persisted = read()
  await editCalendar(uiBlock.id)
  await fill('[role="dialog"] [aria-label="タイトル"]', '明示破棄するまで残す二回目の入力')
  await nativeCloseWhileDirty('03-dirty-calendar-discard-path')
  await button('閉じる', '[role="dialog"]')
  check('Closing the dirty calendar asks for explicit discard and retains the second draft', await page.evaluate('Boolean(document.querySelector(".calendar-confirm")) && document.querySelector("[aria-label=タイトル]").value === "明示破棄するまで残す二回目の入力"') && isDeepStrictEqual(read(), persisted))
  await screenshot('04-explicit-discard-confirm', '.calendar-editor', 'center')
  await button('入力を破棄して閉じる', '[role="dialog"]')
  await until(() => page.evaluate('!document.querySelector(".calendar-editor")'), 'explicit Calendar draft discard')
  check('Explicit discard leaves the previously saved block and all sessions unchanged', isDeepStrictEqual(read(), persisted) && isDeepStrictEqual(read().sessions, baselineSessions))
  fs.writeFileSync(path.join(RUN, 'before-restart-database.json'), JSON.stringify(persisted, null, 2))
  await stop('first')
  check('Natural quit after explicit discard preserves the saved database', isDeepStrictEqual(read(), persisted))
  await launch('restart')
  check('Restart restores the complete saved calendar database', stateMatchesDatabase(await call('state:get'), persisted))
  await navigateWeek()
  await editCalendar(uiBlock.id)
  check('Restarted CalendarEditor reads the exact saved title and start/end', await page.evaluate(`document.querySelector('[aria-label="タイトル"]').value===${JSON.stringify(savedTitle)} && document.querySelector('[aria-label="開始"]').value===${JSON.stringify(localDateTime(saved.startedAt))} && document.querySelector('[aria-label="終了"]').value===${JSON.stringify(localDateTime(saved.endedAt))}`))
  await screenshot('05-restarted-saved-editor', '.calendar-editor', 'center')
  await discardCalendar()
  await stop('restart')
  check('The final natural quit preserves all saved fields and original session records', isDeepStrictEqual(read(), persisted) && isDeepStrictEqual(read().sessions, baselineSessions))
  const appErrors = applicationErrors()
  fs.writeFileSync(path.join(RUN, 'application-errors.json'), JSON.stringify(appErrors, null, 2))
  check('Only the two observed native close veto diagnostics appear in app logs', appErrors.expected.length === 2 && appErrors.unexpected.length === 0, appErrors)
  check('The close probe has no renderer console errors or uncaught exceptions', errors.length === 0, errors)
  check('No owned Electron PID remains after both natural shutdowns', processSnapshot().length === 0, processObservation)
  exitCode = 0
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {} }
} finally {
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
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, startedAt, completedAt: new Date().toISOString(), executable: electron, checks, errors, expectedErrorWindows, artifacts: fs.readdirSync(RUN) }, null, 2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}

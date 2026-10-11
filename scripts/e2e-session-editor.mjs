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
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'session-editor-run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const startedAt = new Date().toISOString()
const buildRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
const packageRoot = process.env.WHITEBOX_EXE ? 'node_modules/@white-box' : 'packages'
const runtimeFiles = ['dist-electron/presentation/main.js', 'dist-electron/presentation/ipc.js', 'dist-electron/domain/session-ops.js', 'apps/desktop/src/presentation/preload.cjs', 'dist-electron/app/handlers.js', 'dist-electron/app/planning-handlers.js', 'dist-electron/domain/calendar-ops.js', packageRoot + '/core/dist/calendar.js', packageRoot + '/core/dist/weekly-budget.js', packageRoot + '/contracts/dist/calendar.js', 'dist-electron/app/lifecycle.js', 'dist-electron/app/state.js', 'dist-electron/infra/agent-service.js', 'dist-electron/infra/dataio.js', 'dist-electron/infra/renderer-flush.js', 'dist-electron/infra/windows.js', 'dist/index.html', ...fs.readdirSync(path.join(buildRoot, 'dist', 'assets')).filter((file) => /\.(?:js|css)$/.test(file)).map((file) => 'dist/assets/' + file)]
const runtime = { startedAt, harnessSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), ownedProcessesSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-processes.mjs'))).digest('hex'), ownedCdpSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-cdp.mjs'))).digest('hex'), executable: electron, buildRoot, executableSha256: createHash('sha256').update(fs.readFileSync(electron)).digest('hex'), files: runtimeFiles.map((file) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(buildRoot, file))).digest('hex') })) }
fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = [], ownedProcesses = new OwnedProcesses(), pages = new Set(), expectedErrorWindows = []
let child, childIdentity, processObservation, page, port, appLog, faultLog, faultOwned = false, inspector, inspectorPort

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
async function connect(url, mainProcess = false) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')) }, { once: true })
  })
  let resolveClosed
  const closed = new Promise(resolve => { resolveClosed = resolve })
  let sequence = 0
  const pending = new Map()
  ws.addEventListener('close', () => {
    resolveClosed()
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP connection closed')) }
    pending.clear()
  })
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (!mainProcess && (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')) errors.push({ url, ...message })
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
  if (!mainProcess) await send('Log.enable')
  const connection = { send, closed, close: () => ws.close(), async evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  } }
  pages.add(connection)
  return connection
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
function nativeMainWindow() {
  const identity = readWindowsProcesses().find((item) => item.ProcessId === child.pid)
  assert.ok(identity && sameProcess(childIdentity, identity), 'Native visibility is measured on the owned Electron')
  const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public struct QaRect { public int Left; public int Top; public int Right; public int Bottom; } public static class QaWindow { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out QaRect rect); [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out QaRect rect); }';
    $owned=Get-Process -Id ${child.pid} -ErrorAction Stop; $owned.Refresh(); $handle=$owned.MainWindowHandle; [uint32]$windowOwner=0;
    [void][QaWindow]::GetWindowThreadProcessId($handle,[ref]$windowOwner);
    $windowRect=[QaRect]::new(); $clientRect=[QaRect]::new();
    $windowRectObserved=[QaWindow]::GetWindowRect($handle,[ref]$windowRect); $clientRectObserved=[QaWindow]::GetClientRect($handle,[ref]$clientRect);
    [pscustomobject]@{pid=$owned.Id;windowPid=$windowOwner;handle=$handle.ToInt64();title=$owned.MainWindowTitle;visible=[QaWindow]::IsWindowVisible($handle);iconic=[QaWindow]::IsIconic($handle);windowRectObserved=$windowRectObserved;clientRectObserved=$clientRectObserved;windowRect=[pscustomobject]@{left=$windowRect.Left;top=$windowRect.Top;right=$windowRect.Right;bottom=$windowRect.Bottom;width=$windowRect.Right-$windowRect.Left;height=$windowRect.Bottom-$windowRect.Top};clientRect=[pscustomobject]@{left=$clientRect.Left;top=$clientRect.Top;right=$clientRect.Right;bottom=$clientRect.Bottom;width=$clientRect.Right-$clientRect.Left;height=$clientRect.Bottom-$clientRect.Top}} | ConvertTo-Json -Compress -Depth 4`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
  assert.equal(result.status, 0, `Native visibility probe: ${result.error?.message ?? result.stderr}`)
  return JSON.parse(result.stdout)
}
async function launch(label) {
  port = await freePort()
  inspectorPort = await freePort()
  assert.notEqual(inspectorPort, port)
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  appLog = path.join(RUN, `${label}-app.log`)
  const log = fs.openSync(appLog, 'a')
  const args = [`--inspect=127.0.0.1:${inspectorPort}`, '--hidden', '--open=main', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`]
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
  const native = await until(() => { const value = nativeMainWindow(); return value.visible && value.windowPid === child.pid && value.title === 'White Box' ? value : null }, 'owned native Main window visible', 20000)
  fs.writeFileSync(path.join(RUN, label + '-native-window.json'), JSON.stringify(native, null, 2))
  check(label + ': owned native Main window is visible', native.visible && native.windowPid === child.pid, native)
  page = await windowPage('main')
  await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs"))'), 'main navigation ready')
  fs.writeFileSync(path.join(RUN, `${label}-processes.json`), JSON.stringify(processSnapshot(), null, 2))
  await attachInspector(label)
}
async function stop(label) {
  const current = child
  assert.ok(current, 'An owned app is running')
  processSnapshot()
  const quitStartedAt = Date.now()
  const beforeQuit = await page.evaluate('({calendarEditors:document.querySelectorAll(".calendar-editor").length,budgetEditors:document.querySelectorAll(".week-budget-dialog").length,errors:[...document.querySelectorAll(".task-command-error[role=alert]")].map(el=>el.textContent)})')
  beforeQuit.sessionEditors = await page.evaluate('document.querySelectorAll("[aria-labelledby=session-editor-title]").length')
  const vetoStatus = '保存できなかった。入力を保持して、この画面を開いたままにしている。'
  check(label + ': quit begins with all editors closed and no unexpected save error', beforeQuit.calendarEditors===0 && beforeQuit.budgetEditors===0 && beforeQuit.sessionEditors===0 && beforeQuit.errors.every(error => nativeVetoes.length>0 && error===vetoStatus), beforeQuit)
  await dropInspector()
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
async function observeScreenshot(name, stage) {
  const observation = { at: new Date().toISOString(), name, stage, expectedPid: child?.pid, expectedCreationDate: childIdentity?.CreationDate, cdpIdentity: page?.identity }
  try { observation.native = nativeMainWindow() } catch (error) { observation.nativeError = error.message }
  try { observation.renderer = await page.evaluate('({url:location.href,readyState:document.readyState,visibilityState:document.visibilityState,hasFocus:document.hasFocus(),width:innerWidth,height:innerHeight,dpr:devicePixelRatio,sessionEditors:document.querySelectorAll("[aria-labelledby=session-editor-title]").length})') } catch (error) { observation.rendererError = error.message }
  try { observation.layoutMetrics = await page.send('Page.getLayoutMetrics') } catch (error) { observation.layoutMetricsError = error.message }
  observation.completedAt = new Date().toISOString()
  try { fs.appendFileSync(path.join(RUN, 'screenshot-native-observations.jsonl'), JSON.stringify(observation) + "\n") } catch (error) { console.error('Screenshot observation receipt could not be written: ' + error.message) }
}
async function screenshot(name, selector, alignment = 'start') {
  await observeScreenshot(name, 'before-bring-to-front')
  await page.send('Page.bringToFront')
  if (selector) await page.evaluate(`(() => { const target=document.querySelector(${JSON.stringify(selector)}); if(!target) throw Error('Missing screenshot target'); target.scrollIntoView({block:${JSON.stringify(alignment)}}); })()`)
  await wait(350)
  await observeScreenshot(name, 'before-capture')
  let shot
  try {
    shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  } catch (error) {
    await observeScreenshot(name, 'capture-error: ' + error.message)
    throw error
  }
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
  await observeScreenshot(name, 'after-capture')
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

const EDITOR = '[role="dialog"][aria-labelledby="session-editor-title"]'
const faultPath = path.join(DATA, 'data.json.tmp')
const nativeVetoes = [], transportTraces = [], noteOnlyProofs = []
let diagnostic, diagnosticOriginal, diagnosticTask, baselineSessions, persisted, auxiliary
const savedSession = () => read().sessions.find(item => item.id === diagnostic.id)
function stableSessionFields(session) { const { note, editedAt, events, ...fields } = session; return fields }
function verifyNoteOnlySave(previous,actual,note,label) {
  check(label+': note-only save preserves precise epochs, 63000ms, pauses, segments, unknown fields and all other session data',actual.note===note&&Number.isFinite(actual.editedAt)&&isDeepStrictEqual(stableSessionFields(actual),stableSessionFields(diagnosticOriginal))&&isDeepStrictEqual(read().sessions.filter(item=>item.id!==diagnostic.id),baselineSessions),actual)
  const expectedEvent={at:actual.editedAt,type:'session_edited',label:'記録を手で修正'}
  check(label+': every prior event is unchanged and exactly one standard edit audit is appended',actual.events.length===previous.events.length+1&&isDeepStrictEqual(actual.events.slice(0,-1),previous.events)&&isDeepStrictEqual(actual.events.at(-1),expectedEvent),{previousEvents:previous.events,actualEvents:actual.events,expectedEvent})
  noteOnlyProofs.push({label,previous,actual,expectedEvent,unchangedFieldsSha256:createHash('sha256').update(JSON.stringify(stableSessionFields(actual))).digest('hex')})
  fs.writeFileSync(path.join(RUN,'session-note-only-preservation.json'),JSON.stringify(noteOnlyProofs,null,2))
}
function writeTraces() { fs.writeFileSync(path.join(RUN, 'session-editor-transport-trace.json'), JSON.stringify({ source: 'Original registered Electron whitebox:cmd handler is invoked unchanged; only its actual response is held and then returned unchanged for one matching diagnostic session:update.', reference: 'https://github.com/electron/electron/blob/main/lib/browser/ipc-main-impl.ts', transportTraces, nativeVetoes }, null, 2)) }
async function attachInspector(label) {
  const target = await until(async () => { const response = await fetch(`http://127.0.0.1:${inspectorPort}/json/list`, { signal: AbortSignal.timeout(1500) }); return (await response.json()).find(item => item.type === 'node') }, 'owned main-process inspector endpoint', 10000)
  inspector = await connect(target.webSocketDebuggerUrl, true)
  const identity = await inspector.evaluate('({pid:process.pid,execPath:process.execPath,data:process.env.WHITEBOX_DATA_DIR,electron:process.versions.electron})')
  check(label + ': Node inspector belongs to the exact owned app and isolated database', identity.pid===child.pid && path.resolve(identity.execPath).toLowerCase()===electron.toLowerCase() && path.resolve(identity.data)===DATA, identity)
  const registered = await inspector.evaluate(`(async()=>{const loader=typeof require==='function'?require:process.getBuiltinModule?.('module')?.createRequire(${JSON.stringify(path.join(buildRoot,'package.json'))});if(typeof loader!=='function')throw Error('No supported CJS loader in the owned inspector');const electron=loader('electron');const ipcMain=electron.ipcMain;const BrowserWindow=electron.BrowserWindow;const original=ipcMain._invokeHandlers?.get('whitebox:cmd');if(typeof original!=='function')throw Error('No original whitebox:cmd handler');const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('#main'));if(!win)throw Error('No owned Main');const observation={channel:'whitebox:cmd',original,ipcMain,win,closeEvents:[],closedAt:null,entry:null,armed:false};observation.onClose=event=>observation.closeEvents.push({at:Date.now(),defaultPrevented:event.defaultPrevented});observation.onClosed=()=>{observation.closedAt=Date.now()};win.on('close',observation.onClose);win.on('closed',observation.onClosed);globalThis.__sessionEditorE2EGate=observation;return {channel:observation.channel,mainWebContentsId:win.webContents.id,mainURL:win.webContents.getURL(),originalHandlerSource:original.toString()};})()`)
  fs.writeFileSync(path.join(RUN, label+'-inspector-handler.json'), JSON.stringify({ target, identity, registered }, null, 2))
  const expected=pathToFileURL(path.join(buildRoot,'dist','index.html')).href+'#main'
  check(label + ': transport observation captures the original IPC handler and exact Main destination', registered.channel==='whitebox:cmd' && decodeURI(registered.mainURL)===decodeURI(expected) && registered.originalHandlerSource.length>0, registered)
}
async function armRealResponseGate(label) {
  const result = await inspector.evaluate(`(()=>{const g=globalThis.__sessionEditorE2EGate;if(g.armed||g.entry?.held)throw Error('Gate already active');g.entry=null;g.armed=true;g.target=${JSON.stringify(diagnostic.id)};g.label=${JSON.stringify(label)};g.wrapper=async(event,payload)=>{const matching=g.armed&&payload?.name==='session:update'&&payload?.args?.id===g.target&&event.sender.id===g.win.webContents.id;if(!matching)return g.original(event,payload);g.armed=false;const entry={label:g.label,channel:g.channel,sourceWebContentsId:event.sender.id,sourceURL:event.sender.getURL(),request:JSON.parse(JSON.stringify(payload)),requestStartedAt:Date.now(),actualResponse:null,resultReadyAt:null,releasedAt:null,returnedAt:null,held:false};g.entry=entry;const actual=await g.original(event,payload);entry.actualResponse=JSON.parse(JSON.stringify(actual));entry.resultReadyAt=Date.now();entry.held=true;await new Promise(resolve=>{entry.release=()=>{entry.releasedAt=Date.now();entry.held=false;resolve()}});entry.returnedAt=Date.now();return actual};g.ipcMain.removeHandler(g.channel);g.ipcMain.handle(g.channel,g.wrapper);return {channel:g.channel,target:g.target,armed:g.armed,originalRetained:true};})()`)
  assert.equal(result.target, diagnostic.id)
  return result
}
async function gateState() { return inspector.evaluate(`(()=>{const g=globalThis.__sessionEditorE2EGate;const e=g?.entry;return {armed:g?.armed,entry:e?{label:e.label,channel:e.channel,sourceWebContentsId:e.sourceWebContentsId,sourceURL:e.sourceURL,request:e.request,requestStartedAt:e.requestStartedAt,actualResponse:e.actualResponse,resultReadyAt:e.resultReadyAt,releasedAt:e.releasedAt,returnedAt:e.returnedAt,held:e.held}:null,closeEvents:g?.closeEvents,closedAt:g?.closedAt};})()`) }
async function releaseGate(label) {
  const before = await gateState()
  assert.ok(before.entry?.held, 'Only a real received response can be released')
  await inspector.evaluate('(()=>{const g=globalThis.__sessionEditorE2EGate;g.entry.release();return true})()')
  const after = await until(async()=>{const state=await gateState();return state.entry?.returnedAt?state:null},'the original actual response is returned unchanged')
  transportTraces.push({ label, before, after })
  writeTraces()
  return after
}
async function dropInspector() {
  if (!inspector) return
  const restored = await inspector.evaluate(`(()=>{const g=globalThis.__sessionEditorE2EGate;if(!g)return {restored:true};if(g.entry?.held)g.entry.release();g.armed=false;g.ipcMain.removeHandler(g.channel);g.ipcMain.handle(g.channel,g.original);g.win.off('close',g.onClose);g.win.off('closed',g.onClosed);return {restored:g.ipcMain._invokeHandlers.get(g.channel)===g.original,entry:g.entry?{held:g.entry.held,releasedAt:g.entry.releasedAt}:null,closeEvents:g.closeEvents,closedAt:g.closedAt};})()`)
  fs.writeFileSync(path.join(RUN, 'inspector-restoration-'+Date.now()+'.json'),JSON.stringify(restored,null,2))
  assert.equal(restored.restored,true)
  inspector.close()
  await Promise.race([inspector.closed,wait(5000).then(()=>{throw Error('Inspector did not disconnect')})])
  pages.delete(inspector)
  inspector=undefined
}
function beginExpectedErrors(label,commands,kind) { const observation={label,file:path.basename(appLog),start:fs.statSync(appLog).size,end:null,commands,kind};expectedErrorWindows.push(observation);return observation }
function endExpectedErrors(observation) { observation.end=fs.statSync(path.join(RUN,observation.file)).size }
function beginSaveFault(label) {
  assert.equal(path.dirname(faultPath),DATA);assert.equal(path.dirname(DATA),RUN);assert.equal(path.dirname(RUN),OUTPUT)
  assert.equal(fs.existsSync(faultPath),false)
  fs.mkdirSync(faultPath);faultOwned=true
  faultLog=beginExpectedErrors(label,['session:update','window:close'],'filesystem')
  assert.throws(()=>fs.writeFileSync(faultPath,'fault probe'),/EISDIR|EACCES|EPERM/)
}
function endSaveFault() { if(faultOwned){endExpectedErrors(faultLog);faultLog=undefined;assert.equal(fs.readdirSync(faultPath).length,0);fs.renameSync(faultPath,path.join(RUN,'completed-save-fault-'+Date.now()));faultOwned=false} }
function applicationErrors() {
  const expected=[],unexpected=[]
  for(const file of fs.readdirSync(RUN).filter(file=>file.endsWith('-app.log'))){let offset=0;for(const rawLine of fs.readFileSync(path.join(RUN,file),'utf8').split(/(?<=\n)/)){const line=rawLine.trimEnd(),at=offset;offset+=Buffer.byteLength(rawLine);if(!/uncaught|unhandled\s*(?:promise|rejection)|\[white-box\].*(?:失敗|できません|読めなかった|窓を閉じません)/i.test(line))continue;const record={file,offset:at,line};const command=line.match(/\[white-box\] コマンド失敗:\s+(\S+)/)?.[1]??(line.startsWith('[white-box] 入力の保存を待つため窓を閉じません:')?'window:close':null);const window=expectedErrorWindows.find(item=>item.file===file&&item.start<=at&&item.end>at&&item.commands.includes(command));const veto=line.startsWith('[white-box] 入力の保存を待つため窓を閉じません:')&&line.includes('入力を保存できなかったため、操作を取り消しました。');const filesystem=/EISDIR|EACCES|EPERM/.test(line)&&line.includes(faultPath);if(window&&!/uncaught|unhandled/i.test(line)&&(window.kind==='filesystem'&&(filesystem||veto)||window.kind==='native-veto'&&veto))expected.push({...record,reason:window.label});else unexpected.push(record)}}
  return {expected,unexpected}
}
async function recorded(taskId,start,end,note,plannedMs=0,exclusions=[]) {
  const session=await call('session:start',{taskId,mode:'stopwatch'})
  await call('session:end');await call('session:skipReview')
  await call('session:update',{id:session.id,patch:{startedAt:start,endedAt:end,note,plannedMs,exclusions}})
  return read().sessions.find(item=>item.id===session.id)
}
async function fixture() {
  const initial=await call('state:get')
  check('Session-editor probe starts in an empty isolated database',initial.projects.length===0&&initial.tasks.length===0&&initial.sessions.length===0)
  const now=Date.now()
  await call('settings:update',{patch:{onboardedAt:now,lastWelcomeDate:calendar(now-4*60*MINUTE),dayStartHour:4,showSessionCard:false,soundOnExpire:false,autoPauseOnSuspend:false,launchAtLogin:false,shortcuts:{startPause:'',currentWork:'',dashboard:''}}})
  await page.send('Page.reload');await until(()=>page.evaluate('Boolean(document.querySelector(".rail-tabs"))&&!document.querySelector(".onboarding")&&!document.querySelector(".welcome")'),'isolated onboarding dismissed')
  const project=await call('project:create',{name:'記録編集の隔離検証'})
  const task=await call('task:create',{title:'保持する元の記録',projectId:project.id,status:'todo'})
  await recorded(task.id,at(thisWeek,8),at(thisWeek,8,30),'変更しないbaseline実績')
  diagnosticTask=await call('task:create',{title:'診断用の20秒記録',projectId:project.id,status:'todo'})
  const start=at(thisWeek,9)+12_345,end=start+20_000
  diagnostic=await recorded(diagnosticTask.id,start,end,'診断用・保存前のひとこと',63_000,[{startedAt:start+4_000,endedAt:start+8_000}])
  diagnosticOriginal=structuredClone(diagnostic)
  baselineSessions=read().sessions.filter(item=>item.id!==diagnostic.id)
  check('Diagnostic session has precise 20-second times, 63000ms planned time and a precise exclusion',diagnostic.startedAt===start&&diagnostic.endedAt===end&&diagnostic.plannedMs===63_000&&diagnostic.pauses.some(pause=>pause.reason==='excluded'&&pause.startedAt===start+4_000&&pause.endedAt===start+8_000))
  fs.writeFileSync(path.join(RUN,'fixture-database.json'),JSON.stringify(read(),null,2))
  await tab(8,'.week-workspace')
}
async function seedUnknownFieldAfterNaturalQuit() {
  const before=read(),baselineBytes=JSON.stringify(before.sessions.filter(item=>item.id!==diagnostic.id))
  await stop('seed')
  check('Seed app naturally exits before any offline diagnostic-only fixture addition',!child&&processSnapshot().length===0&&isDeepStrictEqual(read(),before))
  const database=read(),target=database.sessions.find(item=>item.id===diagnostic.id)
  assert.ok(target)
  assert.equal(Object.hasOwn(target,'futureProbeMetadata'),false)
  target.futureProbeMetadata={origin:'offline-isolated-diagnostic-fixture',values:['未知のSession field',63_000,12_345],nested:{retained:true}}
  assert.equal(JSON.stringify(database.sessions.filter(item=>item.id!==diagnostic.id)),baselineBytes)
  const temporary=path.join(DATA,'diagnostic-unknown-fields.fixture.tmp')
  assert.equal(path.dirname(temporary),DATA);assert.equal(fs.existsSync(temporary),false)
  fs.writeFileSync(path.join(RUN,'before-unknown-field-seed.json'),JSON.stringify(before,null,2))
  fs.writeFileSync(temporary,JSON.stringify(database,null,2),'utf8');fs.renameSync(temporary,path.join(DATA,'data.json'))
  fs.writeFileSync(path.join(RUN,'unknown-field-fixture.json'),JSON.stringify({route:'Offline filesystem fixture addition after real app:quit and zero owned PIDs; strict session:update is not used to introduce an unknown field',diagnosticId:diagnostic.id,unknownField:target.futureProbeMetadata,baselineSessionsSha256:createHash('sha256').update(baselineBytes).digest('hex')},null,2))
  await launch('first')
  const reloaded=await call('state:get')
  check('Normal app reload positively reads the unknown diagnostic field and every original baseline session unchanged',stateMatchesDatabase(reloaded,database)&&isDeepStrictEqual(read(),database)&&JSON.stringify(read().sessions.filter(item=>item.id!==diagnostic.id))===baselineBytes&&isDeepStrictEqual(savedSession().futureProbeMetadata,target.futureProbeMetadata),savedSession())
  diagnosticOriginal=structuredClone(savedSession())
  await tab(8,'.week-workspace')
}
async function openEditor() {
  if(!await page.evaluate('Boolean(document.querySelector(".week-event-detail"))')){
    const selector=await page.evaluate(`(()=>{const event=[...document.querySelectorAll('[data-calendar-event="actual"]')].find(el=>el.getAttribute('aria-label')?.includes(${JSON.stringify(diagnosticTask.title)}));if(!event)return null;event.setAttribute('data-session-editor-e2e-target','true');return '[data-session-editor-e2e-target="true"]'})()`)
    assert.ok(selector,'The diagnostic actual block is present in the real weekly calendar')
    await click(selector);await until(()=>page.evaluate('Boolean(document.querySelector(".week-event-detail .srow"))'),'actual block opens its SessionRow')
    await click('.week-event-detail .srow-main')
  }
  await button('記録を修正','.week-event-detail')
  await until(()=>page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR)}))`),'real SessionEditor opens above the actual record')
}
const inspectEditor=()=>page.evaluate(`(()=>{const editor=document.querySelector(${JSON.stringify(EDITOR)});return editor?{values:[...editor.querySelectorAll('input,select,textarea')].map(el=>({type:el.type,value:el.value,checked:el.checked??null})),disabled:[...editor.querySelectorAll('input,select,textarea,button')].map(el=>({tag:el.tagName,type:el.type,text:el.textContent,disabled:el.disabled})),confirmation:editor.querySelector('.calendar-confirm')?.textContent??null,error:editor.querySelector('.editor-ex-error')?.textContent??null,busy:[...editor.querySelectorAll('button')].some(el=>el.textContent.trim()==='保存中…')}:null})()`)
async function backdrop() {
  const point=await page.evaluate(`(()=>{const editor=document.querySelector(${JSON.stringify(EDITOR)});const scrim=editor?.parentElement;for(const point of [{x:2,y:2},{x:innerWidth-2,y:2},{x:2,y:innerHeight-2}])if(document.elementFromPoint(point.x,point.y)===scrim)return point;throw Error('No reachable top SessionEditor backdrop')})()`)
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await wait(100)
}
async function discardEditor() {
  await button('やめる',EDITOR)
  if(await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR+' .calendar-confirm')}))`))await button('入力を破棄して閉じる',EDITOR)
  await until(()=>page.evaluate(`!document.querySelector(${JSON.stringify(EDITOR)})`),'explicit SessionEditor discard closes only the editor')
}
async function verifyDirtyDismissal() {
  await openEditor();await fill(EDITOR+' .editor-note input','未保存の記録メモを保持する')
  const before=read(),draft=(await inspectEditor()).values
  for(const [label,attempt] of [['Escape',()=>key('Escape','Escape')],['backdrop',backdrop],['やめる',()=>button('やめる',EDITOR)]]){
    await attempt();const editor=await inspectEditor()
    check('Dirty SessionEditor '+label+' asks before discarding and retains every input',editor?.confirmation?.includes('保存前の入力を破棄して閉じる？')&&isDeepStrictEqual(editor.values,draft)&&isDeepStrictEqual(read(),before),editor)
    await screenshot('01-dirty-'+({Escape:'escape',backdrop:'backdrop','やめる':'cancel'}[label]),EDITOR,'center')
    await button('編集を続ける',EDITOR)
  }
  await discardEditor()
  check('Explicit SessionEditor discard leaves the original diagnostic and every baseline session unchanged',isDeepStrictEqual(read(),before)&&isDeepStrictEqual(savedSession(),diagnosticOriginal)&&isDeepStrictEqual(read().sessions.filter(item=>item.id!==diagnostic.id),baselineSessions))
  check('Discarding the nested SessionEditor keeps its actual-record detail open',await page.evaluate('Boolean(document.querySelector(".week-event-detail .srow"))'))
}
async function saveAndBackdropSameTask() {
  return page.evaluate(`(()=>{const editor=document.querySelector(${JSON.stringify(EDITOR)});const save=[...editor.querySelectorAll('button')].find(el=>el.textContent.trim()==='修正を保存');if(!save)throw Error('Missing real Save button');const scrim=editor.parentElement;save.click();scrim.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return {editorRemains:Boolean(document.querySelector(${JSON.stringify(EDITOR)})),confirmation:editor.querySelector('.calendar-confirm')?.textContent??null}})()`)
}
async function nativeVeto(label,observation) {
  const log=await until(()=>fs.readFileSync(appLog).subarray(observation.start).toString('utf8').split(/\r?\n/).find(line=>line.startsWith('[white-box] 入力の保存を待つため窓を閉じません:')),'actual native close handler veto',10000)
  const native=nativeMainWindow(),editor=await inspectEditor(),state=await gateState()
  const trace={label,log,native,editor,closeEvents:state.closeEvents,closedAt:state.closedAt,ownedPid:child.pid}
  nativeVetoes.push(trace);writeTraces()
  check(label+': the real native close is vetoed while the same owned Main and editor remain',native.visible&&native.windowPid===child.pid&&editor&&state.closedAt===null&&state.closeEvents.at(-1)?.defaultPrevented===true&&log.includes('入力を保存できなかったため、操作を取り消しました。'),trace)
  return trace
}
async function verifyHeldFailureAndRetry() {
  await openEditor();const note='保存失敗の実IPC結果を待ってから再試行する'
  await fill(EDITOR+' .editor-note input',note)
  const database=read(),draft=(await inspectEditor()).values
  beginSaveFault('SessionEditor actual filesystem rejection and native wait')
  try {
    await armRealResponseGate('actual-failure')
    const sameTask=await saveAndBackdropSameTask()
    const state=await until(async()=>{const state=await gateState();return state.entry?.held?state:null},'actual rejected Session update response is held')
    check('Saving and immediate backdrop in the same UI task retain the SessionEditor without a discard prompt',sameTask.editorRemains&&!sameTask.confirmation,sameTask)
    check('Held failure comes from the original real session:update endpoint for only the diagnostic ID',state.entry.request.name==='session:update'&&state.entry.request.args.id===diagnostic.id&&state.entry.actualResponse.ok===false&&isDeepStrictEqual(Object.keys(state.entry.request.args.patch),['note'])&&state.entry.request.args.patch.note===note,state)
    await until(()=>page.evaluate(`document.querySelector(${JSON.stringify(EDITOR)})&&[...document.querySelectorAll(${JSON.stringify(EDITOR+' input,'+EDITOR+' select,'+EDITOR+' button')})].every(el=>el.disabled)`),'all SessionEditor fields and actions disabled while the real response is held')
    const busy=await inspectEditor()
    check('Saving disables every SessionEditor field and action while retaining the exact draft',busy.busy&&busy.disabled.length>6&&busy.disabled.every(control=>control.disabled)&&isDeepStrictEqual(busy.values,draft),busy)
    await key('Escape','Escape');await backdrop()
    check('Saving Escape and backdrop keep the existing editor without confirmation',Boolean(await inspectEditor())&&!(await inspectEditor()).confirmation)
    const offset=fs.statSync(appLog).size
    await call('window:close',{kind:'main'})
    await until(()=>page.evaluate('document.querySelector(".main")?.getAttribute("aria-busy")==="true"&&Boolean(document.querySelector(".editor-flush-status"))'),'native close is waiting on the real running Session save')
    await wait(350)
    const waiting=await gateState(),native=nativeMainWindow()
    check('Native close waits for the held real save result before deciding whether Main can close',waiting.entry.held&&waiting.closedAt===null&&waiting.closeEvents.at(-1)?.defaultPrevented===true&&native.visible&&!fs.readFileSync(appLog).subarray(offset).toString('utf8').includes('入力の保存を待つため窓を閉じません:'),{waiting,native})
    await screenshot('02-saving-native-awaits-real-result',EDITOR,'center')
    await releaseGate('actual-failure')
    await nativeVeto('Actual rejected save',faultLog)
    const failed=await until(async()=>{const editor=await inspectEditor();return editor&&!editor.busy&&editor.error?editor:null},'failed real save retains an operable SessionEditor')
    check('Actual write failure preserves every field and fully rolls back disk and exposed state',isDeepStrictEqual(failed.values,draft)&&isDeepStrictEqual(read(),database)&&stateMatchesDatabase(await call('state:get'),database),failed)
    await screenshot('03-save-failure-fields-retained',EDITOR,'center')
  } finally { endSaveFault() }
  await button('修正を保存',EDITOR)
  await until(()=>page.evaluate(`!document.querySelector(${JSON.stringify(EDITOR)})`),'retry saves the retained SessionEditor draft')
  verifyNoteOnlySave(database.sessions.find(item=>item.id===diagnostic.id),savedSession(),note,'Retry after actual write failure')
}
async function verifyDirtyNativeVeto() {
  await openEditor();await fill(EDITOR+' .editor-note input','実際の窓終了でも破棄しない診断メモ')
  const database=read(),draft=(await inspectEditor()).values,window=beginExpectedErrors('Dirty SessionEditor native close veto',['window:close'],'native-veto')
  await call('window:close',{kind:'main'})
  await nativeVeto('Dirty SessionEditor',window)
  endExpectedErrors(window)
  check('Dirty native veto retains every field and the complete saved database',isDeepStrictEqual((await inspectEditor()).values,draft)&&isDeepStrictEqual(read(),database)&&stateMatchesDatabase(await call('state:get'),database))
  await screenshot('04-dirty-native-close-veto',EDITOR,'center')
  await discardEditor()
  check('Discard after native veto changes no saved field or baseline session',isDeepStrictEqual(read(),database)&&isDeepStrictEqual(read().sessions.filter(item=>item.id!==diagnostic.id),baselineSessions))
}
async function verifyHeldSuccess() {
  await call('window:open',{kind:'start'});auxiliary=await windowPage('start')
  await openEditor();const note='native保存待ちの完了後にも保持する最終メモ'
  await fill(EDITOR+' .editor-note input',note)
  const draft=(await inspectEditor()).values,previous=structuredClone(savedSession())
  await armRealResponseGate('actual-success')
  const sameTask=await saveAndBackdropSameTask()
  const held=await until(async()=>{const state=await gateState();return state.entry?.held?state:null},'actual successful Session update response is held')
  verifyNoteOnlySave(previous,savedSession(),note,'Held successful real save')
  check('The pending successful save uses only the original endpoint and note-only patch',sameTask.editorRemains&&held.entry.actualResponse.ok===true&&held.entry.request.args.id===diagnostic.id&&isDeepStrictEqual(Object.keys(held.entry.request.args.patch),['note'])&&savedSession().note===note&&isDeepStrictEqual(stableSessionFields(savedSession()),stableSessionFields(diagnosticOriginal)),held)
  const busy=await inspectEditor()
  check('A held successful result keeps every field disabled with the complete draft',busy?.busy&&busy.disabled.every(control=>control.disabled)&&isDeepStrictEqual(busy.values,draft),busy)
  await call('window:close',{kind:'main'})
  await until(()=>page.evaluate('document.querySelector(".main")?.getAttribute("aria-busy")==="true"'),'successful native close waits for the real running promise')
  await wait(350)
  const waiting=await gateState()
  check('Main stays live while the successful real save result remains held',waiting.entry.held&&waiting.closedAt===null&&waiting.closeEvents.at(-1)?.defaultPrevented===true,waiting)
  await screenshot('05-successful-save-native-wait',EDITOR,'center')
  await releaseGate('actual-success')
  const closed=await until(async()=>{const state=await gateState();return state.closedAt?state:null},'Main naturally closes only after the original save result is returned',10000)
  transportTraces.push({label:'successful-native-close-after-real-save',closed});writeTraces()
  check('Native Main closes after successful real save with a second approved close event',closed.entry.returnedAt<=closed.closedAt&&closed.closeEvents.at(-1)?.defaultPrevented===false&&savedSession().note===note&&isDeepStrictEqual(stableSessionFields(savedSession()),stableSessionFields(diagnosticOriginal)),closed)
  persisted=read();fs.writeFileSync(path.join(RUN,'before-restart-database.json'),JSON.stringify(persisted,null,2))
  page=auxiliary
}
async function closeFailureEditors() {
  if(inspector){try{const state=await gateState();if(state.entry?.held)await releaseGate('failure-cleanup')}catch{}}
  if(page){try{if(await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR)}))`))await discardEditor()}catch{}}
}
let exitCode=1
try {
  await launch('seed');await fixture();await seedUnknownFieldAfterNaturalQuit();await verifyDirtyDismissal();await verifyHeldFailureAndRetry();await verifyDirtyNativeVeto();await verifyHeldSuccess()
  check('All SessionEditor operations preserve every original baseline session',isDeepStrictEqual(read().sessions.filter(item=>item.id!==diagnostic.id),baselineSessions))
  await stop('first');check('Natural quit preserves the entire saved SessionEditor database',isDeepStrictEqual(read(),persisted))
  await launch('restart');check('Restart restores every saved diagnostic and baseline session field',stateMatchesDatabase(await call('state:get'),persisted))
  await tab(8,'.week-workspace');await openEditor()
  check('The restarted real SessionEditor restores the final note and original precise session values',await page.evaluate(`document.querySelector(${JSON.stringify(EDITOR+' .editor-note input')}).value===${JSON.stringify(savedSession().note)}`)&&isDeepStrictEqual(stableSessionFields(savedSession()),stableSessionFields(diagnosticOriginal))&&savedSession().plannedMs===63_000,savedSession())
  await screenshot('06-session-editor-after-restart',EDITOR,'center');await discardEditor();await key('Escape','Escape')
  await stop('restart');check('Final natural quit changes no database field or baseline session',isDeepStrictEqual(read(),persisted)&&isDeepStrictEqual(read().sessions.filter(item=>item.id!==diagnostic.id),baselineSessions))
  const appErrors=applicationErrors();fs.writeFileSync(path.join(RUN,'application-errors.json'),JSON.stringify(appErrors,null,2))
  check('The actual filesystem fault and two observed native vetoes are the only app errors',appErrors.expected.length===3&&appErrors.unexpected.length===0,appErrors)
  check('Every monitored SessionEditor renderer has no console error or uncaught exception',errors.length===0,errors)
  check('No owned Electron PID remains after SessionEditor natural shutdowns',processSnapshot().length===0,processObservation)
  exitCode=0
} catch(error) {
  console.error(error);fs.writeFileSync(path.join(RUN,'failure.txt'),error.stack||String(error))
  if(page){try{await screenshot('failure');fs.writeFileSync(path.join(RUN,'failure-dom.txt'),await page.evaluate('document.body.innerText'))}catch{}}
} finally {
  endSaveFault();writeTraces()
  if(exitCode!==0&&child){try{await closeFailureEditors()}catch(error){console.error(error)}}
  if(child){try{await stop('failure')}catch(error){console.error(error);exitCode=1}}
  if(inspector){try{await dropInspector()}catch(error){console.error(error)}}
  if(exitCode!==0){const remaining=processSnapshot();fs.writeFileSync(path.join(RUN,'failure-owned-processes.json'),JSON.stringify(processObservation,null,2));if(remaining.length){fs.writeFileSync(path.join(RUN,'forced-cleanup-processes.json'),JSON.stringify(remaining,null,2));for(const item of remaining.reverse()){const current=processSnapshot().find(process=>sameProcess(process,item));if(current)try{process.kill(current.ProcessId,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error}}}}
  for(const connection of pages)connection.close()
  fs.writeFileSync(path.join(RUN,'result.json'),JSON.stringify({exitCode,startedAt,completedAt:new Date().toISOString(),executable:electron,checks,errors,expectedErrorWindows,artifacts:fs.readdirSync(RUN)},null,2));console.log(`Evidence: ${RUN}`);process.exit(exitCode)
}

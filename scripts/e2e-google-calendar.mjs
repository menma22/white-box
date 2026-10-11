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
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'google-calendar-run-'))
const DATA = path.join(RUN, 'data'), PROFILE = path.join(RUN, 'profile')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const buildRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
const startedAt = new Date().toISOString(), checks = [], errors = [], expectedErrors = [], pages = new Set()
const ownedProcesses = new OwnedProcesses()
let child, childIdentity, page, inspector, port, appLog, processObservation
const SETTINGS = '.google-calendar-settings', EDITOR = '[aria-labelledby="google-editor-title"]'
const CLIENT = 'fixture-desktop.apps.googleusercontent.com', SECRET = 'fixture-client-secret-only'
const ACCESS = 'fixture-access-token-only', REFRESH = 'fixture-refresh-token-only'
const calendar = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const today = new Date(); today.setHours(0, 0, 0, 0)
const at = (day, hour, minute = 0) => { const value = new Date(day); value.setHours(hour, minute, 0, 0); return value.getTime() }
const timed = (id, title, start, end, extra = {}) => ({ id, summary: title, start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() }, ...extra })
const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
const previous = new Date(today); previous.setDate(previous.getDate() - 1)
const FIXTURE = {
  access: ACCESS, refresh: REFRESH,
  calendars: [{ id: 'primary@example.test', summary: 'Fixture main', accessRole: 'owner', primary: true }, { id: 'readonly@example.test', summary: 'Fixture read only', accessRole: 'reader' }],
  events: {
    'primary@example.test': [
      timed('timed', 'Google timed fixture', at(today, 11), at(today, 12), { location: 'Fixture room', htmlLink: 'https://calendar.google.com/calendar/event?eid=fixture' }),
      timed('recurring-instance', 'Google recurring occurrence', at(today, 11, 30), at(today, 12, 30), { recurringEventId: 'recurring-master', originalStartTime: { dateTime: new Date(at(today, 11, 30)).toISOString() } }),
      timed('overnight', 'Google overnight fixture', at(previous, 23), at(today, 1)),
      { id: 'all-day', summary: 'Google all-day fixture', start: { date: calendar(today) }, end: { date: calendar(tomorrow) } },
      { id: 'cancelled', status: 'cancelled' },
    ],
    'readonly@example.test': [timed('read-only', 'Google read only fixture', at(today, 15), at(today, 16))],
  },
}
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const files = ['dist-electron/presentation/main.js', 'dist-electron/app/google-calendar-service.js', 'dist-electron/app/google-calendar-handlers.js', 'dist-electron/infra/google-calendar-oauth.js', 'dist-electron/infra/google-calendar-secrets.js', 'apps/desktop/src/presentation/preload.cjs', 'dist/index.html', ...fs.readdirSync(path.join(buildRoot, 'dist/assets')).filter(file => /\.(?:js|css)$/.test(file)).map(file => 'dist/assets/' + file)]
fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify({ startedAt, mode: 'simulated-google-api-real-electron-ipc-ui-loopback-and-os-encryption', realAccountOAuth: false, externalGoogleTraffic: false, executable: electron, executableSha256: sha256(electron), harnessSha256: sha256(fileURLToPath(import.meta.url)), ownedCdpSha256: sha256(path.join(ROOT, 'scripts/owned-cdp.mjs')), ownedProcessesSha256: sha256(path.join(ROOT, 'scripts/owned-processes.mjs')), buildRoot, files: files.map(file => ({ file, sha256: sha256(path.join(buildRoot, file)) })) }, null, 2))
fs.writeFileSync(path.join(RUN, 'google-fixtures.json'), JSON.stringify(FIXTURE, null, 2))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(name, condition, detail) { checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); assert.ok(condition, name) }
async function until(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout; let last
  while (Date.now() < deadline) { try { const value = await test(); if (value) return value } catch (error) { last = error } await wait(100) }
  throw new Error(`Timed out: ${label}${last ? ' / ' + last.message : ''}`)
}
async function freePort() { const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value }
function processSnapshot() { processObservation = ownedProcesses.observe(readWindowsProcesses()); fs.writeFileSync(path.join(RUN, 'owned-process-observation.json'), JSON.stringify(processObservation, null, 2)); return processObservation.remaining }
function nativeWindow() {
  const current = readWindowsProcesses().find(item => item.ProcessId === child.pid)
  assert.ok(current && sameProcess(current, childIdentity), 'Native window belongs to the live owned process')
  const source = "using System; using System.Runtime.InteropServices; public static class GoogleQaWindow { [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }"
  const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -TypeDefinition '${source}'; $owned=Get-Process -Id ${child.pid} -ErrorAction Stop; $owned.Refresh(); [uint32]$owner=0; [void][GoogleQaWindow]::GetWindowThreadProcessId($owned.MainWindowHandle,[ref]$owner); [pscustomobject]@{pid=$owned.Id;windowPid=$owner;visible=[GoogleQaWindow]::IsWindowVisible($owned.MainWindowHandle);title=$owned.MainWindowTitle} | ConvertTo-Json -Compress`
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(result.status, 0, result.error?.message ?? result.stderr); return JSON.parse(result.stdout)
}
async function inspectorConnection(url) {
  const endpoint = new URL(url)
  assert.equal(endpoint.protocol, 'ws:'); assert.equal(endpoint.hostname, '127.0.0.1')
  const socket = new WebSocket(url), pending = new Map(), events = [], scripts = new Map(); let sequence = 0, resolveClosed, contextId
  const closed = new Promise(resolve => { resolveClosed = resolve })
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (['Runtime.executionContextCreated', 'Debugger.paused', 'Debugger.resumed'].includes(message.method)) events.push(message); if (message.method === 'Debugger.scriptParsed') scripts.set(message.params.scriptId, message.params); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer); if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails))); else request.resolve(message.result) })
  socket.addEventListener('close', () => { resolveClosed(); for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Owned main inspector closed')) } pending.clear() })
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Inspector open timeout')), 10000); socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true }); socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Inspector open failed')) }, { once: true }) })
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error('Inspector timeout: ' + method)) }, 10000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })) })
  return { send, closed, events, scripts, selectContext(value) { contextId = value }, close: () => socket.close(), async evaluate(expression) { return (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId === undefined ? {} : { contextId }) })).result.value } }
}

async function pauseAtMainEntry(label) {
  await inspector.send('Runtime.enable')
  await inspector.send('Debugger.enable')
  const mainUrl = pathToFileURL(path.join(buildRoot, 'dist-electron/presentation/main.js')).href
  const breakpoint = await inspector.send('Debugger.setBreakpointByUrl', { url: mainUrl, lineNumber: 0 })
  const bootstrap = { mainUrl, breakpoint, pauses: [] }
  fs.writeFileSync(path.join(RUN, label + '-inspector-bootstrap.json'), JSON.stringify(bootstrap, null, 2))
  await inspector.send('Runtime.runIfWaitingForDebugger')
  let observed = 0
  for (let attempt = 0; attempt < 12; attempt++) {
    const event = await until(() => inspector.events.filter(item => item.method === 'Debugger.paused')[observed], 'owned main bootstrap pause', 15000)
    observed++
    const frame = event.params.callFrames[0], script = inspector.scripts.get(frame.location.scriptId)
    const url = script?.url || frame.url
    bootstrap.pauses.push({ reason: event.params.reason, hitBreakpoints: event.params.hitBreakpoints, url, executionContextId: script?.executionContextId, frame })
    bootstrap.contexts = inspector.events.filter(item => item.method === 'Runtime.executionContextCreated').map(item => item.params.context)
    fs.writeFileSync(path.join(RUN, label + '-inspector-bootstrap.json'), JSON.stringify(bootstrap, null, 2))
    if (url === mainUrl) {
      const probe = await inspector.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: '({processType:typeof process,pid:typeof process===\'undefined\'?null:process.pid,data:typeof process===\'undefined\'?null:process.env.WHITEBOX_DATA_DIR})', returnByValue: true })
      check(label + ': actual main entry frame has owned Node process before service startup', probe.result.value?.pid === child.pid && path.resolve(probe.result.value.data) === DATA, probe.result.value)
      assert.ok(Number.isInteger(script.executionContextId), 'Main entry has an observable execution context')
      inspector.selectContext(script.executionContextId)
      bootstrap.frameProbe = probe.result.value
      fs.writeFileSync(path.join(RUN, label + '-inspector-bootstrap.json'), JSON.stringify(bootstrap, null, 2))
      return breakpoint.breakpointId
    }
    await inspector.send('Debugger.resume')
  }
  throw new Error('Owned app did not reach the actual main entry breakpoint')
}

function installTransport(fixture, packageFile, profile) {
  const loader = typeof require === 'function' ? require : process.getBuiltinModule('module').createRequire(packageFile)
  const electron = loader('electron'), originalFetch = globalThis.fetch
  if (loader('node:path').resolve(electron.app.getPath('userData')) !== profile) throw new Error('CLI profile is not isolated; refusing to start the service')
  const state = { requests: [], callbacks: [], shellCalls: [], created: {}, offline: false, ambiguousCreate: true, blocked: [], holdOAuthCallbacks: false, heldCallbacks: [] }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  globalThis.__googleE2E = state
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input)), method = init.method ?? 'GET'
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return originalFetch(input, init)
    if (!['oauth2.googleapis.com', 'www.googleapis.com'].includes(url.hostname)) { state.blocked.push({ url: url.href, method }); throw new Error('Unexpected external fixture fetch blocked') }
    init.signal?.throwIfAborted()
    const request = { url: url.href, method, at: Date.now() }; state.requests.push(request)
    if (state.offline) { request.offline = true; throw new TypeError('Synthetic Google API offline') }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const fields = new URLSearchParams(init.body)
      request.grantType = fields.get('grant_type')
      if (request.grantType === 'authorization_code') {
        if (fields.get('code') !== 'fixture-authorization-code' || !fields.get('code_verifier') || fields.get('redirect_uri') !== state.redirectUri) throw new Error('Real OAuth exchange fields missing')
        const challenge = loader('node:crypto').createHash('sha256').update(fields.get('code_verifier')).digest('base64url')
        if (challenge !== state.challenge) throw new Error('PKCE exchange does not match the real authorize URL')
        request.pkceVerified = true
      } else if (fields.get('refresh_token') !== fixture.refresh) throw new Error('Real encrypted refresh token was not loaded')
      return json({ access_token: fixture.access, refresh_token: fixture.refresh, expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/userinfo.email' })
    }
    if (new Headers(init.headers).get('Authorization') !== 'Bearer ' + fixture.access) throw new Error('Google fixture requires actual bearer handling')
    if (url.pathname === '/oauth2/v2/userinfo') return json({ email: 'fixture-user@example.test' })
    if (url.pathname === '/calendar/v3/users/me/calendarList') return json(url.searchParams.get('pageToken') === 'calendars-next' ? { items: fixture.calendars.slice(1) } : { items: fixture.calendars.slice(0, 1), nextPageToken: 'calendars-next' })
    const matched = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/)
    if (!matched) { state.blocked.push(request); throw new Error('Unexpected Google fixture endpoint') }
    const calendarId = decodeURIComponent(matched[1]), eventId = matched[2]
    request.calendarId = calendarId
    if (method === 'POST') {
      const body = JSON.parse(init.body); request.body = body
      if (!/^[0-9a-v]+$/.test(body.id) || !body.extendedProperties?.private?.whiteBoxRequest) throw new Error('Production stable event identity absent')
      const key = calendarId + '\0' + body.id
      if (state.created[key]) return json({ error: { code: 409 } }, 409)
      state.created[key] = body
      if (state.ambiguousCreate) { state.ambiguousCreate = false; request.committedButResponseLost = true; throw new TypeError('Synthetic response lost after Google committed the event') }
      return json(body)
    }
    if (eventId) return state.created[calendarId + '\0' + eventId] ? json(state.created[calendarId + '\0' + eventId]) : json({}, 404)
    if (url.searchParams.get('singleEvents') !== 'true' || url.searchParams.get('showDeleted') !== 'false' || !url.searchParams.get('timeMin') || !url.searchParams.get('timeMax')) throw new Error('Production event range or recurring expansion missing')
    const min = Date.parse(url.searchParams.get('timeMin')), max = Date.parse(url.searchParams.get('timeMax'))
    const items = [...(fixture.events[calendarId] ?? []), ...Object.entries(state.created).filter(([key]) => key.startsWith(calendarId + '\0')).map(([, value]) => value)].filter(event => event.status === 'cancelled' || Date.parse(event.start.dateTime ?? event.start.date) < max && Date.parse(event.end.dateTime ?? event.end.date) > min)
    return json(url.searchParams.get('pageToken') === 'events-next' ? { items: items.slice(2) } : { items: items.slice(0, 2), ...(items.length > 2 ? { nextPageToken: 'events-next' } : {}) })
  }
  electron.shell.openExternal = async (uri) => {
    const url = new URL(uri); state.shellCalls.push({ origin: url.origin, path: url.pathname })
    if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Unexpected external browser launch blocked')
    state.redirectUri = url.searchParams.get('redirect_uri'); state.challenge = url.searchParams.get('code_challenge')
    const callback = new URL(state.redirectUri)
    if (callback.origin !== `http://127.0.0.1:${callback.port}` || callback.pathname !== '/oauth2callback' || !url.searchParams.get('state') || url.searchParams.get('code_challenge_method') !== 'S256') throw new Error('Loopback OAuth URL invalid')
    callback.searchParams.set('code', 'fixture-authorization-code'); callback.searchParams.set('state', 'incorrect-state')
    const invalid = await originalFetch(callback, { redirect: 'error', signal: AbortSignal.timeout(5000) }); state.callbacks.push({ kind: 'invalid-state', status: invalid.status }); await invalid.text()
    if (state.holdOAuthCallbacks) { state.heldCallbacks.push({ redirectUri: state.redirectUri, at: Date.now(), invalidStateStatus: invalid.status }); return }
    callback.searchParams.set('state', url.searchParams.get('state'))
    const valid = await originalFetch(callback, { redirect: 'error', signal: AbortSignal.timeout(5000) }); state.callbacks.push({ kind: 'valid-state', status: valid.status }); await valid.text()
  }
  return { pid: process.pid, data: process.env.WHITEBOX_DATA_DIR, execPath: process.execPath, loader: typeof loader, shell: typeof electron.shell.openExternal, fetch: typeof globalThis.fetch, installedBeforeMain: true }
}

async function launch(label) {
  port = await freePort(); const inspectorPort = await freePort(); assert.notEqual(port, inspectorPort)
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }; delete env.VITE_DEV_SERVER_URL; delete env.ELECTRON_RUN_AS_NODE
  appLog = path.join(RUN, label + '-app.log'); const descriptor = fs.openSync(appLog, 'a')
  const args = [`--inspect-brk=127.0.0.1:${inspectorPort}`, '--hidden', '--open=main', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`]
  if (!process.env.WHITEBOX_EXE) args.unshift(ROOT)
  const notBefore = Date.now(); child = spawn(electron, args, { cwd: ROOT, env, stdio: ['ignore', descriptor, descriptor], windowsHide: true }); fs.closeSync(descriptor)
  child.once('error', error => errors.push({ launch: label, error: error.message })); assert.ok(child.pid)
  childIdentity = await until(() => readWindowsProcesses().find(item => item.ProcessId === child.pid), 'owned Electron identity')
  ownedProcesses.registerRoot(childIdentity, { parentPid: process.pid, name: path.basename(electron), notBefore }); processSnapshot()
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`, { signal: AbortSignal.timeout(1500) })).json()).find(item => item.type === 'node'), 'main inspector before main entry')
  assert.equal(new URL(target.webSocketDebuggerUrl).port, String(inspectorPort))
  inspector = await inspectorConnection(target.webSocketDebuggerUrl)
  const entryBreakpoint = await pauseAtMainEntry(label)
  const identity = await inspector.evaluate(`(${installTransport.toString()})(${JSON.stringify(FIXTURE)},${JSON.stringify(path.join(buildRoot, 'package.json'))},${JSON.stringify(PROFILE)})`)
  check(label + ': fixture transport installed in exact owned ESM main before service startup', identity.pid === child.pid && path.resolve(identity.data) === DATA && path.resolve(identity.execPath).toLowerCase() === electron.toLowerCase() && identity.loader === 'function', identity)
  fs.writeFileSync(path.join(RUN, label + '-inspector.json'), JSON.stringify({ target, identity }, null, 2))
  await inspector.send('Debugger.removeBreakpoint', { breakpointId: entryBreakpoint })
  await inspector.send('Debugger.resume')
  await inspector.send('Debugger.disable')
  const expectedUrl = pathToFileURL(path.join(buildRoot, 'dist/index.html')).href + '#main'
  page = await connectOwnedPage({ port, kind: 'main', expectedUrl, child, childIdentity, ownedProcesses, onEvent(message) { if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message) } })
  pages.add(page); await until(() => page.evaluate('Boolean(window.whitebox && document.querySelector(".rail-tabs"))'), 'real app ready'); await page.send('Page.bringToFront')
  const native = nativeWindow(); check(label + ': real owned native window visible', native.visible && native.windowPid === child.pid, native)
  const safety = await inspector.evaluate(`(()=>{const e=process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(buildRoot, 'package.json'))})('electron');return {safeStorage:e.safeStorage.isEncryptionAvailable(),userData:e.app.getPath('userData'),pid:process.pid}})()`)
  check(label + ': real OS encryption is available in isolated profile', safety.safeStorage && path.resolve(safety.userData) === PROFILE, safety)
}
const raw = (name, args = {}) => page.evaluate(`window.whitebox.call(${JSON.stringify(name)},${JSON.stringify(args)})`)
async function call(name, args = {}) { const value = await raw(name, args); assert.equal(value.ok, true, name + ': ' + JSON.stringify(value)); return value.data }
const state = () => call('state:get')
const google = async () => (await state()).googleCalendar
const read = () => JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'))
const transport = () => inspector.evaluate('JSON.parse(JSON.stringify(globalThis.__googleE2E))')
async function click(selector) {
  const point = await until(() => page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return r.width&&r.height&&e.contains(document.elementFromPoint(p.x,p.y))?p:null})()`), selector)
  for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
  await wait(100)
}
async function button(text, scope = 'body') {
  const selector = await page.evaluate(`(()=>{document.querySelector('[data-google-e2e-click]')?.removeAttribute('data-google-e2e-click');const e=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)return null;e.setAttribute('data-google-e2e-click','true');return '[data-google-e2e-click]'})()`)
  assert.ok(selector, 'Real UI button: ' + text); await click(selector)
}
async function fill(selector, value) { await click(selector); await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 }); await page.send('Input.insertText', { text: value }) }
async function tab(label, selector) { const target = await page.evaluate(`(()=>{const e=[...document.querySelectorAll('.rail-tab')].find(e=>e.querySelector('.rail-tab-label')?.textContent===${JSON.stringify(label)});if(!e)return null;e.setAttribute('data-google-e2e-nav','true');return '[data-google-e2e-nav]'})()`); assert.ok(target); await click(target); await page.evaluate(`document.querySelector('[data-google-e2e-nav]')?.removeAttribute('data-google-e2e-nav')`); await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), label + ' real UI') }
async function screenshot(name) { await page.send('Page.bringToFront'); await wait(250); const native = nativeWindow(); check(name + ': screenshot measures live owned window', native.visible && native.windowPid === child.pid, native); fs.writeFileSync(path.join(RUN, name + '-native.json'), JSON.stringify({ native, cdp: page.identity }, null, 2)); const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(RUN, name + '.png'), Buffer.from(shot.data, 'base64')); fs.writeFileSync(path.join(RUN, name + '-dom.txt'), await page.evaluate('document.body.innerText')) }
async function expectRejection(name, args, reason) { const start = fs.statSync(appLog).size, before = await transport(); const reply = await raw(name, args); const end = fs.statSync(appLog).size; expectedErrors.push({ file: appLog, start, end, command: name, reason }); check(reason, reply.ok === false && (await transport()).requests.length === before.requests.length, reply) }
async function expectedAction(command, reason, action) { const start = fs.statSync(appLog).size; try { return await action() } finally { expectedErrors.push({ file: appLog, start, end: fs.statSync(appLog).size, command, reason }) } }
function localFields(database) { return Object.fromEntries(['projects', 'tasks', 'sessions', 'calendarBlocks', 'fixedWork', 'weeklyBudgets', 'weeklyBudgetDefaults'].map(key => [key, database[key]])) }
async function observeTotals() { return page.evaluate(`({today:document.querySelector('.today-total')?.textContent??null,week:document.querySelector('.week-overview strong')?.textContent??null,days:[...document.querySelectorAll('.calendar-day-total')].map(e=>e.textContent)})`) }
function checkSecrets() {
  const files = fs.readdirSync(path.join(PROFILE, 'google-calendar')).filter(file => file.endsWith('.encrypted'))
  check('One real profile-specific encrypted credential file exists', files.length === 1)
  const encrypted = fs.readFileSync(path.join(PROFILE, 'google-calendar', files[0])), database = fs.readFileSync(path.join(DATA, 'data.json'))
  check('Credential bytes and data.json contain no plaintext token or client secret', encrypted.length > 0 && [ACCESS, REFRESH, SECRET].every(value => !encrypted.includes(Buffer.from(value)) && !database.includes(Buffer.from(value))))
  fs.writeFileSync(path.join(RUN, 'encrypted-storage-proof.json'), JSON.stringify({ file: files[0], size: encrypted.length, sha256: createHash('sha256').update(encrypted).digest('hex'), plaintextCredentialsAbsent: true }, null, 2))
}
async function closeEditor() { if (await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR)}))`)) { await button('閉じる', EDITOR); if (await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR + ' .calendar-confirm')}))`)) await button('入力を破棄して閉じる', EDITOR) } }
async function stop(label, deadlineMs = 20000) {
  if (!child) return
  const current = child; processSnapshot()
  if (page) await closeEditor()
  if (page && inspector) { inspector.close(); await Promise.race([inspector.closed, wait(2500).then(() => { throw new Error('Inspector failed to detach before natural quit') })]); inspector = undefined }
  const quitStartedAt = Date.now()
  if (page) { try { await page.evaluate('void window.whitebox.call("app:quit")') } catch {} }
  else if (inspector) {
    await inspector.evaluate(`(()=>{if(process.pid!==${child.pid}||process.env.WHITEBOX_DATA_DIR!==${JSON.stringify(DATA)})throw Error('Cleanup inspector ownership changed');const e=process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(buildRoot, 'package.json'))})('electron');if(e.app.getPath('userData')!==${JSON.stringify(PROFILE)})throw Error('Cleanup profile changed');e.app.quit();return true})()`)
    try { await inspector.send('Debugger.resume') } catch {}
    inspector.close(); await Promise.race([inspector.closed, wait(2500)]); inspector = undefined
  }
  await until(() => current.exitCode !== null || current.signalCode !== null, 'actual app natural exit', deadlineMs)
  const quitElapsedMs = Date.now() - quitStartedAt
  inspector?.close(); inspector = undefined
  const remaining = await until(() => { const alive = processSnapshot(); return alive.length ? false : [] }, 'owned descendants natural exit')
  for (const connection of pages) connection.close(); pages.clear()
  const receipt = { pid: current.pid, creationDate: childIdentity.CreationDate, exitCode: current.exitCode, signal: current.signalCode, forcedCleanup: false, quitElapsedMs, deadlineMs, remaining }
  fs.writeFileSync(path.join(RUN, label + '-shutdown.json'), JSON.stringify(receipt, null, 2)); check(label + ': natural exit with no owned process remaining', current.exitCode === 0 && current.signalCode === null, receipt)
  child = undefined; page = undefined
  return receipt
}

async function heldLogin() {
  await tab('設定', SETTINGS)
  const before = await transport()
  await inspector.evaluate('globalThis.__googleE2E.holdOAuthCallbacks=true')
  await button('Google に接続', SETTINGS)
  await until(async () => (await transport()).heldCallbacks.length === before.heldCallbacks.length + 1 && (await google()).syncing && await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(SETTINGS + ' button')})).some(e=>e.textContent.trim()==='ログインを中止'&&!e.disabled)`), 'real loopback OAuth is waiting with enabled UI cancel')
  const pending = await transport(), callback = pending.heldCallbacks.at(-1)
  const probe = new URL(callback.redirectUri); probe.searchParams.set('state', 'e2e-invalid-state')
  const response = await fetch(probe, { signal: AbortSignal.timeout(1500), redirect: 'error' }); await response.text()
  check('Pending login owns a live real loopback listener without token exchange or valid callback', response.status === 400 && callback.invalidStateStatus === 400 && pending.requests.length === before.requests.length && pending.callbacks.length === before.callbacks.length + 1 && pending.callbacks.at(-1).kind === 'invalid-state', callback)
  return { callback, before }
}
async function listenerClosed(redirectUri) {
  return until(async () => { try { const response = await fetch(new URL(redirectUri), { signal: AbortSignal.timeout(500), redirect: 'error' }); await response.text(); return false } catch (cause) { return ['ECONNREFUSED', 'ECONNRESET'].includes(cause.cause?.code) } }, 'real OAuth loopback listener closed', 3000)
}

let exitCode = 1
try {
  await launch('first')
  const initial = await state(); check('Fresh isolated database has no local sessions or Google account', initial.sessions.length === 0 && !initial.googleCalendar.connected)
  await call('settings:update', { patch: { onboardedAt: Date.now(), lastWelcomeDate: calendar(Date.now()), dayStartHour: 0, showSessionCard: false, soundOnExpire: false, autoPauseOnSuspend: false, launchAtLogin: false, shortcuts: { startPause: '', currentWork: '', dashboard: '' } } })
  await page.send('Page.reload'); await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs"))&&!document.querySelector(".onboarding")&&!document.querySelector(".welcome")'), 'onboarding dismissed through real settings')
  if (!process.argv.includes('--qualify') && process.env.WHITEBOX_GOOGLE_QUALIFY !== '1') {
    let beforeLocal = localFields(read())
    await expectRejection('googleCalendar:configure', { clientId: CLIENT, clientSecret: SECRET, extra: true }, 'Strict IPC rejects extra configuration field before transport')
    await expectRejection('googleCalendar:connect', { extra: true }, 'Strict IPC rejects unexpected connect args')
    await expectRejection('googleCalendar:sync', { startedAt: today.getTime(), endedAt: today.getTime() }, 'Strict IPC rejects invalid sync interval')
    await expectRejection('googleCalendar:create', { calendarId: 'primary@example.test', title: 'invalid', startedAt: today.getTime(), endedAt: today.getTime() + 1000, requestId: 'fixture', extra: true }, 'Strict IPC rejects unexpected create field')
    await tab('設定', SETTINGS)
    await fill(SETTINGS + ' input:not([type=password])', CLIENT); await fill(SETTINGS + ' input[type=password]', SECRET); await button('接続設定を保存', SETTINGS)
    await until(async () => (await google()).configured && await page.evaluate(`document.querySelector(${JSON.stringify(SETTINGS + ' input[type=password]')})?.value===''`), 'real configure saved and draft cleared')
    await button('Google に接続', SETTINGS)
    await until(async () => { const value = await google(); return value.connected && !value.syncing && value.events.length === 4 }, 'actual OAuth exchange and initial paginated sync')
    const connected = await google(), trace = await transport()
    check('Real OAuth loopback rejects invalid state then accepts actual state with matching PKCE', isDeepStrictEqual(trace.callbacks.map(item => [item.kind, item.status]), [['invalid-state', 400], ['valid-state', 200]]) && trace.requests.some(item => item.pkceVerified))
    check('Paginated calendar list and recurring-expanded events reached actual state', connected.calendars.length === 2 && connected.events.some(event => event.id === 'recurring-instance') && !connected.events.some(event => event.id === 'cancelled') && trace.requests.some(item => item.url.includes('pageToken=events-next')) && trace.requests.some(item => item.url.includes('pageToken=calendars-next')), connected)
    const allDay = connected.events.find(event => event.id === 'all-day'), overnight = connected.events.find(event => event.id === 'overnight')
    check('Actual event normalization preserves local all-day exclusive end and overnight timestamps', allDay?.allDay && allDay.startedAt === today.getTime() && allDay.endedAt === tomorrow.getTime() && overnight?.startedAt === at(previous, 23) && overnight.endedAt === at(today, 1) && !overnight.allDay)
    checkSecrets(); await screenshot('01-connected-settings')
    await tab('今日', '.today'); await until(() => page.evaluate('document.querySelector(".google-day")?.textContent.includes("Google timed fixture")'), 'Google day is visible with zero local sessions')
    const zeroToday = await observeTotals()
    check('Today shows timed and all-day Google events while local session empty state remains', await page.evaluate('Boolean(document.querySelector(".google-day-all-day"))&&document.querySelector(".today")?.textContent.includes("今日はまだ記録がない")') && (await state()).sessions.length === 0)
    check('Overlapping timed and recurring occurrences occupy distinct day lanes', await page.evaluate(`(()=>{const events=[...document.querySelectorAll('.google-day-event')];const timed=events.find(e=>e.textContent==='Google timed fixture'),recurring=events.find(e=>e.textContent==='Google recurring occurrence');return timed&&recurring&&timed.style.top!==recurring.style.top&&timed.getBoundingClientRect().width>0&&recurring.getBoundingClientRect().width>0})()`))
    await screenshot('02-today-zero-sessions')
    await tab('週', '.week-workspace'); await until(() => page.evaluate('document.querySelectorAll("[data-calendar-event=google]").length>=4'), 'real week contains Google calendar blocks')
    const zeroWeek = await observeTotals()
    check('All-day and overnight Google blocks have real weekly layout', await page.evaluate('Boolean(document.querySelector(".calendar-all-day-event[data-calendar-event=google]"))&&[...document.querySelectorAll("[data-calendar-event=google]")].some(e=>e.getAttribute("aria-label")?.includes("Google overnight fixture"))'))
    await screenshot('03-week-zero-sessions')
    const project = await call('project:create', { name: 'Google isolation baseline' })
    const task = await call('task:create', { title: 'Local actual baseline', projectId: project.id, status: 'todo' })
    const session = await call('session:start', { taskId: task.id, mode: 'stopwatch' })
    await call('session:end'); await call('session:skipReview')
    await call('session:update', { id: session.id, patch: { startedAt: at(today, 8), endedAt: at(today, 8, 30), plannedMs: 0, note: 'Local 30 minutes remain independent of Google' } })
    beforeLocal = localFields(read())
    await tab('今日', '.today'); const actualToday = await observeTotals()
    await tab('週', '.week-workspace'); const actualWeek = await observeTotals()
    check('Actual baseline contains one independent 30-minute session and changes actual totals', beforeLocal.sessions.length === 1 && beforeLocal.sessions[0].endedAt - beforeLocal.sessions[0].startedAt === 1800000 && actualToday.today !== zeroToday.today && actualWeek.week !== zeroWeek.week)
    await tab('設定', SETTINGS)
    await click(SETTINGS + ' .google-calendar-selection label:nth-of-type(2) input')
    await until(async () => { const value = await google(); return !value.syncing && value.selectedCalendarIds.length === 2 && value.events.some(event => event.id === 'read-only') }, 'selection adds readonly calendar')
    await click(SETTINGS + ' .google-calendar-selection label:nth-of-type(1) input')
    await until(async () => { const value = await google(); return !value.syncing && value.selectedCalendarIds.length === 1 && value.events.length === 1 }, 'deselection removes stale primary events')
    await click(SETTINGS + ' .google-calendar-selection label:nth-of-type(1) input')
    await until(async () => { const value = await google(); return !value.syncing && value.events.length === 5 }, 'selection restored')
    await expectRejection('googleCalendar:create', { calendarId: 'readonly@example.test', title: 'not writable', startedAt: at(today, 17), endedAt: at(today, 18), requestId: 'readonly-probe' }, 'Actual handler rejects read-only calendar without POST')
    await tab('週', '.week-workspace'); await button('＋ 予定を追加'); await until(() => page.evaluate('Boolean(document.querySelector(".calendar-editor"))'), 'real local plan editor')
    await button('Google カレンダーへ保存する', '.calendar-editor'); await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR)}))`), 'real Google event editor')
    check('Google editor only offers writable calendars', await page.evaluate(`document.querySelectorAll(${JSON.stringify(EDITOR + ' select option')}).length===1`))
    await fill(EDITOR + ' input:not([type])', 'Google created once fixture')
    const draft = await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(EDITOR + ' input,' + EDITOR + ' select')}),e=>e.value)`)
    await button('閉じる', EDITOR); check('Dirty Google draft requires explicit discard and retains every field', await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR + ' .calendar-confirm')}))`) && isDeepStrictEqual(await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(EDITOR + ' input,' + EDITOR + ' select')}),e=>e.value)`), draft))
    await button('編集へ戻る', EDITOR)
    await expectedAction('window:close', 'Real native close is vetoed by dirty Google draft', async () => {
      await call('window:close', { kind: 'main' })
      await until(() => page.evaluate(`document.querySelector(${JSON.stringify(EDITOR + ' .task-command-error')})?.textContent.includes('Google の予定が保存されていない')`), 'actual renderer flush rejects dirty Google draft')
      await until(() => fs.readFileSync(appLog, 'utf8').includes('[white-box] 入力の保存を待つため窓を閉じません:'), 'actual native close veto log')
    })
    check('Dirty native close preserves Google editor fields and owned visible window', nativeWindow().visible && isDeepStrictEqual(await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(EDITOR + ' input,' + EDITOR + ' select')}),e=>e.value)`), draft))
    await expectedAction('googleCalendar:create', 'Synthetic lost Google response after successful remote commit', async () => { await button('Google に保存', EDITOR); await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(EDITOR + ' .task-command-error')}))`), 'real create rejection shown') })
    check('Ambiguous create failure retains and freezes the original draft', isDeepStrictEqual(await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(EDITOR + ' input,' + EDITOR + ' select')}),e=>e.value)`), draft) && await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(EDITOR + ' input,' + EDITOR + ' select')})).every(e=>e.disabled)`))
    await screenshot('04-create-response-lost')
    await button('同じ予定を再試行', EDITOR); await until(() => page.evaluate(`!document.querySelector(${JSON.stringify(EDITOR)})`), 'actual conflict recovery closes editor')
    const created = await transport(), posts = created.requests.filter(item => item.method === 'POST' && item.body)
    check('UI retry sends same stable event ID and identical body, reconciles one Google event', posts.length === 2 && posts[0].body.id === posts[1].body.id && isDeepStrictEqual(posts[0].body, posts[1].body) && Object.keys(created.created).length === 1 && created.requests.some(item => item.url.endsWith('/events/' + posts[0].body.id)))
    await tab('設定', SETTINGS); await until(async () => !(await google()).syncing, 'sync settled before offline')
    const cached = (await google()).events
    await inspector.evaluate('globalThis.__googleE2E.offline=true')
    await expectedAction('googleCalendar:sync', 'Synthetic Google API offline', async () => { await button('再同期', SETTINGS); await until(async () => Boolean((await google()).error) && !(await google()).syncing, 'offline error reaches actual UI') })
    check('Offline sync preserves previous in-memory cache and exposes a useful error', isDeepStrictEqual((await google()).events, cached) && await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(SETTINGS + ' [role=alert]')}))`))
    await screenshot('05-offline-cache-preserved')
    await inspector.evaluate('globalThis.__googleE2E.offline=false'); await button('再同期', SETTINGS); await until(async () => !(await google()).syncing && !(await google()).error, 'online recovery')
    await tab('今日', '.today'); check('Google changes leave today actual total unchanged', isDeepStrictEqual((await observeTotals()).today, actualToday.today))
    await tab('週', '.week-workspace'); const afterWeek = await observeTotals(); check('Google changes leave week and daily actual totals unchanged', afterWeek.week === actualWeek.week && isDeepStrictEqual(afterWeek.days, actualWeek.days))
    check('Google operations change no local session, task, plan or budget field', isDeepStrictEqual(localFields(read()), beforeLocal))
    checkSecrets(); fs.writeFileSync(path.join(RUN, 'first-transport.json'), JSON.stringify(await transport(), null, 2))
    await stop('first'); await launch('connected-restart')
    await until(async () => { const value = await google(); return value.connected && !value.syncing && value.events.length === 5 }, 'restart decrypts credentials and synchronizes without browser login')
    const restarted = await transport(); check('Restart uses real encrypted refresh token with no OAuth browser launch', restarted.requests.some(item => item.grantType === 'refresh_token') && restarted.shellCalls.length === 0)
    await tab('設定', SETTINGS); await screenshot('06-restarted-connected')
    await button('接続を解除', SETTINGS); await button('この端末の接続を解除', SETTINGS); await until(async () => !(await google()).connected, 'actual disconnect')
    check('Disconnect clears account, selected calendars and old Google events', (await google()).events.length === 0 && (await google()).selectedCalendarIds.length === 0 && (await google()).account === null)
    await tab('週', '.week-workspace'); check('Disconnected week removes old Google blocks', await page.evaluate('document.querySelectorAll("[data-calendar-event=google]").length===0'))
    fs.writeFileSync(path.join(RUN, 'connected-restart-transport.json'), JSON.stringify(await transport(), null, 2)); await stop('connected-restart'); await launch('disconnected-restart')
    const disconnected = await google(); check('Restart preserves disconnect with no token exchange or stale event', !disconnected.connected && disconnected.configured && disconnected.events.length === 0 && (await transport()).requests.length === 0)
    check('All restarts preserve every original local data field', isDeepStrictEqual(localFields(read()), beforeLocal)); checkSecrets()
    const cancelledLogin = await heldLogin()
    await screenshot('07-login-awaiting-callback')
    const cancelStartedAt = Date.now()
    await button('ログインを中止', SETTINGS)
    await until(async () => { const value = await google(); return !value.syncing && !value.connected && !value.error && await page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(SETTINGS + ' button')})).some(e=>e.textContent.trim()==='Google に接続'&&!e.disabled)&&!Array.from(document.querySelectorAll(${JSON.stringify(SETTINGS + ' button')})).some(e=>e.textContent.trim()==='ログインを中止')`) }, 'real pending login settles through UI cancellation', 5000)
    const cancelElapsedMs = Date.now() - cancelStartedAt
    await listenerClosed(cancelledLogin.callback.redirectUri)
    const cancelledTrace = await transport()
    check('UI cancellation settles quickly and closes the real OAuth listener without token exchange', cancelElapsedMs < 5000 && cancelledTrace.requests.length === cancelledLogin.before.requests.length && (await google()).configured && isDeepStrictEqual(localFields(read()), beforeLocal), { cancelElapsedMs, redirectUri: cancelledLogin.callback.redirectUri })
    fs.writeFileSync(path.join(RUN, 'login-cancel-transport.json'), JSON.stringify({ cancelElapsedMs, ...cancelledTrace }, null, 2))
    await screenshot('08-login-cancelled')
    const quittingLogin = await heldLogin()
    await screenshot('09-quit-with-login-pending')
    const beforePendingQuit = await transport()
    fs.writeFileSync(path.join(RUN, 'login-pending-quit-transport.json'), JSON.stringify(beforePendingQuit, null, 2))
    check('Pending quit fixture has sent no valid OAuth callback or Google token request', beforePendingQuit.callbacks.every(item => item.kind === 'invalid-state') && beforePendingQuit.requests.length === 0 && beforePendingQuit.blocked.length === 0)
    const pendingQuit = await stop('login-pending-quit', 5000)
    await listenerClosed(quittingLogin.callback.redirectUri)
    check('Actual app:quit cancels pending OAuth and naturally exits within five seconds', pendingQuit.quitElapsedMs < 5000 && pendingQuit.exitCode === 0 && pendingQuit.remaining.length === 0, pendingQuit)
    await launch('after-pending-login-quit')
    const afterPendingQuit = await google(), afterPendingTrace = await transport()
    check('Restart after pending OAuth quit retains configuration with no account, token request, stale event or local data change', afterPendingQuit.configured && !afterPendingQuit.connected && !afterPendingQuit.syncing && afterPendingQuit.account === null && afterPendingQuit.events.length === 0 && afterPendingTrace.requests.length === 0 && afterPendingTrace.shellCalls.length === 0 && isDeepStrictEqual(localFields(read()), beforeLocal), afterPendingQuit)
    checkSecrets(); await tab('設定', SETTINGS); await screenshot('10-after-pending-login-quit')
  }
  check('Fixture transport never forwards external Google traffic', (await transport()).blocked.length === 0)
  fs.writeFileSync(path.join(RUN, 'final-transport.json'), JSON.stringify(await transport(), null, 2)); await stop('final')
  const appErrors = []
  for (const file of fs.readdirSync(RUN).filter(file => file.endsWith('-app.log'))) {
    let offset = 0
    for (const line of fs.readFileSync(path.join(RUN, file), 'utf8').split(/(?<=\n)/)) { const start = offset; offset += Buffer.byteLength(line); if (!/uncaught|unhandled|\[white-box\].*(?:コマンド失敗|窓を閉じません|終了前の保存に失敗)/i.test(line)) continue; const command = line.match(/コマンド失敗:\s*(\S+)/)?.[1] ?? (line.includes('[white-box] 入力の保存を待つため窓を閉じません:') ? 'window:close' : null); appErrors.push({ file, offset: start, line: line.trim(), expected: !/uncaught|unhandled/i.test(line) && expectedErrors.some(item => item.file === path.join(RUN, file) && item.start <= start && item.end > start && item.command === command) }) }
  }
  fs.writeFileSync(path.join(RUN, 'application-errors.json'), JSON.stringify(appErrors, null, 2))
  check('Only explicitly scoped synthetic/strict-IPC errors appear in application logs', appErrors.every(item => item.expected), appErrors)
  check('Real renderers contain no console error or uncaught exception', errors.length === 0, errors)
  exitCode = 0
} catch (error) {
  console.error(error); fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) { try { await screenshot('failure') } catch (captureError) { fs.writeFileSync(path.join(RUN, 'failure-capture.txt'), captureError.stack || String(captureError)) } }
} finally {
  if (inspector) { try { fs.writeFileSync(path.join(RUN, 'failure-or-final-transport.json'), JSON.stringify(await transport(), null, 2)) } catch {} }
  if (child) { try { await stop('cleanup') } catch (error) { console.error('Natural shutdown blocked: ' + error.message); fs.writeFileSync(path.join(RUN, 'shutdown-blocked.txt'), error.stack || String(error)); exitCode = 1 } }
  inspector?.close(); for (const connection of pages) connection.close()
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, startedAt, completedAt: new Date().toISOString(), realAccountOAuth: false, simulatedApi: true, checks, errors, expectedErrors, processObservation, artifacts: fs.readdirSync(RUN) }, null, 2))
  console.log('Evidence: ' + RUN); process.exit(exitCode)
}

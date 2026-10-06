import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { OwnedProcesses, readWindowsProcesses, sameProcess } from './owned-processes.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const electron = path.join(path.dirname(require.resolve('electron')), 'dist', 'electron.exe')
const OUTPUT = path.join(ROOT, '.e2e-quit')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
if (process.env.WHITEBOX_QUIT_SEED) fs.copyFileSync(process.env.WHITEBOX_QUIT_SEED, path.join(DATA, 'data.json'))
fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify({ startedAt: new Date().toISOString(), executable: electron, harnessSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), ownedProcessesSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-processes.mjs'))).digest('hex') }, null, 2))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const ownedProcesses = new OwnedProcesses()
let child, childIdentity, processObservation
let socket

async function until(test, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const value = await test(); if (value) return value } catch (error) { last = error }
    await wait(100)
  }
  throw new Error(`Timed out: ${label}${last ? ` / ${last.message}` : ''}`)
}
function check(name, passed) {
  checks.push({ name, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`)
  assert.ok(passed, name)
}
function processSnapshot(inventory = readWindowsProcesses()) {
  processObservation = ownedProcesses.observe(inventory)
  fs.writeFileSync(path.join(RUN, 'owned-process-observation.json'), JSON.stringify(processObservation, null, 2))
  return processObservation.remaining
}
function verifiedBrowserPid(processInfo, expectedPid) {
  const browsers = processInfo.filter((process) => process.type === 'browser')
  assert.equal(browsers.length, 1, 'CDP identifies one browser process')
  assert.equal(browsers[0].id, expectedPid, 'CDP browser belongs to the launched Electron PID')
  return browsers[0].id
}
function verifiedBrowserEndpoint(url, port) {
  const endpoint = new URL(url)
  assert.equal(endpoint.protocol, 'ws:', 'CDP browser endpoint uses local WebSocket')
  assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'CDP browser endpoint is loopback')
  assert.equal(endpoint.port, String(port), 'CDP browser endpoint uses the launch port')
  assert.ok(endpoint.pathname.startsWith('/devtools/browser/'), 'CDP endpoint addresses the browser')
  assert.equal(endpoint.username, '', 'CDP endpoint has no credentials')
  assert.equal(endpoint.password, '', 'CDP endpoint has no credentials')
  return endpoint.href
}
function verifiedMainTarget(targetInfos, expectedUrl) {
  const targets = targetInfos.filter((target) => target.type === 'page' && target.url.endsWith('#main'))
  assert.equal(targets.length, 1, 'Verified browser has one main page')
  assert.equal(targets[0].url, expectedUrl, 'Main page belongs to the expected build')
  return targets[0]
}
async function launch(label) {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA, WHITEBOX_QUIT_TRACE_DIR: RUN }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const log = fs.openSync(path.join(RUN, `${label}-app.log`), 'a')
  const entry = process.env.WHITEBOX_QUIT_OBSERVER === '0' ? ROOT : path.join(ROOT, 'scripts', 'quit-observer.mjs')
  const launchStartedAt = Date.now()
  child = spawn(electron, [entry, '--hidden', '--open=main', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`], { cwd: ROOT, env, stdio: ['ignore', log, log], windowsHide: true })
  fs.closeSync(log)
  child.on('error', (error) => { console.error(error) })
  const inventory = readWindowsProcesses()
  childIdentity = inventory.find((process) => process.ProcessId === child.pid)
  assert.ok(childIdentity && child.exitCode === null && child.signalCode === null, 'Launched Electron is live when its identity is registered')
  ownedProcesses.registerRoot(childIdentity, { parentPid: process.pid, name: path.basename(electron), notBefore: launchStartedAt })
  processSnapshot(inventory)
  const discoveredUrl = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500), redirect: 'error' })).json()).webSocketDebuggerUrl, 'browser CDP endpoint')
  const browserUrl = verifiedBrowserEndpoint(discoveredUrl, port)
  const browserSocket = new WebSocket(browserUrl)
  socket = browserSocket
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser CDP connection timeout')), 10000)
    browserSocket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    browserSocket.addEventListener('error', (error) => { clearTimeout(timer); reject(error) }, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  browserSocket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP connection closed')) }
    pending.clear()
  })
  browserSocket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.sessionId !== request.sessionId) request.reject(new Error('Unexpected CDP session response'))
    else if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (browserSocket.readyState !== WebSocket.OPEN) { reject(new Error('Browser CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 5000)
    pending.set(id, { resolve, reject, timer, sessionId })
    browserSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const { processInfo } = await send('SystemInfo.getProcessInfo')
  const browserPid = verifiedBrowserPid(processInfo, child.pid)
  const currentIdentity = readWindowsProcesses().find((process) => process.ProcessId === child.pid)
  assert.ok(currentIdentity && sameProcess(currentIdentity, childIdentity) && child.exitCode === null && child.signalCode === null, 'Verified Electron identity remains live')
  const expectedUrl = pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href + '#main'
  const targetInfos = await until(async () => {
    const { targetInfos } = await send('Target.getTargets')
    return targetInfos.some((target) => target.type === 'page' && target.url.endsWith('#main')) ? targetInfos : null
  }, 'main target in verified browser')
  const target = verifiedMainTarget(targetInfos, expectedUrl)
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  assert.equal(typeof sessionId, 'string', 'Browser CDP attaches a renderer session')
  const evaluate = async (expression) => {
    const guarded = `(() => { if (location.href !== ${JSON.stringify(expectedUrl)}) throw new Error('Quit E2E target URL changed'); return (${expression}); })()`
    const result = await send('Runtime.evaluate', { expression: guarded, awaitPromise: true, returnByValue: true }, sessionId)
    return result.result.value
  }
  check(`${label}: verified CDP browser PID and main page belong to this launch`, browserPid === child.pid && await evaluate('location.href') === expectedUrl)
  fs.writeFileSync(path.join(RUN, `${label}-cdp-identity.json`), JSON.stringify({ browserPid, expectedPid: child.pid, browserUrl, targetId: target.targetId, expectedUrl, targetUrl: target.url, sessionId }, null, 2))
  await until(() => evaluate('Boolean(window.whitebox)'), 'preload ready')
  fs.writeFileSync(path.join(RUN, `${label}-processes.json`), JSON.stringify(processSnapshot(), null, 2))
  return evaluate
}
async function stop(evaluate, label) {
  const current = child
  processSnapshot()
  let quitError = null
  try { await evaluate('void window.whitebox.call("app:quit")') } catch (error) { quitError = error.message }
  socket.close()
  socket = undefined
  try {
    await until(() => current.exitCode !== null || current.signalCode !== null, 'natural main process exit')
  } catch (error) {
    fs.writeFileSync(path.join(RUN, `${label}-timeout-processes.json`), JSON.stringify(processSnapshot(), null, 2))
    throw error
  }
  const tracePath = path.join(RUN, `quit-${current.pid}.jsonl`)
  const trace = fs.existsSync(tracePath) ? fs.readFileSync(tracePath, 'utf8').trim().split('\n').map(JSON.parse) : []
  fs.writeFileSync(path.join(RUN, `${label}-shutdown.json`), JSON.stringify({ pid: current.pid, creationDate: childIdentity.CreationDate, quitError, exitCode: current.exitCode, signalCode: current.signalCode, trace }, null, 2))
  check(`${label}: native process exited with code zero`, current.exitCode === 0 && current.signalCode === null)
  if (trace.length) {
    check(`${label}: quit IPC received and shutdown persistence returned`, trace.some((item) => item.event === 'quit-ipc-received') && trace.some((item) => item.event === 'before-quit-listener-return') && trace.some((item) => item.event === 'fs-renameSync-return'))
    check(`${label}: every window closed before will-quit and no window was created while quitting`, trace.filter((item) => item.event === 'window-created').every((item) => !item.quitting) && trace.some((item) => item.event === 'will-quit' && item.windows.length === 0) && trace.some((item) => item.event === 'process-exit'))
  }
  child = undefined
}

let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  const evaluate = await launch('first')
  const state = await evaluate('window.whitebox.call("state:get")')
  assert.equal(state.ok, true)
  assert.equal((await evaluate('window.whitebox.call("day:note", {key:"2026-10-06",text:"quit regression"})')).ok, true)
  if (process.env.WHITEBOX_QUIT_LIVE === '1') {
    assert.equal((await evaluate('window.whitebox.call("session:start", {newTask:{title:"Quit regression timing"},minutes:1})')).ok, true)
    for (const kind of ['start', 'expire', 'review']) assert.equal((await evaluate(`window.whitebox.call("window:open",{kind:${JSON.stringify(kind)}})`)).ok, true)
  }
  const before = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'))
  await stop(evaluate, 'first')
  check('Natural shutdown preserves the complete database', isDeepStrictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')), before))
  const restarted = await launch('restart')
  check('Restart preserves the complete database', isDeepStrictEqual(JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')), before))
  await stop(restarted, 'restart')
  await wait(200)
  const remaining = processSnapshot()
  fs.writeFileSync(path.join(RUN, 'remaining-processes.json'), JSON.stringify(processObservation, null, 2))
  check('All owned Electron processes are absent', remaining.length === 0)
  exitCode = 0
} catch (error) {
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  console.error(error)
} finally {
  socket?.close()
  if (child || exitCode !== 0) {
    const remaining = processSnapshot()
    fs.writeFileSync(path.join(RUN, 'failure-owned-processes.json'), JSON.stringify(processObservation, null, 2))
    if (remaining.length) {
      exitCode = 1
      fs.writeFileSync(path.join(RUN, 'forced-cleanup-processes.json'), JSON.stringify(remaining, null, 2))
      for (const item of remaining.reverse()) {
        const current = processSnapshot().find((process) => sameProcess(process, item))
        if (current) try { process.kill(current.ProcessId, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
    }
  }
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, checks }, null, 2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}

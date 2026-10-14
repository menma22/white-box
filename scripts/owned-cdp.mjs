import assert from 'node:assert/strict'
import { readWindowsProcesses, sameProcess } from './owned-processes.mjs'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(test, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const value = await test(); if (value) return value } catch (error) { last = error }
    await wait(100)
  }
  throw new Error(`Timed out: ${label}${last ? ' / ' + last.message : ''}`)
}

function browserEndpoint(url, port) {
  const endpoint = new URL(url)
  assert.equal(endpoint.protocol, 'ws:', 'CDP browser endpoint uses local WebSocket')
  assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'CDP browser endpoint is loopback')
  assert.equal(endpoint.port, String(port), 'CDP browser endpoint uses the launch port')
  assert.ok(endpoint.pathname.startsWith('/devtools/browser/'), 'CDP endpoint addresses the browser')
  assert.equal(endpoint.username, '', 'CDP endpoint has no credentials')
  assert.equal(endpoint.password, '', 'CDP endpoint has no credentials')
  return endpoint.href
}

export async function connectOwnedPage({ port, kind, expectedUrl, child, childIdentity, ownedProcesses, onEvent = () => {}, onSend = () => {}, readProcesses = readWindowsProcesses, fetchVersion = fetch, WebSocketImpl = WebSocket }) {
  const verifyIdentity = () => {
    const inventory = readProcesses()
    ownedProcesses.observe(inventory)
    const current = inventory.find((process) => process.ProcessId === child.pid)
    assert.ok(current && sameProcess(current, childIdentity) && ownedProcesses.owns(current) && child.exitCode === null && child.signalCode === null, 'Verified Electron identity remains live')
  }
  verifyIdentity()
  const discovered = await until(async () => (await (await fetchVersion(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500), redirect: 'error' })).json()).webSocketDebuggerUrl, 'browser CDP endpoint')
  const browserUrl = browserEndpoint(discovered, port)
  const ws = new WebSocketImpl(browserUrl)
  let sequence = 0, sessionId
  const pending = new Map()
  let resolveClosed
  const closed = new Promise((resolve) => { resolveClosed = resolve })
  ws.addEventListener('close', () => {
    resolveClosed()
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP connection closed')) }
    pending.clear()
  })
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (sessionId && message.sessionId === sessionId && message.method) onEvent({ url: expectedUrl, ...message })
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.sessionId !== request.sessionId) request.reject(new Error('Unexpected CDP session response'))
    else if (message.error || message.result?.exceptionDetails) request.reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}, targetSession) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocketImpl.OPEN) { reject(new Error('Browser CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, method === 'Page.captureScreenshot' ? 30000 : 10000)
    pending.set(id, { resolve, reject, timer, sessionId: targetSession })
    onSend(method, params)
    ws.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }))
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser CDP connection timeout')), 10000)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser CDP connection failed')) }, { once: true })
    })
    const { processInfo } = await send('SystemInfo.getProcessInfo')
    const browsers = processInfo.filter((process) => process.type === 'browser')
    assert.equal(browsers.length, 1, 'CDP identifies one browser process')
    assert.equal(browsers[0].id, child.pid, 'CDP browser belongs to the launched Electron PID')
    verifyIdentity()
    const targetInfos = await until(async () => {
      const { targetInfos } = await send('Target.getTargets')
      return targetInfos.some((target) => target.type === 'page' && target.url.endsWith('#' + kind)) ? targetInfos : null
    }, kind + ' target in verified browser')
    const targets = targetInfos.filter((target) => target.type === 'page' && target.url.endsWith('#' + kind))
    assert.equal(targets.length, 1, 'Verified browser has one ' + kind + ' page')
    const target = targets[0]
    assert.equal(target.url, expectedUrl, 'Page belongs to the expected build')
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    assert.ok(typeof attached.sessionId === 'string' && attached.sessionId.length > 0, 'Browser CDP attaches a renderer session')
    sessionId = attached.sessionId
    verifyIdentity()
    const connection = {
      identity: { browserPid: browsers[0].id, expectedPid: child.pid, creationDate: childIdentity.CreationDate, browserUrl, targetId: target.targetId, targetUrl: target.url, expectedUrl, sessionId },
      send: (method, params) => send(method, params, sessionId),
      closed,
      close: () => ws.close(),
      async evaluate(expression) {
        const guarded = `if (location.href !== ${JSON.stringify(expectedUrl)}) throw new Error('Owned E2E target URL changed');\n${expression}`
        const result = await send('Runtime.evaluate', { expression: guarded, awaitPromise: true, returnByValue: true }, sessionId)
        return result.result.value
      },
    }
    assert.equal(await connection.evaluate('location.href'), expectedUrl, 'Attached renderer retains the expected URL')
    await connection.send('Runtime.enable')
    await connection.send('Log.enable')
    return connection
  } catch (error) {
    ws.close()
    throw error
  }
}

import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function probe(scenario: string) {
  const source = `
    import assert from 'node:assert/strict'
    import vm from 'node:vm'
    import { connectOwnedPage } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/owned-cdp.mjs')).href)}
    import { OwnedProcesses } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/owned-processes.mjs')).href)}
    const scenario = process.env.OWNED_CDP_SCENARIO
    const expectedUrl = 'file:///owned/dist/index.html#main'
    const identity = { ProcessId: 123, ParentProcessId: 12, Name: 'electron.exe', CreationDate: '2026-10-11T01:00:00.000Z' }
    const owner = new OwnedProcesses()
    owner.registerRoot(identity)
    const child = { pid: 123, exitCode: scenario === 'exited' ? 0 : null, signalCode: null }
    const trace = [], events = [], sockets = []
    let reads = 0, mutations = 0
    const location = { href: expectedUrl }
    const respond = (ws, message) => ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
    class Socket extends EventTarget {
      static OPEN = 1
      readyState = 0
      constructor(url) {
        super(); this.url = url; sockets.push(this)
        queueMicrotask(() => { this.readyState = Socket.OPEN; this.dispatchEvent(new Event('open')) })
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
      send(data) {
        const request = JSON.parse(data)
        trace.push(request)
        queueMicrotask(() => {
          let result = {}, sessionId = request.sessionId
          if (request.method === 'SystemInfo.getProcessInfo') result = { processInfo: [{ type: 'browser', id: scenario === 'wrong-pid' ? 999 : 123 }] }
          if (request.method === 'Target.getTargets') result = { targetInfos: [{ targetId: 'owned-page', type: 'page', url: scenario === 'foreign-target' ? 'file:///foreign/dist/index.html#main' : expectedUrl }] }
          if (request.method === 'Target.attachToTarget') result = { sessionId: 'owned-session' }
          if (request.method === 'Runtime.evaluate') {
            try { result = { result: { value: vm.runInNewContext(request.params.expression, { location, mutation: () => ++mutations }) } } }
            catch (error) { result = { exceptionDetails: { text: error.message } } }
            if (scenario === 'wrong-session') sessionId = 'foreign-session'
          }
          if (request.method === 'Log.enable') {
            respond(this, { method: 'Runtime.exceptionThrown', sessionId: 'foreign-session', params: {} })
            respond(this, { method: 'Runtime.exceptionThrown', sessionId: 'owned-session', params: {} })
          }
          respond(this, { id: request.id, ...(sessionId ? { sessionId } : {}), result })
        })
      }
    }
    let endpoint = 'ws://127.0.0.1:9222/devtools/browser/owned-browser'
    if (scenario === 'foreign-endpoint') endpoint = 'ws://example.com:9222/devtools/browser/foreign'
    if (scenario === 'wrong-port') endpoint = 'ws://127.0.0.1:9223/devtools/browser/foreign'
    const options = {
      port: 9222, kind: 'main', expectedUrl, child, childIdentity: identity, ownedProcesses: owner, WebSocketImpl: Socket,
      readProcesses: () => { reads++; return [{ ...identity, ...(scenario === 'reused' && reads > 1 ? { CreationDate: '2026-10-11T02:00:00.000Z' } : {}) }] },
      fetchVersion: async (url, config) => {
        assert.equal(url, 'http://127.0.0.1:9222/json/version')
        assert.equal(config.redirect, 'error')
        return { json: async () => ({ webSocketDebuggerUrl: endpoint }) }
      },
      onEvent: (event) => events.push(event),
    }
    const failures = { 'wrong-pid': /launched Electron PID/, reused: /identity remains live/, 'foreign-target': /expected build/, exited: /identity remains live/, 'foreign-endpoint': /loopback/, 'wrong-port': /launch port/, 'wrong-session': /Unexpected CDP session response/ }
    if (failures[scenario]) {
      await assert.rejects(connectOwnedPage(options), failures[scenario])
      assert.equal(trace.some(item => item.method.startsWith('Input.') || item.method === 'Page.bringToFront'), false)
      assert.equal(trace.some(item => item.method === 'Runtime.evaluate' && item.params.expression.includes('mutation()')), false)
      if (scenario !== 'wrong-session') assert.equal(trace.some(item => item.method === 'Target.attachToTarget'), false)
      assert.equal(sockets.every(socket => socket.readyState === 3), true)
      assert.equal(mutations, 0)
    } else {
      const page = await connectOwnedPage(options)
      assert.equal(sockets.length, 1)
      assert.equal(page.identity.browserPid, child.pid)
      assert.equal(page.identity.creationDate, identity.CreationDate)
      assert.deepEqual(trace.find(item => item.method === 'Target.attachToTarget').params, { targetId: 'owned-page', flatten: true })
      assert.equal(await page.evaluate('1 + 2'), 3)
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab' })
      assert.equal(trace.find(item => item.method === 'Input.dispatchKeyEvent').sessionId, 'owned-session')
      assert.equal(events.length, 1)
      assert.equal(events[0].sessionId, 'owned-session')
      location.href = 'file:///foreign/dist/index.html#main'
      await assert.rejects(page.evaluate('mutation()'), /Owned E2E target URL changed/)
      assert.equal(mutations, 0)
      page.close()
      await page.closed
    }
    console.log(JSON.stringify({ scenario, reads, requests: trace.length, mutations }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    input: source, encoding: 'utf8', timeout: 5000, env: { ...process.env, OWNED_CDP_SCENARIO: scenario },
  })
  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ scenario, mutations: 0 })
}

describe('owned browser CDP接続', () => {
  it.each(['wrong-pid', 'reused', 'foreign-target', 'exited', 'foreign-endpoint', 'wrong-port', 'wrong-session'])('%sを入力や書込より前に拒否する', (scenario) => {
    probe(scenario)
  })

  it('同じbrowserで所有Targetへ接続し、応答とエラーをsessionへ限定し、移動後のevaluateを拒否する', () => {
    probe('valid')
  })
})

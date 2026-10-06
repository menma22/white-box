import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const output = path.dirname(fileURLToPath(import.meta.url))
const references = { baseline: '125026f7088487a429170f6276786a13f0e40c4c', fixed: '130016c83ce352598283ca8378362dad3c1821b0' }
const evidence = { sources: {}, checks: [] }

function loadConnect(label) {
  const source = execFileSync('git', ['show', `${references[label]}:scripts/e2e.mjs`], { cwd: process.cwd(), encoding: 'utf8' })
  const parsed = ts.createSourceFile('e2e.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const declarations = parsed.statements.filter((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'connect')
  assert.equal(declarations.length, 1)
  const actualFunction = declarations[0].getText(parsed)
  evidence.sources[label] = { commit: references[label], sourceSha256: createHash('sha256').update(source).digest('hex'), extractedFunctionSha256: createHash('sha256').update(actualFunction).digest('hex') }
  fs.writeFileSync(path.join(output, `actual-connect-${label}.mjs`), actualFunction + '\n')
  return actualFunction
}

function runtime(actualFunction) {
  let socket, timerSequence = 0
  const timers = new Map()
  class ProbeWebSocket {
    static OPEN = 1
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.listeners = new Map(); socket = this }
    addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]) }
    emit(type, fields = {}) {
      if (type === 'open') this.readyState = ProbeWebSocket.OPEN
      if (type === 'close') this.readyState = 3
      for (const callback of this.listeners.get(type) ?? []) callback.call(this, { type, ...fields })
    }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.emit('close') }
  }
  const context = vm.createContext({
    WebSocket: ProbeWebSocket,
    setTimeout: (callback, delay) => { const id = ++timerSequence; timers.set(id, { callback, delay }); return id },
    clearTimeout: (id) => timers.delete(id),
  })
  const connect = vm.runInContext(`${actualFunction}\nconnect`, context)
  return {
    connect: () => connect('ws://synthetic-only'),
    socket: () => socket,
    timers,
    fireRequestTimeout() {
      assert.equal(timers.size, 1)
      const [id, timer] = [...timers][0]
      assert.equal(timer.delay, 10_000)
      timers.delete(id)
      timer.callback()
    },
  }
}

async function connected(actualFunction) {
  const instance = runtime(actualFunction)
  const connecting = instance.connect()
  instance.socket().emit('open')
  return { ...instance, client: await connecting }
}

async function observe(promise) {
  let timer
  const settled = promise.then((value) => ({ status: 'fulfilled', value }), (error) => ({ status: 'rejected', error: String(error) }))
  const bounded = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'pending-at-25ms-bound' }), 25) })
  try { return await Promise.race([settled, bounded]) } finally { clearTimeout(timer) }
}

function record(name, observed, expectedStatus, extra = {}) {
  assert.equal(observed.status, expectedStatus, name)
  evidence.checks.push({ name, passed: true, observed, ...extra })
  console.log('PASS ' + name + ' ' + JSON.stringify({ observed, ...extra }))
}

const baseline = loadConnect('baseline')
const fixed = loadConnect('fixed')

for (const [label, actualFunction] of [['baseline', baseline], ['fixed', fixed]]) {
  const control = await connected(actualFunction)
  const request = control.client.evaluate('1 + 1')
  const sent = control.socket().sent[0]
  assert.equal(sent.method, 'Runtime.evaluate')
  assert.equal(sent.params.awaitPromise, true)
  control.socket().emit('message', { data: JSON.stringify({ id: sent.id, result: { result: { value: 2 } } }) })
  const normal = await observe(request)
  assert.equal(normal.value, 2)
  assert.equal(control.timers.size, 0)
  record(`${label}: normal reply`, normal, 'fulfilled', { remainingTimers: control.timers.size })

  const closed = await connected(actualFunction)
  const pending = closed.client.evaluate('void window.whitebox.call("app:quit")')
  closed.socket().emit('close')
  const closeResult = await observe(pending)
  assert.equal(closed.timers.size, 0)
  if (label === 'fixed') assert.equal(closeResult.error, 'Error: CDP connection closed')
  record(`${label}: close while request pending`, closeResult, label === 'fixed' ? 'rejected' : 'pending-at-25ms-bound', { remainingTimers: closed.timers.size })
}

const alreadyClosed = await connected(fixed)
alreadyClosed.socket().emit('close')
const closedResult = await observe(alreadyClosed.client.evaluate('1'))
assert.equal(closedResult.error, 'Error: CDP connection closed')
assert.equal(alreadyClosed.socket().sent.length, 0)
assert.equal(alreadyClosed.timers.size, 0)
record('fixed: request on already-closed socket', closedResult, 'rejected', { messagesSent: 0, remainingTimers: 0 })

const timedOut = await connected(fixed)
const unanswered = timedOut.client.evaluate('neverReplies()')
timedOut.fireRequestTimeout()
const timeoutResult = await observe(unanswered)
assert.equal(timeoutResult.error, 'Error: CDP request timed out')
assert.equal(timedOut.timers.size, 0)
record('fixed: request timeout', timeoutResult, 'rejected', { timeoutMs: 10_000, remainingTimers: 0 })

const errored = await connected(fixed)
const erroredRequest = errored.client.evaluate('1')
errored.socket().emit('error')
const errorResult = await observe(erroredRequest)
assert.equal(errorResult.error, 'Error: CDP connection closed')
assert.equal(errored.timers.size, 0)
record('fixed: socket error while request pending', errorResult, 'rejected', { remainingTimers: 0 })

for (const event of ['close', 'error']) {
  const unopened = runtime(fixed)
  const handshake = unopened.connect()
  unopened.socket().emit(event)
  const observed = await observe(handshake)
  assert.equal(observed.error, 'Error: CDP connection closed')
  record(`fixed: ${event} before open`, observed, 'rejected')
}

fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2))
console.log(`Verified ${evidence.checks.length} actual-connect conditions; no UI or build was run.`)

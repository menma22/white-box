import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
fs.mkdirSync(path.join(ROOT, '.e2e'), { recursive: true })
const RUN = fs.mkdtempSync(path.join(ROOT, '.e2e', 'timeline-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const now = Date.now()
const HOUR = 3600000
const day = new Date(now - 4 * HOUR)
const date = new Date(day)
date.setHours(9, 0, 0, 0)
const start = date.getTime()
const at = (hours) => start + hours * HOUR
const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
const task = (id, title) => ({ id, title, projectId: 'p', parentId: null, notes: '', status: 'todo', progress: 0, priority: 'normal', order: 0, createdAt: start, updatedAt: start, doneAt: null, createdInSessionId: null })
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify({
  version: 1, projects: [{ id: 'p', name: 'White Box 検証', hue: 150, archived: false, order: 0, createdAt: start, updatedAt: start }],
  tasks: [task('a', 'タイムラインの実装'), task('b', '時間計算と画面の検証')],
  sessions: [{
    id: 'session', startedAt: start, endedAt: at(10), state: 'ended', plannedMs: 10 * HOUR,
    segments: [
      { id: 'one', taskId: 'a', startedAt: start, endedAt: at(3) },
      { id: 'two', taskId: 'b', startedAt: at(3), endedAt: at(9) },
      { id: 'deleted', taskId: 'missing', startedAt: at(9), endedAt: at(10) },
    ],
    pauses: [{ startedAt: at(4.5), endedAt: at(5.5), reason: 'manual' }, { startedAt: at(7), endedAt: at(7.5), reason: 'excluded' }],
    events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: start,
  }], dayNotes: {}, settings: { shortcuts: { startPause: '', currentWork: '', dashboard: '' }, lastWelcomeDate: key, onboardedAt: now, soundOnExpire: false },
}))

const server = net.createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise((resolve) => server.close(resolve))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(test) {
  for (let i = 0; i < 100; i++) {
    const value = await test()
    if (value) return value
    await wait(100)
  }
  throw new Error('UI timeout')
}
const packaged = process.env.WHITEBOX_EXE
const electron = packaged ?? createRequire(import.meta.url)('electron')
const buildRoot = packaged ? path.join(path.dirname(packaged), 'resources', 'app') : ROOT
const expected = pathToFileURL(path.join(buildRoot, 'dist', 'index.html')).href + '#main'
const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
const log = fs.openSync(path.join(RUN, 'app.log'), 'w')
const child = spawn(electron, [...(packaged ? [] : [ROOT]), '--open=main', '--disable-gpu', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', log, log] })
fs.closeSync(log)
let ws
const errors = []
try {
  const target = await until(async () => {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json()
      return pages.find((page) => decodeURI(page.url) === decodeURI(expected))
    } catch { return null }
  })
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let sequence = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  await send('Runtime.enable')
  await send('Page.bringToFront')
  await until(() => evaluate('document.querySelectorAll(".ribbon-row").length === 2'))
  assert.equal(await evaluate('document.querySelectorAll(".ribbon-pause").length'), 2)
  assert.equal(await evaluate('document.querySelectorAll(".ribbon-excluded").length'), 1)
  const metrics = await evaluate('Array.from(document.querySelectorAll(".metric")).map(e=>e.textContent)')
  assert.ok(metrics.includes('1h一時停止'))
  assert.ok(metrics.includes('30m除外'))
  const shots = async (name) => {
    await wait(350)
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(RUN, name), Buffer.from(result.data, 'base64'))
  }
  await shots('01-timeline.png')
  const point = await evaluate('(() => { const r = document.querySelectorAll(".ribbon-work")[1].getBoundingClientRect(); return {x:r.x+r.width/4,y:r.y+r.height/2}; })()')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await until(() => evaluate('document.querySelector(".ribbon-detail").textContent.includes("時間計算と画面の検証")'))
  assert.match(await evaluate('document.querySelector(".ribbon-detail").textContent'), /実作業 1h 30m/)
  await shots('02-hover-detail.png')
  await evaluate('document.querySelector(".ribbon-work").focus()')
  assert.match(await evaluate('document.querySelector(".ribbon-detail").textContent'), /タイムラインの実装/)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert.match(await evaluate('document.activeElement.getAttribute("aria-label")'), /時間計算と画面の検証/)
  await evaluate('document.querySelector(".ribbon-excluded").focus()')
  assert.match(await evaluate('document.querySelector(".ribbon-detail").textContent'), /除外（後から申告）.*長さ 30m/)
  await evaluate('Array.from(document.querySelectorAll(".ribbon-work")).find(e=>e.getAttribute("aria-label").includes("削除されたタスク")).focus()')
  assert.match(await evaluate('document.querySelector(".ribbon-detail").textContent'), /削除されたタスク/)
  await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 820, deviceScaleFactor: 1, mobile: false })
  await evaluate('document.querySelector(".ribbon-excluded").focus()')
  await wait(200)
  assert.equal(await evaluate('(() => { const r=document.querySelector(".ribbon"); return r.scrollWidth <= r.clientWidth; })()'), true)
  await shots('03-narrow-exclusion.png')
  assert.deepEqual(errors, [])
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'))
  assert.equal(saved.sessions[0].editedAt, null)
  const edited = await evaluate(`window.whitebox.call('session:update', ${JSON.stringify({ id: 'session', patch: { startedAt: at(-1), endedAt: at(11) } })})`)
  assert.equal(edited.ok, true, JSON.stringify(edited))
  await until(() => evaluate('document.querySelector(".ribbon-work").getAttribute("aria-label").includes("08:00")'))
  await evaluate('document.querySelector(".ribbon-work").focus()')
  assert.match(await evaluate('document.querySelector(".ribbon-detail").textContent'), /08:00.*12:00.*実作業 4h/)
  await evaluate('Array.from(document.querySelectorAll(".ribbon-work")).at(-1).focus()')
  assert.match(await evaluate('document.querySelector(".ribbon-detail").textContent'), /18:00.*20:00.*実作業 2h/)
  assert.deepEqual(errors, [])
  await shots('04-edited-boundaries.png')
  console.log('PASS: two rows, crossing pause, hover detail, keyboard navigation, exclusion, deleted task, narrow layout, no renderer errors, unchanged records before editing, expanded session boundaries')
  console.log(`Screenshots: ${RUN}`)
} finally {
  ws?.close()
  child.kill()
}

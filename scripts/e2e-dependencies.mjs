import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e-dependencies')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const require = createRequire(import.meta.url)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : path.join(path.dirname(require.resolve('electron')), 'dist', 'electron.exe')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const errors = []
let child
let page
let port

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`)
  assert.ok(condition, name)
}

async function until(test, label, timeout = 10000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    try {
      const value = await test()
      if (value) return value
    } catch (err) { last = err }
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
  const send = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  return {
    send,
    close: () => ws.close(),
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
async function state() { return call('state:get') }
async function stateData() { const { revision, live, ...data } = await state(); return data }

async function launch(label) {
  port = await freePort()
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(RUN, `${label}-app.log`), 'a')
  const args = ['--hidden', '--open=main', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`]
  if (!process.env.WHITEBOX_EXE) args.unshift(ROOT)
  child = spawn(electron, args, { cwd: ROOT, env, stdio: ['ignore', log, log], windowsHide: true })
  console.log(`Electron PID: ${child.pid}`)
  fs.closeSync(log)
  let spawnError
  child.once('error', (err) => { spawnError = err })
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
  const kind = await page.evaluate('location.hash.slice(1)')
  await call('window:open', { kind })
  await page.send('Page.bringToFront')
  await wait(350)
  const viewport = await page.evaluate('({ url: location.href, visibility: document.visibilityState, hidden: document.hidden, focused: document.hasFocus(), width: innerWidth, height: innerHeight })')
  console.log(`Screenshot state: ${name} ${JSON.stringify(viewport)}`)
  fs.writeFileSync(path.join(RUN, `${name}-viewport.json`), JSON.stringify(viewport, null, 2))
  assert.ok(viewport.visibility === 'visible' && !viewport.hidden && viewport.width > 0 && viewport.height > 0, 'Screenshot target is visible')
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000)
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
}

async function key(key, code, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}), windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })
}

async function click(selector) {
  await page.send('Page.bringToFront')
  const point = await until(() => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const point={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && point.x>0 && point.x<innerWidth && point.y>0 && point.y<innerHeight && el.contains(document.elementFromPoint(point.x,point.y)) ? point : null })()`), selector)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait(100)
}

async function button(text, scope = 'body') {
  await page.send('Page.bringToFront')
  const point = await until(() => page.evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(el => el.textContent.trim() === ${JSON.stringify(text)}); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const point={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && point.x>0 && point.x<innerWidth && point.y>0 && point.y<innerHeight && el.contains(document.elementFromPoint(point.x,point.y)) ? point : null })()`), `button ${text}`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait(150)
}

async function fill(selector, value) {
  await click(selector)
  await key('a', 'KeyA', 2)
  await page.send('Input.insertText', { text: value })
}

async function select(selector, value) {
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw Error('Missing select'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await wait(150)
}

const now = Date.now()
const local = new Date(now)
const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
const appDay = new Date(now - 4 * 3600000)
const appToday = `${appDay.getFullYear()}-${String(appDay.getMonth() + 1).padStart(2, '0')}-${String(appDay.getDate()).padStart(2, '0')}`
const legacyTask = { id: 'legacy', projectId: null, parentId: null, title: '外部への確認を進める', notes: '', status: 'todo', progress: 70, priority: 'high', order: 0, createdAt: now, updatedAt: now, doneAt: null, createdInSessionId: null }
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify({ version: 1, projects: [], tasks: [legacyTask], sessions: [], dayNotes: {}, settings: { onboardedAt: now, lastWelcomeDate: appToday, soundOnExpire: false, showSessionCard: false, shortcuts: { startPause: '', currentWork: '', dashboard: '' } } }, null, 2))

async function rejectUnchanged(name, args) {
  const before = await stateData()
  const response = await raw(name, args)
  check(`Rejected ${name}: ${JSON.stringify(args)}`, response.ok === false && typeof response.error === 'string')
  const after = await stateData()
  const unchanged = isDeepStrictEqual(after, before)
  if (!unchanged) fs.writeFileSync(path.join(RUN, `rejected-state-${checks.length}.json`), JSON.stringify({ name, args, before, after }, null, 2))
  check('Rejected command preserves saved and live state', unchanged)
}

async function dateInput(selector, value) {
  await click(selector)
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
}

async function verifyCandidateWindow(kind, blockedTitle, advisoryTitle, archivedTitle) {
  const main = page
  await call('window:open', { kind })
  try {
    const target = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
      return (await response.json()).find((item) => item.type === 'page' && item.url.endsWith(`#${kind}`))
    }, `${kind} window`)
    page = await connect(target.webSocketDebuggerUrl)
    const row = kind === 'start' ? '.start-row' : '.current-row'
    await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`), `${kind} candidates`)
    const candidates = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll(${JSON.stringify(row)})];
      const blocked = rows.find((item) => item.textContent.includes(${JSON.stringify(blockedTitle)}));
      const advisory = rows.find((item) => item.textContent.includes(${JSON.stringify(advisoryTitle)}));
      return {
        blocked: Boolean(blocked && (blocked.matches('button') ? blocked : blocked.querySelector('button')).disabled && blocked.textContent.includes('先行タスク')),
        advisory: Boolean(advisory && !(advisory.matches('button') ? advisory : advisory.querySelector('button')).disabled && advisory.textContent.includes('推奨先行')),
        archivedAbsent: !rows.some((item) => item.textContent.includes(${JSON.stringify(archivedTitle)})),
      };
    })()`)
    check(`${kind}: hard blockers are visible and disabled, recommended order is advisory, archived targets are excluded`, candidates.blocked && candidates.advisory && candidates.archivedAbsent, candidates)
    await screenshot(kind === 'start' ? '06-start-candidates' : '07-current-candidates')
  } finally {
    if (page !== main) page.close()
    page = main
    await call('window:close', { kind })
    await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
      return !(await response.json()).some((item) => item.type === 'page' && item.url.endsWith(`#${kind}`))
    }, `${kind} window closed`)
    await page.send('Page.bringToFront')
  }
}

async function verifyUi() {
  await key('2', 'Digit2', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".board-cols"))'), 'board tab')
  await click('[data-task-id="legacy"]')
  await until(() => page.evaluate('Boolean(document.querySelector(".task-control"))'), 'task detail')
  await click('.task-control input[type="checkbox"]')
  await until(() => read().tasks.find((task) => task.id === 'legacy').blocked === true, 'blocked state persisted from UI')
  const editors = await page.evaluate('({ waiting: document.querySelectorAll(".detail .task-control").length, context: document.querySelectorAll(".detail .task-context").length })')
  check('A blocker update retains one waiting editor and one context editor', editors.waiting === 1 && editors.context === 1, editors)
  await fill('[aria-label="Blocked の理由"]', '返信の内容を確認中')
  await button('外部待ちを登録', '.task-control')
  await until(() => read().tasks.find((task) => task.id === 'legacy').blockReason === '返信の内容を確認中', 'blocked reason persisted from UI blur')
  check('Opening the external editor saves the entered Blocked reason', read().tasks.find((task) => task.id === 'legacy').blockReason === '返信の内容を確認中')
  await fill('.external-form label:nth-of-type(1) input', '共同研究者')
  await fill('.external-form label:nth-of-type(2) input', '実験条件への回答')
  await dateInput('.external-form label:nth-of-type(3) input', today)
  await dateInput('.external-form label:nth-of-type(4) input', today)
  await dateInput('.external-form label:nth-of-type(5) input', today)
  await button('外部待ちを保存', '.external-form')
  await until(() => read().tasks.find((task) => task.id === 'legacy').externalBlock?.who === '共同研究者', 'external wait persisted from UI')
  const saved = read().tasks.find((task) => task.id === 'legacy')
  check('External save preserves progress, status and completion', saved.progress === 70 && saved.status === 'todo' && saved.doneAt === null && saved.blocked && saved.blockReason === '返信の内容を確認中')
  check('External wait dates persist', saved.externalBlock.since === today && saved.externalBlock.lastContactOn === today && saved.externalBlock.nextFollowUpOn === today)
  await screenshot('01-detail-external-wait')
  await click('.detail-close')
  await until(() => page.evaluate('Boolean(document.querySelector(".external-waiting-row.is-due"))'), 'dedicated due external row')
  check('Dedicated external UI surfaces who, what, since and confirmation action', await page.evaluate('document.querySelector(".external-waiting").textContent.includes("共同研究者") && document.querySelector(".external-waiting").textContent.includes("実験条件への回答") && document.querySelector(".external-waiting").textContent.includes("確認しますか？")'))
  await screenshot('02-external-follow-up')
  await button('確認しますか？', '.external-waiting')
  check('Confirmation action opens editable task details', await page.evaluate('Boolean(document.querySelector(".task-control"))'))
  await button('外部待ちを解除', '.task-control')
  await click('.task-control input[type="checkbox"]')
  await until(() => !read().tasks.find((task) => task.id === 'legacy').blocked && read().tasks.find((task) => task.id === 'legacy').externalBlock === null, 'explicit unblock persisted')
  check('Explicit unblock keeps 70% progress', read().tasks.find((task) => task.id === 'legacy').progress === 70)
  await click('.detail-close')
}

async function verifyIpc() {
  const first = (await state()).tasks.find((task) => task.id === 'legacy')
  check('Legacy optional fields load without altering original task', isDeepStrictEqual(first, legacyTask))
  await verifyUi()
  const predecessor = await call('task:create', { title: '先行タスク', status: 'todo' })
  const dependent = await call('task:create', { title: '必須先行の完了を待つ', status: 'inbox', hardDependencies: [predecessor.id] })
  const advisory = await call('task:create', { title: '推奨順序でも自由に開始できる', status: 'todo', recommendedPredecessors: [predecessor.id] })
  const archive = await call('project:create', { name: 'アーカイブ対象' })
  const archivedTask = await call('task:create', { title: '保管した仕事', projectId: archive.id, status: 'todo' })
  await call('project:update', { id: archive.id, patch: { archived: true } })
  const external = { who: '外部担当', what: '確認', since: today, lastContactOn: null, nextFollowUpOn: today }
  await call('task:update', { id: archivedTask.id, patch: { externalBlock: external } })
  const inboxWait = await call('task:create', { title: 'Inboxの外部待ち', status: 'inbox', externalBlock: external })
  await until(() => page.evaluate(`document.querySelector('[data-external-task-id="${inboxWait.id}"]')?.textContent.includes('Inbox')`), 'Inbox wait visible')
  check('Inbox external waits are visible, archived waits require explicit reveal', !await page.evaluate(`Boolean(document.querySelector('[data-external-task-id="${archivedTask.id}"]'))`))
  await click('.external-waiting header input[type="checkbox"]')
  check('Archived external waits can be revealed without making them startable', await page.evaluate(`document.querySelector('[data-external-task-id="${archivedTask.id}"]')?.textContent.includes('アーカイブ')`))
  await click('.external-waiting header input[type="checkbox"]')
  await rejectUnchanged('session:start', { taskId: 'missing' })
  await rejectUnchanged('session:start', { taskId: dependent.id })
  await rejectUnchanged('task:move', { id: dependent.id, status: 'doing', index: 0 })
  await rejectUnchanged('session:start', { taskId: archivedTask.id })
  await rejectUnchanged('task:update', { id: predecessor.id, patch: { hardDependencies: [dependent.id] } })
  await rejectUnchanged('task:update', { id: dependent.id, patch: { hardDependencies: [dependent.id] } })
  await rejectUnchanged('task:update', { id: dependent.id, patch: { hardDependencies: ['missing'] } })
  await rejectUnchanged('task:update', { id: dependent.id, patch: { hardDependancies: [] } })
  await rejectUnchanged('task:update', { id: dependent.id, patch: { externalBlock: { who: '', what: 'reply', since: 'invalid', lastContactOn: null, nextFollowUpOn: null } } })
  await click(`[data-task-id="${dependent.id}"]`)
  await click('.task-link-title')
  await until(() => page.evaluate(`document.querySelector('.detail-title')?.value === ${JSON.stringify(predecessor.title)}`), 'related predecessor details')
  const beforeCycle = await stateData()
  await select('[aria-label="必須の先行タスクを追加"]', dependent.id)
  await until(() => page.evaluate('document.querySelector(".task-command-error")?.textContent.includes("循環")'), 'cycle error feedback')
  check('Related task navigation works and rejected UI edits show an error without changing data', isDeepStrictEqual(await stateData(), beforeCycle))
  await screenshot('08-cycle-error')
  await click('.detail-close')
  await verifyCandidateWindow('start', dependent.title, advisory.title, archivedTask.title)
  await verifyCandidateWindow('current', dependent.title, advisory.title, archivedTask.title)
  await call('session:start', { taskId: advisory.id })
  check('Recommended predecessor never forces or prevents starting', read().tasks.find((task) => task.id === advisory.id).status === 'doing')
  await rejectUnchanged('session:switchTask', { taskId: dependent.id })
  await call('session:end')
  await call('session:skipReview')
  await call('task:update', { id: predecessor.id, patch: { status: 'done' } })
  const live = await call('session:start', { taskId: dependent.id })
  check('Completing the hard predecessor permits Inbox commitment', read().tasks.find((task) => task.id === dependent.id).status === 'doing')
  await rejectUnchanged('task:update', { id: predecessor.id, patch: { status: 'todo' } })
  await rejectUnchanged('task:delete', { id: predecessor.id })
  await rejectUnchanged('task:update', { id: dependent.id, patch: { blocked: true } })
  await call('session:pause')
  await rejectUnchanged('task:update', { id: dependent.id, patch: { externalBlock: { who: '担当', what: '回答', since: today, lastContactOn: null, nextFollowUpOn: today } } })
  await call('session:resume')
  await call('session:end')
  await call('session:review', { sessionId: live.id, changes: [{ taskId: dependent.id, from: 0, to: 70, markedDone: false }] })
  await call('task:delete', { id: predecessor.id })
  check('Deleting a hard predecessor preserves its dangling link', read().tasks.find((task) => task.id === dependent.id).hardDependencies.includes(predecessor.id))
  await rejectUnchanged('session:start', { taskId: dependent.id })
  await click(`[data-task-id="${dependent.id}"]`)
  check('Missing predecessor is visible with explicit removal action', await page.evaluate('document.querySelector(".task-control").textContent.includes("削除されたタスク")'))
  await page.evaluate(`document.querySelector('button[aria-label="${predecessor.id} のリンクを解除"]').scrollIntoView({block:'center'})`)
  await screenshot('03-deleted-predecessor')
  await click(`button[aria-label="${predecessor.id} のリンクを解除"]`)
  await until(() => read().tasks.find((task) => task.id === dependent.id).hardDependencies.length === 0, 'unlink persisted from UI')
  await click('.detail-close')
  await call('session:start', { taskId: dependent.id })
  await call('session:end')
  await call('session:skipReview')
  await call('task:update', { id: dependent.id, patch: { status: 'done' } })
  await rejectUnchanged('session:start', { taskId: dependent.id })
  await call('task:update', { id: 'legacy', patch: { externalBlock: { who: '共同研究者', what: '追加回答', since: today, lastContactOn: today, nextFollowUpOn: today } } })
  return { dependentId: dependent.id, advisoryId: advisory.id, saved: read() }
}

try {
  await launch('first')
  const verified = await verifyIpc()
  await stop()
  await launch('restart')
  const persisted = await state()
  check('Control fields, task progress, histories and goal states survive restart', isDeepStrictEqual(persisted.tasks, verified.saved.tasks) && isDeepStrictEqual(persisted.sessions, verified.saved.sessions) && isDeepStrictEqual(persisted.goalMap, verified.saved.goalMap))
  await rejectUnchanged('session:start', { taskId: 'legacy' })
  await rejectUnchanged('session:start', { taskId: verified.dependentId })
  await key('2', 'Digit2', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".external-waiting-row.is-due"))'), 'follow-up after restart')
  await screenshot('04-restarted-follow-up')
  await call('session:start', { taskId: verified.advisoryId })
  await stop()
  const imported = read()
  imported.tasks.find((task) => task.id === verified.advisoryId).blocked = true
  imported.tasks.find((task) => task.id === verified.advisoryId).blockReason = '以前のデータに残っていた待ち状態'
  fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(imported, null, 2))
  await launch('blocked-recovery')
  check('Imported blocked live task is paused on restart', (await state()).live?.state === 'paused')
  await rejectUnchanged('recovery:resume', {})
  await until(() => page.evaluate('Boolean(document.querySelector(".recovery"))'), 'blocked recovery banner')
  check('Recovery UI exposes blocker and disables resume', await page.evaluate('document.querySelector(".recovery .task-control-hint")?.textContent.includes("以前のデータ") && [...document.querySelectorAll(".recovery button")].find((button)=>button.textContent.includes("続きから再開")).disabled'))
  await screenshot('05-blocked-recovery')
  await call('recovery:close')
  await call('session:skipReview')
  check('No renderer exceptions or console errors', errors.length === 0, errors)
} catch (error) {
  checks.push({ name: 'execution', passed: false, detail: error.stack })
  console.error(error)
  if (page) {
    try {
      const observed = await page.evaluate(`({ url: location.href, text: document.body.innerText, detail: document.querySelector('.detail')?.outerHTML,
        editors: { waiting: document.querySelectorAll('.detail .task-control').length, context: document.querySelectorAll('.detail .task-context').length },
        detailInert: document.querySelector('.detail')?.inert, mainInert: document.querySelector('.win.main')?.inert,
        externalForm: Boolean(document.querySelector('.external-form')), alerts: [...document.querySelectorAll('[role="alert"]')].map(item => item.textContent),
        activeElement: { tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label') } })`)
      fs.writeFileSync(path.join(RUN, 'failure-ui.json'), JSON.stringify(observed, null, 2))
      fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), observed.text)
      await screenshot('failure')
    } catch (captureError) { fs.writeFileSync(path.join(RUN, 'failure-capture-error.txt'), captureError.stack ?? String(captureError)) }
  }
  process.exitCode = 1
} finally {
  try { await stop() } catch (error) { checks.push({ name: 'shutdown', passed: false, detail: error.stack }); process.exitCode = 1 }
  fs.writeFileSync(path.join(RUN, 'report.json'), JSON.stringify({ executable: electron, checks, errors, run: RUN }, null, 2))
  console.log(`Evidence: ${RUN}`)
}

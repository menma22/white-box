import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'notes-run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = []
let child, page

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`)
  assert.ok(condition, name)
}

async function until(test, label, timeout = 10000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
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
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, method === 'Page.captureScreenshot' ? 30000 : 10000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Log.enable')
  return {
    send, close: () => ws.close(),
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

async function launch(label) {
  const port = await freePort()
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(RUN, `${label}-app.log`), 'a')
  const args = ['--hidden', '--open=main', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`]
  if (!process.env.WHITEBOX_EXE) args.unshift(ROOT)
  child = spawn(electron, args, { cwd: ROOT, env, stdio: ['ignore', log, log], windowsHide: true })
  fs.closeSync(log)
  let spawnError
  child.once('error', (error) => { spawnError = error })
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
  await page.send('Page.bringToFront')
  await wait(350)
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
}

async function key(key, code, modifiers = 0) {
  const params = { key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 }
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function click(selector) {
  const point = await until(() => page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); const p={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && p.x>0 && p.x<innerWidth && p.y>0 && p.y<innerHeight && el.contains(document.elementFromPoint(p.x,p.y)) ? p : null })()`), selector)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait(100)
}

async function button(text, scope = 'body') {
  const selector = await page.evaluate(`(() => { const all=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})]; const index=all.findIndex(el=>el.textContent.trim()===${JSON.stringify(text)}); return index<0 ? null : index; })()`)
  assert.notEqual(selector, null, `button ${text}`)
  await page.evaluate(`document.querySelectorAll(${JSON.stringify(scope + ' button')})[${selector}].setAttribute('data-notes-e2e-click','true')`)
  await click('[data-notes-e2e-click="true"]')
  await page.evaluate(`document.querySelector('[data-notes-e2e-click="true"]')?.removeAttribute('data-notes-e2e-click')`)
}

async function fill(selector, value) {
  await click(selector)
  await key('a', 'KeyA', 2)
  await page.send('Input.insertText', { text: value })
}

async function select(selector, value) {
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw Error('Missing select'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await wait(100)
}

const now = Date.now()
const day = new Date(now - 4 * 3600000)
const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
const oldTask = { id: 'task-1', projectId: 'project-1', parentId: null, title: '調査を進める', notes: '既存の内容', status: 'todo', progress: 25, priority: 'normal', order: 0, createdAt: now - 1000, updatedAt: now - 1000, doneAt: null, createdInSessionId: null }
const seed = {
  version: 1,
  projects: [{ id: 'project-1', name: '思考の実験', hue: 150, archived: false, order: 0, createdAt: now, updatedAt: now }],
  tasks: [oldTask], sessions: [], dayNotes: { [today]: '既存の日誌' },
  settings: { displayName: '', defaultSessionMinutes: 50, defaultExtendMinutes: 15, extendOptions: [5, 10, 15], shortcuts: { startPause: '', currentWork: '', dashboard: '' }, launchAtLogin: false, autoPauseOnSuspend: true, soundOnExpire: false, dayStartHour: 4, lastWelcomeDate: today, stallWarningDays: 3, onboardedAt: now },
}
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(seed, null, 2))

async function verify() {
  const initial = await call('state:get')
  check('Legacy database loads empty notes and preserves tasks', initial.notes.length === 0 && isDeepStrictEqual(initial.tasks, seed.tasks))
  await key('7', 'Digit7', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".notes-view"))'), 'notes view')
  await screenshot('01-empty')
  await page.evaluate(`(() => { const el=[...document.querySelectorAll('.notes-header button')].find(el=>el.textContent==='ノートを追加'); el.click(); el.click(); })()`)
  const first = await until(() => read().notes?.[0], 'note created from UI')
  await until(() => page.evaluate('Boolean(document.querySelector(".note-editor"))'), 'editor ready')
  await wait(800)
  check('Two clicks during creation produce one note', read().notes.length === 1)
  await fill('[aria-label="ノートのタイトル"]', '次に戻る場所')
  await fill('[aria-label="ノートの本文"]', 'API の調査を続ける。\nWorker の検証は保存の後で。')
  await call('settings:update', { patch: { defaultSessionMinutes: 51 } })
  check('State broadcasts retain the current draft', await page.evaluate(`document.querySelector('[aria-label="ノートの本文"]').value.includes('Worker の検証')`))
  await until(() => read().notes.find((note) => note.id === first.id)?.body.includes('Worker の検証'), 'autosave body')
  check('Autosave stores title and body without creating more notes', read().notes.length === 1 && read().notes[0].title === '次に戻る場所')
  const failedSaveFile = path.join(DATA, 'data.json.tmp')
  fs.writeFileSync(failedSaveFile, '')
  fs.chmodSync(failedSaveFile, 0o444)
  try {
    assert.throws(() => fs.writeFileSync(failedSaveFile, ''), /EPERM|EACCES/, 'The failure fixture must prevent an actual write')
  await fill('[aria-label="ノートの本文"]', '失敗しても書きかけを失わない。Worker と API。')
  await key('1', 'Digit1', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".note-save-error"))'), 'failed save remains in editor')
  check('Tab shortcut retains the failed draft and the note editor', await page.evaluate(`document.querySelector('[aria-label="ノートの本文"]')?.value.startsWith('失敗しても') && document.querySelector('.rail-tab.is-active')?.textContent.includes('ノート')`))
  await click('.rail-tabs .rail-tab:first-child')
  check('Tab click also retains the failed draft', await page.evaluate(`document.querySelector('[aria-label="ノートの本文"]')?.value.startsWith('失敗しても')`))
  } finally { fs.chmodSync(failedSaveFile, 0o666) }
  await key('1', 'Digit1', 2)
  await until(() => page.evaluate('!document.querySelector(".notes-view")'), 'successful retry leaves notes')
  check('Leaving after retry persists the entire failed draft', read().notes.find(note=>note.id===first.id).body.startsWith('失敗しても'))
  await until(() => page.evaluate(`(() => { const main=document.querySelector('.win.main'); return main && !main.inert && main.getAttribute('aria-busy')!=='true' && !document.querySelector('.editor-flush-status,[role="dialog"]') && document.querySelector('.rail-tab.is-active .rail-tab-key')?.textContent==='1'; })()`), 'Today is ready for the return shortcut')
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await key('7', 'Digit7', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".notes-view"))'), 'return to notes')
  await click('.note-list-item')
  await until(() => page.evaluate('Boolean(document.querySelector(".note-editor"))'), 'editor after retry')
  await select('[aria-label="ノートのプロジェクト"]', 'project-1')
  await select('[aria-label="ノートのタスク"]', 'task-1')
  await click('.note-pin input')
  await button('明日', '.note-editor')
  await until(() => { const note = read().notes.find((item) => item.id === first.id); return note?.pinned && note.taskId === 'task-1' && note.remindAt > Date.now() + 23 * 3600000 }, 'links, pin and future reminder saved')
  check('Project, task, pin and future date persist', read().notes[0].projectId === 'project-1' && read().notes[0].remindedAt === null)
  await screenshot('02-editor')
  const invalid = await raw('note:update', { id: first.id, patch: { boddy: 'invalid' } })
  check('Strict IPC rejects misspelled changes without overwriting the body', invalid.ok === false && read().notes[0].body.includes('Worker'))
  await button('ノートを追加', '.notes-header')
  await fill('[aria-label="ノートのタイトル"]', '別のノート')
  await fill('[aria-label="ノートの本文"]', '明日の買い物')
  await key('s', 'KeyS', 2)
  await until(() => read().notes.some((note) => note.title === '別のノート' && note.body === '明日の買い物'), 'second note saved')
  await fill('[aria-label="ノートを検索"]', 'api worker')
  await until(() => page.evaluate('document.querySelectorAll(".note-list-item").length===1'), 'search matches only first note')
  check('Search matches all words across title and body', await page.evaluate('document.querySelector(".note-list-item").textContent.includes("次に戻る場所")'))
  await click('.note-list-item')
  await fill('[aria-label="ノートの本文"]', '書きかけを残して一覧へ戻る。Worker と API。')
  await button('ノートを追加', '.notes-header')
  await until(() => read().notes.find((note) => note.id === first.id)?.body.startsWith('書きかけを残して'), 'switch saves latest input')
  check('Creating another note flushes the selected note before switching', read().notes.length === 3)
  await fill('[aria-label="ノートを検索"]', '書きかけ')
  await click('.note-list-item')
  await button('アーカイブ', '.note-editor')
  await until(() => read().notes.find((note) => note.id === first.id)?.archived, 'archived')
  check('Archive preserves content, links, pin and date', read().notes.find((note) => note.id === first.id).body.startsWith('書きかけ') && read().notes.find((note) => note.id === first.id).remindAt !== null)
  await click('.notes-filters label:last-child input')
  await click('.note-list-item')
  await screenshot('03-archived')
  await button('一覧に戻す', '.note-editor')
  await until(() => !read().notes.find((note) => note.id === first.id).archived, 'restored')
  await key('1', 'Digit1', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".reminder-panel"))'), 'today reminder panel')
  check('Daily view displays the pinned reminder', await page.evaluate('document.querySelector(".reminder-panel").textContent.includes("次に戻る場所")'))
  await screenshot('04-today-reminder')
  await click('.reminder-open')
  await until(() => page.evaluate(`document.querySelector('[aria-label="ノートのタイトル"]')?.value === '次に戻る場所'`), 'reminder deep link')
  check('Reminder opens the exact saved note', await page.evaluate(`document.querySelector('[aria-label="ノートの本文"]').value.startsWith('書きかけ')`))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 940, height: 620, deviceScaleFactor: 1, mobile: false })
  await screenshot('05-minimum-editor')
  const layout = await page.evaluate(`(() => { const root=document.querySelector('.notes-view'), editor=document.querySelector('.note-editor'), body=document.querySelector('.note-body-input'), list=document.querySelector('.notes-list'); return { width:innerWidth,height:innerHeight,editor:editor.getBoundingClientRect().height,body:body.getBoundingClientRect().height,list:list.getBoundingClientRect().height,overflow:root.scrollWidth-root.clientWidth,editorWidth:editor.getBoundingClientRect().width }; })()`)
  check('940x620 viewport retains usable list and editor with no horizontal overflow', layout.editor >= 250 && layout.body >= 200 && layout.list >= 100 && layout.editorWidth >= 250 && layout.overflow <= 1, layout)
  await page.send('Emulation.clearDeviceMetricsOverride')
  check('Existing tasks and daily notes stay unchanged', isDeepStrictEqual(read().tasks, seed.tasks) && isDeepStrictEqual(read().dayNotes, seed.dayNotes))
  return first.id
}

let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  const id = await verify()
  const persisted = read()
  fs.writeFileSync(path.join(RUN, 'before-restart.json'), JSON.stringify(persisted, null, 2))
  await stop()
  await launch('restart')
  const restarted = await call('state:get')
  check('Restart restores every note with content, links and reminder state', isDeepStrictEqual(restarted.notes, persisted.notes))
  await click('.reminder-open')
  await until(() => page.evaluate(`document.querySelector('[aria-label="ノートの本文"]')?.value.startsWith('書きかけ')`), 'restored editor')
  check('Restarted editor is linked to the original note', restarted.notes.find((note) => note.id === id).pinned)
  await key('1', 'Digit1', 2)
  await button('確認した', '.reminder-panel')
  await until(() => read().notes.find((note) => note.id === id).remindAt === null, 'reminder dismissed')
  check('Acknowledging clears the date and retains the pinned content', read().notes.find((note) => note.id === id).pinned)
  await screenshot('06-confirmed-pin')
  check('Renderer has no console errors or uncaught exceptions', errors.length === 0, errors)
  exitCode = 0
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {} }
} finally {
  try { await stop() } catch (error) { console.error(error); exitCode = 1 }
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, checks, errors }, null, 2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}

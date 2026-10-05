import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { OwnedProcesses, readWindowsProcesses, sameProcess } from './owned-processes.mjs'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'phase2-planning-run-'))
const DATA = path.join(RUN, 'data')
fs.mkdirSync(DATA)
const electron = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : createRequire(import.meta.url)('electron')
const startedAt = new Date().toISOString()
const buildRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
const runtimeFiles = ['dist-electron/presentation/main.js', 'apps/desktop/src/presentation/preload.cjs', 'dist-electron/app/handlers.js', 'dist-electron/app/lifecycle.js', 'dist-electron/app/state.js', 'dist-electron/infra/agent-service.js', 'dist-electron/infra/dataio.js', 'dist-electron/infra/renderer-flush.js', 'dist-electron/infra/windows.js', 'dist/index.html', ...fs.readdirSync(path.join(buildRoot, 'dist', 'assets')).filter((file) => file.endsWith('.js')).map((file) => 'dist/assets/' + file)]
const runtime = { startedAt, harnessSha256: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), ownedProcessesSha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'scripts', 'owned-processes.mjs'))).digest('hex'), executable: electron, buildRoot, executableSha256: createHash('sha256').update(fs.readFileSync(electron)).digest('hex'), files: runtimeFiles.map((file) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(buildRoot, file))).digest('hex') })) }
fs.writeFileSync(path.join(RUN, 'runtime-manifest.json'), JSON.stringify(runtime, null, 2))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = [], ownedProcesses = new OwnedProcesses(), pages = new Set(), expectedErrorWindows = []
let child, childIdentity, processObservation, page, port, appLog, faultLog, faultOwned = false

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
    if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' && message.params.entry.level === 'error' || message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push({ url, ...message })
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
  const connection = { send, close: () => ws.close(), async evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  } }
  pages.add(connection)
  return connection
}
async function windowPage(kind) {
  const target = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    return (await response.json()).find((item) => item.type === 'page' && item.url.endsWith('#' + kind))
  }, kind + ' window', 20000)
  const expected = pathToFileURL(path.join(buildRoot, 'dist', 'index.html')).href + '#' + kind
  check(`${kind}: CDP is attached to this build`, decodeURI(target.url) === decodeURI(expected), target.url)
  const connection = await connect(target.webSocketDebuggerUrl)
  await until(() => connection.evaluate('Boolean(window.whitebox && document.querySelector(".win"))'), kind + ' renderer ready')
  await connection.send('Page.bringToFront')
  return connection
}
async function windowClosed(kind) {
  await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })
    return !(await response.json()).some((item) => item.type === 'page' && item.url.endsWith('#' + kind))
  }, kind + ' window closed')
}
function processSnapshot(inventory = readWindowsProcesses()) {
  processObservation = ownedProcesses.observe(inventory)
  fs.writeFileSync(path.join(RUN, 'owned-process-observation.json'), JSON.stringify(processObservation, null, 2))
  return processObservation.remaining
}
async function launch(label) {
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
  page = await windowPage('main')
  await until(() => page.evaluate('Boolean(document.querySelector(".rail-tabs"))'), 'main navigation ready')
  fs.writeFileSync(path.join(RUN, `${label}-processes.json`), JSON.stringify(processSnapshot(), null, 2))
}
async function stop(label) {
  const current = child
  assert.ok(current, 'An owned app is running')
  processSnapshot()
  let quitError = null
  try { await page.evaluate('void window.whitebox.call("app:quit")') } catch (error) { quitError = error.message }
  for (const connection of pages) connection.close()
  pages.clear()
  await until(() => current.exitCode !== null || current.signalCode !== null, 'natural process exit', 15000)
  const remaining = await until(() => { const alive = processSnapshot(); return alive.length === 0 ? [] : false }, 'owned descendants exit', 10000)
  const observation = { pid: current.pid, creationDate: childIdentity.CreationDate, quitError, exitCode: current.exitCode, signalCode: current.signalCode, forcedCleanup: false, remaining, reused: processObservation.reused }
  fs.writeFileSync(path.join(RUN, `${label}-shutdown.json`), JSON.stringify(observation, null, 2))
  check(`${label}: natural quit exits with zero and leaves no owned PID`, current.exitCode === 0 && current.signalCode === null && remaining.length === 0, observation)
  child = undefined
  page = undefined
}
const read = () => JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'))
async function raw(name, args = {}) { return page.evaluate(`window.whitebox.call(${JSON.stringify(name)},${JSON.stringify(args)})`) }
async function call(name, args = {}) { const response = await raw(name, args); assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`); return response.data }
const savedTask = (id) => read().tasks.find((task) => task.id === id)
const exposedDatabaseFields = ['projects', 'tasks', 'sessions', 'settings', 'dayNotes', 'taskSuggestions', 'notes', 'goalMap', 'presenceCandidates', 'weeklyBudgets', 'weeklyBudgetDefaults', 'fixedWork']
const stateMatchesDatabase = (state, database) => exposedDatabaseFields.every((field) => isDeepStrictEqual(state[field], database[field]))
async function screenshot(name, selector, alignment = 'start') {
  await page.send('Page.bringToFront')
  if (selector) await page.evaluate(`(() => { const target=document.querySelector(${JSON.stringify(selector)}); if(!target) throw Error('Missing screenshot target'); target.scrollIntoView({block:${JSON.stringify(alignment)}}); })()`)
  await wait(350)
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
}
async function key(key, code, modifiers = 0) {
  const params = { key, code, modifiers, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Enter: 13, ArrowDown: 40, Home: 36, Escape: 27 }[key] ?? 0) }
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
  const selector = await page.evaluate(`(() => { const all=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})]; const el=all.find(el=>el.textContent.trim()===${JSON.stringify(text)}); if(!el) return null; el.setAttribute('data-phase2-e2e-click','true'); return '[data-phase2-e2e-click="true"]' })()`)
  assert.ok(selector, `button ${text} in ${scope}`)
  await click(selector)
  try { await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-phase2-e2e-click')`) } catch (error) { if (!/closed|context|target/i.test(error.message)) throw error }
}
async function fill(selector, value) { await click(selector); await key('a', 'KeyA', 2); await page.send('Input.insertText', { text: value }) }
async function select(selector, value) {
  await page.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled || ![...el.options].some(option=>option.value===${JSON.stringify(value)})) throw Error('Missing select option'); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await wait(100)
  const expected = selector === '[aria-label="配分するプロジェクトを追加"]' ? '' : value
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), expected, `Select ${selector} accepts ${value}`)
}
async function disclose(selector) { if (!await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.open`)) await click(selector + ' > summary') }
async function tab(number, selector) { await key(String(number), 'Digit' + number, 2); await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector) }
async function board() { await tab(2, '.board'); if (!await page.evaluate('Boolean(document.querySelector(".board-cols"))')) await button('ボード', '.board-head .segmented') }
async function detail(id) { await click(`[data-card][data-task-id="${id}"]`); await until(() => page.evaluate(`Boolean(document.querySelector('[data-task-context-id="${id}"]'))`), id + ' detail') }
const faultPath = path.join(DATA, 'data.json.tmp')
function beginExpectedErrors(label, commands, kind) {
  const observation = { label, file: path.basename(appLog), start: fs.statSync(appLog).size, end: null, commands, kind }
  expectedErrorWindows.push(observation)
  return observation
}
function endExpectedErrors(observation) { observation.end = fs.statSync(path.join(RUN, observation.file)).size }
function beginSaveFault(label, commands) {
  assert.equal(path.dirname(faultPath), DATA)
  assert.equal(path.dirname(DATA), RUN)
  assert.equal(path.dirname(RUN), OUTPUT)
  assert.equal(fs.existsSync(faultPath), false, 'The isolated temporary save path starts absent')
  fs.mkdirSync(faultPath)
  faultOwned = true
  faultLog = beginExpectedErrors(label, commands, 'filesystem')
  assert.throws(() => fs.writeFileSync(faultPath, 'fault probe'), /EISDIR|EACCES|EPERM/, 'The real filesystem write must fail')
}
function endSaveFault() { if (faultOwned) { endExpectedErrors(faultLog); faultLog = undefined; assert.equal(fs.readdirSync(faultPath).length, 0); fs.rmdirSync(faultPath); faultOwned = false } }
function applicationErrors() {
  const expected = [], unexpected = []
  for (const file of fs.readdirSync(RUN).filter((file) => file.endsWith('-app.log'))) {
    let offset = 0
    for (const rawLine of fs.readFileSync(path.join(RUN, file), 'utf8').split(/(?<=\n)/)) {
      const line = rawLine.trimEnd(), at = offset
      offset += Buffer.byteLength(rawLine)
      if (!/uncaught|unhandled\s*(?:promise|rejection)|\[white-box\].*(?:失敗|できません|読めなかった|窓を閉じません)/i.test(line)) continue
      const record = { file, offset: at, line }
      const command = line.match(/\[white-box\] コマンド失敗:\s+(\S+)/)?.[1] ?? (line.includes('[white-box] 入力の保存を待つため窓を閉じません:') ? 'window:close' : null)
      const window = expectedErrorWindows.find((item) => item.file === file && item.start <= at && item.end > at && item.commands.includes(command))
      const known = window && !/uncaught|unhandled/i.test(line) && (
        window.kind === 'filesystem' && (/EISDIR|EACCES|EPERM/.test(line) && line.includes(faultPath) || ['session:end', 'session:switchTask', 'window:close'].includes(command) && line.includes('入力を保存できなかったため、操作を取り消しました。')) ||
        window.kind === 'validation' && /ZodError/.test(line) || window.kind === 'native-import' && /SyntaxError/.test(line))
      if (known) expected.push({ ...record, reason: window.label })
      else unexpected.push(record)
    }
  }
  return { expected, unexpected }
}
async function unchangedAfterFailure(before, label, memoryBefore = before) {
  const state = await call('state:get')
  check(label + ': disk and exposed memory roll back completely', isDeepStrictEqual(read(), before) && stateMatchesDatabase(state, memoryBefore))
}

const now = Date.now()
const calendar = (value) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const monday = new Date(now)
monday.setHours(0, 0, 0, 0)
monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
const nextMonday = new Date(monday)
nextMonday.setDate(nextMonday.getDate() + 7)
const thisWeek = calendar(monday), nextWeek = calendar(nextMonday)
const laterMonday = new Date(nextMonday)
laterMonday.setDate(laterMonday.getDate() + 7)
const laterWeek = calendar(laterMonday)
const projectNames = ['下限の仕事', '上限の仕事', '範囲の仕事', '制限なしの仕事']
const task = (id, projectId, patch = {}) => ({ id, title: id === 'task-a' ? '既存の調査タスク' : 'もう一つの既存タスク', projectId, parentId: null, notes: '', status: 'todo', progress: 0, priority: 'normal', order: 0, createdAt: now - 1000, updatedAt: now - 1000, doneAt: null, createdInSessionId: null, ...patch })
const linkedNote = { id: 'linked-note', title: '既存の関連資料', body: '資料の本文を保持する。', projectId: 'project-0', taskId: 'task-a', pinned: true, archived: false, remindAt: null, remindedAt: null, createdAt: now - 1000, updatedAt: now - 1000 }
const seed = { version: 1, projects: projectNames.map((name, index) => ({ id: 'project-' + index, name, hue: 120 + index * 40, archived: false, order: index, createdAt: now, updatedAt: now })),
  tasks: [task('task-a', 'project-0', { notes: '既存の自由メモは保持する。', priority: 'low' }), task('task-b', 'project-1', { priority: 'high' })], sessions: [], notes: [linkedNote], dayNotes: { [calendar(now)]: '既存の日誌を保持する。' },
  settings: { onboardedAt: now, lastWelcomeDate: calendar(now), dayStartHour: 0, soundOnExpire: false, showSessionCard: false, shortcuts: { startPause: '', currentWork: '', dashboard: '' } } }
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(seed, null, 2))
const budgetScope = '.weekly-budget'
const sleepInput = '[aria-label="睡眠（週の合計時間）"]'
async function budgetEdit() { await disclose(budgetScope); await button(await page.evaluate(`document.querySelector('.weekly-budget').innerText.includes('時間配分を編集') ? '時間配分を編集' : '時間配分を決める'`), budgetScope) }
const contextScope = '[data-task-context-id="task-a"]'
const contextLabels = { notes: 'メモ', problems: '問題', decisions: '決定', nextContext: '次にすること・再開の手がかり' }
async function contextEdit(field, text, scope = contextScope) {
  if (!await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(scope + ' [aria-label="文脈の種類"]')}))`)) await button('手がかりを残す', scope)
  await select(scope + ' [aria-label="文脈の種類"]', field)
  await fill(scope + ` [aria-label="${contextLabels[field]}"]`, text)
}
async function openContextRecord(field, scope = contextScope) {
  const selector = await page.evaluate(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(scope + ' .task-context-record')})].find(record=>record.querySelector('summary').textContent===${JSON.stringify(contextLabels[field])}); if(!el) return null; el.setAttribute('data-phase2-record',${JSON.stringify(field)}); return ${JSON.stringify(scope + ` [data-phase2-record="${field}"]`)}; })()`)
  assert.ok(selector, 'saved context record ' + field)
  await disclose(selector)
}
async function linkedEditor() { await disclose(contextScope + ' details.phase2-disclosure'); await button('● 既存の関連資料', contextScope); await until(() => page.evaluate('Boolean(document.querySelector(".note-editor"))'), 'linked Note editor') }
function localDateTime(at) { const date = new Date(at); return `${calendar(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
async function fixedForm(startedAt, endedAt, reason) {
  await select('[aria-label="固定予定のタスク"]', 'task-a')
  for (const [label, value] of [['固定予定の開始日時', startedAt], ['固定予定の終了日時', endedAt]]) {
    await page.evaluate(`(() => { const input=document.querySelector('[aria-label="${label}"]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(input,${JSON.stringify(localDateTime(value))}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  }
  await fill('[aria-label="時刻が固定される外部の理由"]', reason)
}
async function createFixed(startedAt, endedAt, reason, verifyFailure = false) {
  const scope = '.board > .fixed-work-overview'
  await disclose(scope + ' > details')
  await button('外部の固定予定を登録', scope)
  await until(() => page.evaluate('Boolean(document.querySelector("#fixed-work-editor-title"))'), 'Fixed Work form')
  await fixedForm(startedAt, endedAt, verifyFailure ? '' : reason)
  if (verifyFailure) {
    await button('固定予定を保存', '[role="dialog"]')
    check('Fixed Work requires an external reason before registration', !read().fixedWork && await page.evaluate(`!document.querySelector('[role=dialog] form').checkValidity()`))
    await fill('[aria-label="時刻が固定される外部の理由"]', reason)
    const before = read()
    beginSaveFault('Fixed Work isolated write rejection', ['fixedWork:create'])
    try {
      await button('固定予定を保存', '[role="dialog"]')
      await until(() => page.evaluate('Boolean(document.querySelector("[role=dialog] [role=alert]"))'), 'Fixed Work actual save failure')
      check('Fixed Work failed save retains Task, time and external reason', await page.evaluate(`document.querySelector('[aria-label="固定予定のタスク"]').value==='task-a' && document.querySelector('[aria-label="固定予定の開始日時"]').value===${JSON.stringify(localDateTime(startedAt))} && document.querySelector('[aria-label="時刻が固定される外部の理由"]').value===${JSON.stringify(reason)}`))
      await unchangedAfterFailure(before, 'Fixed Work failure')
    } finally { endSaveFault() }
  }
  await button('固定予定を保存', '[role="dialog"]')
  await until(() => read().fixedWork?.some((work) => work.externalReason === reason), 'Fixed Work saved')
  await until(() => page.evaluate('!document.querySelector("[role=dialog]")'), 'Fixed Work dialog closes')
  return read().fixedWork.find((work) => work.externalReason === reason)
}

async function verifyBudget() {
  await tab(8, '.week')
  check('Week shows real activity before the closed, unset budget', await page.evaluate(`(() => { const metrics=document.querySelector('.week .today-strip'), budget=document.querySelector('.weekly-budget'); return !budget.open && budget.innerText.includes('未設定') && Boolean(metrics.compareDocumentPosition(budget)&Node.DOCUMENT_POSITION_FOLLOWING) && metrics.getBoundingClientRect().bottom<innerHeight })()`))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 940, height: 620, deviceScaleFactor: 1, mobile: false })
  await screenshot('01-week-metrics-first-minimum')
  check('940x620 Week retains visible activity and no horizontal overflow', await page.evaluate(`document.querySelector('.week .today-strip').getBoundingClientRect().bottom<620 && document.documentElement.scrollWidth<=innerWidth`))
  await page.send('Emulation.clearDeviceMetricsOverride')
  await budgetEdit()
  check('Unset living hours remain blank without invented values or calculations', await page.evaluate(`Array.from(document.querySelectorAll('.weekly-budget-inputs input')).every(el=>el.value==='') && !document.querySelector('.weekly-budget-equation')`))
  await button('時間配分を保存', budgetScope)
  check('Missing hours prevent a save', !read().weeklyBudgets && await page.evaluate(`!document.querySelector('.weekly-budget form').checkValidity()`))
  await fill(sleepInput, '56')
  await tab(2, '.board')
  await tab(8, '.week')
  await budgetEdit()
  check('Partial budget draft survives a tab change', await page.evaluate(`document.querySelector(${JSON.stringify(sleepInput)}).value==='56'`))
  await button('次の週', '.week-navigation')
  await button('前の週', '.week-navigation')
  await disclose(budgetScope)
  if (!await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(sleepInput)}))`)) await budgetEdit()
  check('Partial budget draft survives a week change', await page.evaluate(`document.querySelector(${JSON.stringify(sleepInput)}).value==='56'`))
  await fill('[aria-label="食事（週の合計時間）"]', '14')
  await fill('[aria-label="その他の固定時間（週の合計時間）"]', '7')
  const modes = ['minimum', 'maximum', 'range', 'unlimited']
  for (let index = 0; index < 4; index++) {
    await select('[aria-label="配分するプロジェクトを追加"]', 'project-' + index)
    await select(`[aria-label="配分の方式: ${projectNames[index]}"]`, modes[index])
    if (index === 0 || index === 2) await fill(`[aria-label="最小時間: ${projectNames[index]}"]`, index === 0 ? '100' : '20')
    if (index === 1 || index === 2) await fill(`[aria-label="最大時間: ${projectNames[index]}"]`, index === 1 ? '12' : '30')
  }
  await click('.weekly-budget form input[type="checkbox"]')
  const before = read()
  const memoryBefore = await call('state:get')
  beginSaveFault('Weekly Budget isolated write rejection', ['weeklyBudget:set'])
  try {
    await button('時間配分を保存', budgetScope)
    await until(() => page.evaluate('Boolean(document.querySelector(".weekly-budget [role=alert]"))'), 'budget actual save failure')
    await key('2', 'Digit2', 2)
    check('Budget failed save retains all input and blocks leaving the Week tab', await page.evaluate(`Boolean(document.querySelector('.week')) && document.querySelector(${JSON.stringify(sleepInput)}).value==='56' && document.querySelectorAll('.weekly-allocation').length===4 && document.querySelector('.weekly-budget form input[type=checkbox]').checked`))
    await unchangedAfterFailure(before, 'Weekly Budget failure', memoryBefore)
    await screenshot('02-budget-save-failure', '.weekly-budget [role="alert"]', 'center')
    await screenshot('02a-budget-retained-upper-inputs', '.weekly-budget-inputs')
  } finally { endSaveFault() }
  await button('時間配分を保存', budgetScope)
  await until(() => read().weeklyBudgets?.length === 1, 'budget retry')
  await until(() => page.evaluate('!document.querySelector(".weekly-budget form")'), 'saved budget summary')
  const plan = { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 420, allocations: [
    { projectId: 'project-0', mode: 'minimum', minutes: 6000 }, { projectId: 'project-1', mode: 'maximum', minutes: 720 },
    { projectId: 'project-2', mode: 'range', minimumMinutes: 1200, maximumMinutes: 1800 }, { projectId: 'project-3', mode: 'unlimited' },
  ] }
  check('All four allocation modes and personal defaults persist exactly', isDeepStrictEqual(read().weeklyBudgetDefaults, plan) && Object.keys(plan).every((field) => isDeepStrictEqual(read().weeklyBudgets[0][field], plan[field])))
  check('Budget displays 91h available and the minimum allocation shortage', await page.evaluate(`document.querySelector('.weekly-budget-equation').innerText.includes('91h') && document.querySelector('.weekly-budget .phase2-constraint').innerText.includes('29h')`))
  await screenshot('03-budget-four-modes', '.weekly-budget')
  await button('次の週', '.week-navigation')
  await disclose(budgetScope)
  await button('既定の配分を使う', budgetScope)
  check('Reuse opens the saved personal defaults without silently saving the next week', read().weeklyBudgets.length === 1 && await page.evaluate(`document.querySelector(${JSON.stringify(sleepInput)}).value==='56' && document.querySelectorAll('.weekly-allocation').length===4`))
  await button('時間配分を保存', budgetScope)
  await until(() => read().weeklyBudgets?.length === 2, 'reused next week saved')
  check('Next week reuses every allocation and living input', Object.keys(plan).every((field) => isDeepStrictEqual(read().weeklyBudgets.find((budget) => budget.weekStart === nextWeek)[field], plan[field])))
  await button('今週', '.week-navigation')
}

async function verifyProjectAndFixedWork() {
  await board()
  await button(projectNames[0], '.board-projects')
  await button('プロジェクトを編集', '.board-project-context')
  check('Legacy Project Priority stays unset in the real editor', await page.evaluate(`document.querySelector('[role=dialog] .segmented-item.is-active').textContent==='未設定'`))
  await page.evaluate(`(() => { window.__phase2ClickTrace=[]; for(const type of ['pointerdown','mousedown','mouseup','click']) document.addEventListener(type,event=>window.__phase2ClickTrace.push({type,target:event.target.textContent.trim(),tag:event.target.tagName,x:event.clientX,y:event.clientY,defaultPrevented:event.defaultPrevented}),{capture:true,once:true}); })()`)
  await button('重要', '[role="dialog"] .segmented')
  const priorityDraft = await page.evaluate(`({ active:document.querySelector('[role=dialog] .segmented-item.is-active')?.textContent, focus:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')}, frozen:document.querySelector('.main').inert, events:window.__phase2ClickTrace, buttons:[...document.querySelectorAll('[role=dialog] .segmented button')].map(button=>({text:button.textContent,active:button.classList.contains('is-active'),type:button.type})) })`)
  fs.writeFileSync(path.join(RUN, 'project-click-observation.json'), JSON.stringify(priorityDraft, null, 2))
  check('Selecting Project Priority updates the unsaved editor draft', priorityDraft.active === '重要', priorityDraft)
  await screenshot('04a-project-selected-priority')
  const before = read()
  beginSaveFault('Project Priority isolated write rejection', ['project:update'])
  try {
    await button('保存する', '[role="dialog"]')
    await until(() => page.evaluate('Boolean(document.querySelector("[role=dialog] [role=alert]"))'), 'project save failure')
    await key('8', 'Digit8', 2)
    check('Project failed save retains priority and keeps the editor open', await page.evaluate(`Boolean(document.querySelector('#project-editor-title')) && document.querySelector('[role=dialog] .segmented-item.is-active').textContent==='重要' && Boolean(document.querySelector('.board'))`))
    await unchangedAfterFailure(before, 'Project Priority failure')
    await screenshot('04-project-priority-save-failure')
  } finally { endSaveFault() }
  await button('保存する', '[role="dialog"]')
  await until(() => read().projects[0].priority === 'high', 'project priority saved')
  check('Project Priority changes independently from both Task priorities and unedited legacy Projects', isDeepStrictEqual(read().tasks, seed.tasks) && read().projects.slice(1).every((project) => !Object.hasOwn(project, 'priority')))
  await button('プロジェクトを編集', '.board-project-context')
  await button('未設定', '[role="dialog"] .segmented')
  await button('保存する', '[role="dialog"]')
  await until(() => !Object.hasOwn(read().projects[0], 'priority'), 'Project Priority cleared')
  check('The actual editor clears Project Priority through Electron without changing Task priorities', !Object.hasOwn((await call('state:get')).projects[0], 'priority') && isDeepStrictEqual(read().tasks, seed.tasks))
  await button('プロジェクトを編集', '.board-project-context')
  await button('重要', '[role="dialog"] .segmented')
  await button('保存する', '[role="dialog"]')
  await until(() => read().projects[0].priority === 'high', 'Project Priority restored')
  await button('すべて', '.board-projects')
  const boundary = nextMonday.getTime()
  const first = await createFixed(boundary - 30 * 60000, boundary + 90 * 60000, '相手が指定した境界をまたぐ会議', true)
  const second = await createFixed(boundary + 60 * 60000, boundary + 120 * 60000, '外部予約の重複する相談')
  check('Registering external schedules uses existing Tasks and does not create Tasks or Sessions', read().tasks.length === seed.tasks.length && read().sessions.length === 0 && (await call('state:get')).live === null)
  const row = `[data-fixed-work-id="${first.id}"]`
  await button('編集', row)
  await fixedForm(first.startedAt, boundary + 150 * 60000, '相手から確定した会議時間の変更')
  await button('固定予定を保存', '[role="dialog"]')
  await until(() => read().fixedWork.find((work) => work.id === first.id).endedAt === boundary + 150 * 60000, 'fixed work update')
  await tab(8, '.week')
  await disclose(budgetScope)
  check('This week clips the boundary schedule to 30 minutes', await page.evaluate(`document.querySelector('.weekly-budget-equation').innerText.includes('外部固定作業 30m')`))
  await button('次の週', '.week-navigation')
  await disclose(budgetScope)
  check('Next week counts overlapping external schedules once: 150 minutes', await page.evaluate(`document.querySelector('.weekly-budget-equation').innerText.includes('外部固定作業 2h 30m') && document.querySelector('.weekly-budget-equation strong').textContent==='88h 30m'`))
  await disclose('.week > .fixed-work-overview > details')
  check('Week exposes both real external schedules', await page.evaluate(`document.querySelectorAll('.week [data-fixed-work-id]').length===2`))
  await screenshot('05-week-boundary-overlap', '.weekly-budget')
  await screenshot('05b-week-overlapping-fixed-work', '.week > .fixed-work-overview')
  await board()
  await disclose('.board > .fixed-work-overview > details')
  await button('予定を取り消す', `[data-fixed-work-id="${second.id}"]`)
  await until(() => read().fixedWork.find((work) => work.id === second.id).cancelled, 'fixed cancellation saved')
  check('Cancellation retains the original Fixed Work record and never starts a Session', read().fixedWork.length === 2 && read().fixedWork.find((work) => work.id === second.id).externalReason === second.externalReason && read().sessions.length === 0)
  await click('.board > .fixed-work-overview input[type="checkbox"]')
  check('Cancelled schedule remains inspectable in the actual UI', await page.evaluate(`document.querySelector('[data-fixed-work-id="${second.id}"]').innerText.includes('取消済み')`))
  await click('.board > .fixed-work-overview input[type="checkbox"]')
  const todayStart = Math.ceil((Date.now() + 10 * 60000) / 60000) * 60000
  const todayWork = await createFixed(todayStart, todayStart + 30 * 60000, '今日の外部打ち合わせ')
  await tab(1, '.today')
  await disclose('.today .fixed-work-overview > details')
  const expectedToday = calendar(todayStart) === calendar(Date.now())
  check('Today lists external work only when its interval belongs to today', await page.evaluate(`Boolean(document.querySelector('[data-fixed-work-id="${todayWork.id}"]'))`) === expectedToday)
  await screenshot('06-today-fixed-work', '.today .fixed-work-overview')
  await wait(500)
  check('Schedule registration and display still leave the app idle', read().sessions.length === 0 && (await call('state:get')).live === null)
}

async function verifyTaskContext() {
  await board()
  await detail('task-a')
  await openContextRecord('notes')
  check('Existing free Notes and linked Note are preserved before editing structured context', savedTask('task-a').notes === seed.tasks[0].notes && isDeepStrictEqual(read().notes, [linkedNote]) && await page.evaluate(`document.querySelector(${JSON.stringify(contextScope)}).innerText.includes('既存の自由メモは保持する。')`))
  for (const [field, text] of [['problems', 'まだ未解決の API 応答。'], ['decisions', '結果は独立した呼び出しで確認する。'], ['nextContext', 'API の資料を開き、失敗ケースから再開する。']]) await contextEdit(field, text)
  await button('文脈を保存', contextScope)
  await until(() => savedTask('task-a').nextContext?.startsWith('API の資料'), 'structured context saved')
  check('Problems, Decisions and Next Context save without replacing legacy Notes or linked Notes', savedTask('task-a').problems === 'まだ未解決の API 応答。' && savedTask('task-a').decisions === '結果は独立した呼び出しで確認する。' && savedTask('task-a').notes === seed.tasks[0].notes && isDeepStrictEqual(read().notes, [linkedNote]))
  await contextEdit('problems', 'タスク移動の前に、この未解決事項を保存する。')
  await detail('task-b')
  check('Changing Task flushes the latest context draft', savedTask('task-a').problems === 'タスク移動の前に、この未解決事項を保存する。')
  await contextEdit('nextContext', '別のタスクは、設計図の比較から再開する。', '[data-task-context-id="task-b"]')
  await tab(8, '.week')
  check('Changing tab flushes the selected Task context', savedTask('task-b').nextContext === '別のタスクは、設計図の比較から再開する。')
  await board()
  await detail('task-a')
  await contextEdit('decisions', '詳細を閉じる前にも、最後の決定を保存する。')
  await click('.detail-close')
  await until(() => page.evaluate('!document.querySelector(".detail")'), 'Task detail closes')
  check('Closing the detail flushes the latest decision', savedTask('task-a').decisions === '詳細を閉じる前にも、最後の決定を保存する。')
  await detail('task-a')
  await linkedEditor()
  await fill('[aria-label="ノートの本文"]', '関連資料の編集も、Task を移る前に保存する。')
  await detail('task-b')
  check('Task navigation flushes the existing linked Note editor', read().notes[0].body === '関連資料の編集も、Task を移る前に保存する。' && read().notes[0].taskId === linkedNote.taskId && read().notes[0].pinned)
  await detail('task-a')
  await linkedEditor()
  const before = read()
  beginSaveFault('Linked Note isolated write rejection', ['note:update'])
  try {
    await fill('[aria-label="ノートの本文"]', '失敗した関連ノートの全文を、再試行まで保持する。')
    await key('8', 'Digit8', 2)
    await until(() => page.evaluate('Boolean(document.querySelector(".note-save-error"))'), 'linked Note save failure')
    check('A failed linked Note save blocks tab navigation and retains the full draft', await page.evaluate(`Boolean(document.querySelector('.board')) && document.querySelector('[aria-label="ノートの本文"]').value==='失敗した関連ノートの全文を、再試行まで保持する。'`))
    await unchangedAfterFailure(before, 'Linked Note failure')
    await screenshot('07-linked-note-save-failure', '.note-editor')
  } finally { endSaveFault() }
  await tab(8, '.week')
  check('Retry flushes the linked Note and then permits navigation', read().notes[0].body === '失敗した関連ノートの全文を、再試行まで保持する。')
  await click('.rail-start')
  const main = page
  page = await windowPage('start')
  await fill('.start-input', '既存の調査タスク')
  await until(() => page.evaluate(`document.querySelector('.restart-context')?.innerText.includes('API の資料を開き')`), 'Start restart context')
  check('Start shows saved Next Context for the selected existing Task', await page.evaluate(`document.querySelector('.restart-context').innerText.includes('失敗ケースから再開する')`))
  await screenshot('08-start-restart-context')
  await call('window:close', { kind: 'start' })
  page.close()
  page = main
  await windowClosed('start')
  await board()
  await detail('task-a')
  await contextEdit('nextContext', '保存失敗の入力から、調査を確実に開始する。')
  const startBefore = read()
  beginSaveFault('Task Context isolated write rejection', ['task:update'])
  try {
    await key('8', 'Digit8', 2)
    await until(() => page.evaluate(`Boolean(document.querySelector('${contextScope} [role=alert]'))`), 'Task Context save failure')
    await click('.detail-close')
    await click('[data-card][data-task-id="task-b"]')
    await click('.detail-foot .btn-primary')
    check('Failed Task context blocks tab, close, Task switch and start while retaining input', await page.evaluate(`Boolean(document.querySelector('.board')) && document.querySelector('${contextScope} [aria-label="次にすること・再開の手がかり"]').value==='保存失敗の入力から、調査を確実に開始する。'`) && read().sessions.length === 0 && (await call('state:get')).live === null)
    await unchangedAfterFailure(startBefore, 'Task Context failure')
    await screenshot('09-task-context-save-failure', contextScope + ' [role="alert"]', 'center')
  } finally { endSaveFault() }
  await click('.detail-foot .btn-primary')
  await until(() => read().sessions.length === 1, 'retry starts real Session')
  check('Successful start flushes the entire retained context first', savedTask('task-a').nextContext === '保存失敗の入力から、調査を確実に開始する。' && (await call('state:get')).live?.sessionId === read().sessions[0].id)
  await click('.rail-live')
  page = await windowPage('current')
  await until(() => page.evaluate(`document.querySelector('.restart-context')?.innerText.includes('保存失敗の入力から')`), 'Current Work restart context')
  await disclose('.current-body > details.phase2-disclosure')
  await contextEdit('nextContext', '現在の仕事を切り替える直前の、最新の手がかり。')
  const endBefore = read()
  beginSaveFault('Current Work isolated write and transition rejection', ['task:update', 'session:end', 'session:switchTask', 'window:close'])
  try {
    await button('セッション終了', '.current-actions')
    await until(() => page.evaluate(`Boolean(document.querySelector('${contextScope} [role=alert]'))`), 'Current Work context failure')
    await button('切り替える', '.current-list .current-row')
    await click('.titlebar-close')
    check('Current Work failed save blocks end, switch and close while retaining the context and active Session', await page.evaluate(`Boolean(document.querySelector('.current')) && document.querySelector('${contextScope} [aria-label="次にすること・再開の手がかり"]').value==='現在の仕事を切り替える直前の、最新の手がかり。'`) && read().sessions[0].endedAt === null && (await call('state:get')).live?.activeTaskId === 'task-a')
    const externalEnd = await main.evaluate('window.whitebox.call("session:end")')
    const externalSwitch = await main.evaluate('window.whitebox.call("session:switchTask", {taskId:"task-b"})')
    check('External end and switch requests also respect the failed Current Work draft', externalEnd.ok === false && externalSwitch.ok === false && read().sessions[0].endedAt === null && (await call('state:get')).live?.activeTaskId === 'task-a' && await page.evaluate(`Boolean(document.querySelector('${contextScope}'))`))
    await main.evaluate('window.whitebox.call("window:close", {kind:"current"})')
    await until(() => fs.readFileSync(appLog, 'utf8').slice(0).includes('[white-box] 入力の保存を待つため窓を閉じません:'), 'external Current Work native close veto')
    check('An external close request reaches the native close event and retains the failed draft', await page.evaluate(`Boolean(document.querySelector('.current')) && document.querySelector('${contextScope} [aria-label="次にすること・再開の手がかり"]').value==='現在の仕事を切り替える直前の、最新の手がかり。'`) && (await call('state:get')).live?.activeTaskId === 'task-a')
    check('Current Work failed update keeps persisted context unchanged', savedTask('task-a').nextContext === endBefore.tasks[0].nextContext)
    await screenshot('10-current-context-save-failure', contextScope + ' [role="alert"]', 'center')
  } finally { endSaveFault() }
  const switched = await main.evaluate('window.whitebox.call("session:switchTask", {taskId:"task-b"})')
  assert.equal(switched.ok, true, JSON.stringify(switched))
  await until(() => page.evaluate('Boolean(document.querySelector("[data-task-context-id=task-b]"))'), 'Task switched in Current Work')
  check('Switching current Task saves the latest context before the Session segment changes', savedTask('task-a').nextContext === '現在の仕事を切り替える直前の、最新の手がかり。' && read().sessions[0].segments.at(-1).taskId === 'task-b')
  await disclose('.current-body > details.phase2-disclosure')
  await contextEdit('decisions', '現在の仕事を閉じても、判断を保存しておく。', '[data-task-context-id="task-b"]')
  await main.evaluate('window.whitebox.call("window:close", {kind:"current"})')
  page = main
  await until(() => savedTask('task-b').decisions === '現在の仕事を閉じても、判断を保存しておく。', 'Current Work close flush')
  await windowClosed('current')
  await click('.rail-live')
  page = await windowPage('current')
  await until(() => page.evaluate('Boolean(document.querySelector("[data-task-context-id=task-b]"))'), 'Current Work reopened')
  await disclose('.current-body > details.phase2-disclosure')
  await openContextRecord('decisions', '[data-task-context-id="task-b"]')
  check('Closing and reopening Current Work retains the latest decision', savedTask('task-b').decisions === '現在の仕事を閉じても、判断を保存しておく。' && await page.evaluate(`document.querySelector('[data-task-context-id=task-b]').innerText.includes('現在の仕事を閉じても、判断を保存しておく。')`))
  await contextEdit('nextContext', '終了後は、この比較結果を再確認して続ける。', '[data-task-context-id="task-b"]')
  await screenshot('11-current-restart-context', '.current-body > details.phase2-disclosure')
  const ended = await main.evaluate('window.whitebox.call("session:end")')
  assert.equal(ended.ok, true, JSON.stringify(ended))
  page = main
  await until(() => read().sessions[0].endedAt !== null, 'real Session ended')
  check('An external end request flushes the Current Work context before ending the Session', savedTask('task-b').nextContext === '終了後は、この比較結果を再確認して続ける。')
  const review = await windowPage('review')
  const previous = page
  page = review
  await click('.review-foot .btn-primary')
  page = previous
  await until(async () => read().sessions[0].progressChanges.length === 2 && (await call('state:get')).pendingReview === null, 'review saved')
}

async function optionalNativeSettingsCheck() {
  if (process.env.WHITEBOX_NATIVE_SETTINGS_CHECK !== '1') return
  for (const kind of ['start', 'hud', 'expire', 'review', 'current']) await call('window:close', { kind })
  await tab(4, '.settings')
  const invalidImport = path.join(RUN, 'invalid-import.json')
  fs.writeFileSync(invalidImport, '{ invalid JSON }\n')
  const before = read(), memoryBefore = await call('state:get')
  const logWindow = beginExpectedErrors('Actual native import rejects the malformed fixture', ['data:import'], 'native-import')
  fs.writeFileSync(path.join(RUN, 'native-ready.json'), JSON.stringify({ pid: child.pid, profile: path.join(RUN, 'profile'), port, data: DATA, invalidImport }, null, 2))
  console.log(`Native Settings check ready: ${path.join(RUN, 'native-ready.json')}`)
  const completePath = path.join(RUN, 'native-complete.json')
  await until(() => fs.existsSync(completePath), 'actual native import error observation', 300000)
  const observation = JSON.parse(fs.readFileSync(completePath, 'utf8'))
  endExpectedErrors(logWindow)
  check('Native Settings import error was observed and dismissed', observation.importErrorObserved === true && observation.dialogDismissed === true, observation)
  await unchangedAfterFailure(before, 'Native import rejection', memoryBefore)
  await screenshot('16-settings-after-native-import-error')
}

let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  const initial = await call('state:get')
  check('Legacy DB leaves new optional planning, Project Priority and structured Task context absent', ['weeklyBudgets', 'weeklyBudgetDefaults', 'fixedWork'].every((field) => !Object.hasOwn(initial, field)) && initial.projects.every((project) => !Object.hasOwn(project, 'priority')) && initial.tasks.every((task) => ['problems', 'decisions', 'nextContext'].every((field) => !Object.hasOwn(task, field))))
  check('Legacy free Notes, linked Note and day notes load unchanged', isDeepStrictEqual(initial.tasks, seed.tasks) && isDeepStrictEqual(initial.notes, [linkedNote]) && isDeepStrictEqual(initial.dayNotes, seed.dayNotes))
  await verifyBudget()
  await verifyProjectAndFixedWork()
  await verifyTaskContext()
  const strictBefore = read()
  const strictLog = beginExpectedErrors('Strict planning IPC rejects the intentional unknown key', ['weeklyBudget:set'], 'validation')
  const rejected = await raw('weeklyBudget:set', { weekStart: thisWeek, plan: { ...read().weeklyBudgetDefaults, guessedHours: 8 } })
  endExpectedErrors(strictLog)
  check('Strict public planning IPC rejects unknown keys without changing saved state', rejected.ok === false && isDeepStrictEqual(read(), strictBefore))
  check('Existing free Notes, daily notes and linked Note identity remain intact', savedTask('task-a').notes === seed.tasks[0].notes && isDeepStrictEqual(read().dayNotes, seed.dayNotes) && read().notes.length === 1 && ['id', 'title', 'projectId', 'taskId', 'pinned', 'archived', 'remindAt', 'remindedAt', 'createdAt'].every((field) => read().notes[0][field] === linkedNote[field]))
  await optionalNativeSettingsCheck()
  await tab(8, '.week')
  await budgetEdit()
  await fill(sleepInput, '55')
  check('A new weekly draft remains distinct from the saved budget before quitting', read().weeklyBudgets.find((budget) => budget.weekStart === thisWeek).sleepMinutes === 3360 && await page.evaluate(`document.querySelector(${JSON.stringify(sleepInput)}).value==='55'`))
  await button('次の週', '.week-navigation')
  await button('次の週', '.week-navigation')
  await disclose(budgetScope)
  if (!await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(sleepInput)}))`)) await budgetEdit()
  await fill(sleepInput, '9')
  check('An incomplete new week draft does not invent the remaining living hours or commit a budget', !read().weeklyBudgets.some((budget) => budget.weekStart === laterWeek) && await page.evaluate(`document.querySelector('[aria-label="食事（週の合計時間）"]').value==='' && document.querySelector('[aria-label="その他の固定時間（週の合計時間）"]').value===''`))
  await screenshot('14-budget-unsaved-before-quit', '.weekly-budget')
  await board()
  await detail('task-a')
  await openContextRecord('notes')
  await contextEdit('problems', '終了直前の未保存の問題も、自然終了で保存する。')
  const beforeQuit = read()
  check('The final context draft is still unsaved before the actual quit request', savedTask('task-a').problems !== '終了直前の未保存の問題も、自然終了で保存する。')
  await screenshot('15-context-unsaved-before-quit', contextScope)
  fs.writeFileSync(path.join(RUN, 'before-quit.json'), JSON.stringify(beforeQuit, null, 2))
  await stop('first')
  const persisted = read()
  const expectedAfterQuit = structuredClone(beforeQuit)
  const flushedTask = persisted.tasks.find((task) => task.id === 'task-a')
  const expectedTask = expectedAfterQuit.tasks.find((task) => task.id === 'task-a')
  expectedTask.problems = '終了直前の未保存の問題も、自然終了で保存する。'
  expectedTask.updatedAt = flushedTask.updatedAt
  check('Natural quit flushes the final Task context and preserves every other Database field', isDeepStrictEqual(persisted, expectedAfterQuit))
  fs.writeFileSync(path.join(RUN, 'before-restart.json'), JSON.stringify(persisted, null, 2))
  await launch('restart')
  const restored = await call('state:get')
  check('Restart deeply restores the full saved file and every exposed Database field', isDeepStrictEqual(read(), persisted) && stateMatchesDatabase(restored, persisted))
  await board()
  await detail('task-a')
  await openContextRecord('notes')
  check('Restarted Task detail shows saved Next Context and legacy Notes', await page.evaluate(`document.querySelector('${contextScope}').innerText.includes('現在の仕事を切り替える直前') && document.querySelector('${contextScope}').innerText.includes('既存の自由メモは保持する')`))
  await screenshot('12a-restarted-structured-context', contextScope)
  await linkedEditor()
  check('Restarted linked Note editor retains the entire recovered draft', await page.evaluate(`document.querySelector('[aria-label="ノートの本文"]').value==='失敗した関連ノートの全文を、再試行まで保持する。'`))
  await screenshot('12-restarted-task-context', '.note-editor')
  await tab(8, '.week')
  await disclose(budgetScope)
  check('Restarted Week keeps personal budgets and default reuse available', await page.evaluate(`Boolean(document.querySelector('.weekly-budget-equation')) && [...document.querySelectorAll('.weekly-budget button')].some(button=>button.textContent==='既定の配分を使う')`))
  await budgetEdit()
  check('Natural quit and restart retain the unsaved weekly draft without changing the saved budget', await page.evaluate(`document.querySelector(${JSON.stringify(sleepInput)}).value==='55' && document.querySelectorAll('.weekly-allocation').length===4`) && read().weeklyBudgets.find((budget) => budget.weekStart === thisWeek).sleepMinutes === 3360)
  await button('次の週', '.week-navigation')
  await button('次の週', '.week-navigation')
  await disclose(budgetScope)
  if (!await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(sleepInput)}))`)) await budgetEdit()
  check('Restart also restores a partially entered new week with the missing hours still blank', await page.evaluate(`document.querySelector(${JSON.stringify(sleepInput)}).value==='9' && document.querySelector('[aria-label="食事（週の合計時間）"]').value==='' && document.querySelector('[aria-label="その他の固定時間（週の合計時間）"]').value===''`) && !read().weeklyBudgets.some((budget) => budget.weekStart === laterWeek))
  await screenshot('13-restarted-week-budget', '.weekly-budget')
  await stop('restart')
  check('Final natural quit preserves the full restarted Database', isDeepStrictEqual(read(), persisted))
  const appErrors = applicationErrors()
  fs.writeFileSync(path.join(RUN, 'application-errors.json'), JSON.stringify(appErrors, null, 2))
  check('Every monitored renderer has no console errors or uncaught exceptions', errors.length === 0, errors)
  check('App logs contain no unexpected application errors', appErrors.unexpected.length === 0, { unexpected: appErrors.unexpected, expectedRejections: appErrors.expected.length })
  const remaining = processSnapshot()
  fs.writeFileSync(path.join(RUN, 'remaining-processes.json'), JSON.stringify(processObservation, null, 2))
  check('No owned Electron PID remains after both natural shutdowns', remaining.length === 0, processObservation)
  exitCode = 0
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {} }
} finally {
  endSaveFault()
  if (child) {
    try { await stop('failure') } catch (error) {
      console.error(error)
      exitCode = 1
    }
  }
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

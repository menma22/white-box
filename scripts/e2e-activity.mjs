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
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'activity-run-'))
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
  const selector = await page.evaluate(`(() => { const all=[...document.querySelectorAll(${JSON.stringify(scope + ' button')})]; const index=all.findIndex(el=>(el.querySelector('.rail-tab-label')?.textContent ?? el.textContent).trim()===${JSON.stringify(text)}); return index<0 ? null : index; })()`)
  assert.notEqual(selector, null, `button ${text}`)
  await page.evaluate(`document.querySelectorAll(${JSON.stringify(scope + ' button')})[${selector}].setAttribute('data-activity-e2e-click','true')`)
  await click('[data-activity-e2e-click="true"]')
  await page.evaluate(`document.querySelector('[data-activity-e2e-click="true"]')?.removeAttribute('data-activity-e2e-click')`)
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const keyAt = (at) => dateKey(new Date(at - 4 * HOUR))
function shift(key, count) {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + count)
  return dateKey(date)
}
function at(key, hours, minutes = 0) {
  const date = new Date(`${key}T00:00:00`)
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}
function durationMinutes(value) {
  const match = value.replace(/\s/g, '').match(/^(?:(\d+)h)?(?:(\d+)m)?$/)
  assert.ok(match && (match[1] || match[2]), `Invalid duration: ${value}`)
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}
async function navigate(label, selector) {
  await button(label, '.rail-tabs')
  await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), label)
}
async function amounts(scope) {
  return page.evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(scope)});
    const rows=(selector)=>[...root.querySelectorAll(selector)].map(el=>({name:el.querySelector('span').textContent.trim(),time:el.querySelector('.num').textContent.trim()}));
    return {total:root.querySelector('.view-head .bigdur').textContent,
      projects:rows(':scope > .activity-breakdown [aria-label="プロジェクト別時間"] .activity-entry'),
      tasks:rows(':scope > .activity-breakdown [aria-label="進めたタスク"] .activity-entry')};
  })()`)
}
function verifyAmounts(label, values, total, expectedProjects, expectedTasks) {
  check(`${label}: total is the independently expected duration`, durationMinutes(values.total) === total, values)
  const actualProjects = Object.fromEntries(values.projects.map((row) => [row.name, durationMinutes(row.time)]))
  const actualTasks = Object.fromEntries(values.tasks.map((row) => [row.name, durationMinutes(row.time)]))
  check(`${label}: project attribution and total agree`, isDeepStrictEqual(actualProjects, expectedProjects) && Object.values(actualProjects).reduce((a, b) => a + b, 0) === total, actualProjects)
  check(`${label}: task attribution and total agree`, isDeepStrictEqual(actualTasks, expectedTasks) && Object.values(actualTasks).reduce((a, b) => a + b, 0) === total, actualTasks)
}
async function recorded(taskId, startedAt, endedAt, note) {
  const session = await call('session:start', { taskId, mode: 'stopwatch' })
  assert.ok(session?.id, 'Session was created through IPC')
  await call('session:end')
  await call('session:skipReview')
  await call('session:update', { id: session.id, patch: { startedAt, endedAt, note } })
  return session.id
}
async function verifyMinimum(scope, name) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 940, height: 620, deviceScaleFactor: 1, mobile: false })
  await page.evaluate("document.querySelector('.main-content').scrollTop=0")
  const layout = await page.evaluate(`(() => {
    const root=document.querySelector(${JSON.stringify(scope)}), content=document.querySelector('.main-content');
    return {width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollWidth-innerWidth,
      contentOverflow:content.scrollWidth-content.clientWidth,viewOverflow:root.scrollWidth-root.clientWidth,
      panels:[...root.querySelectorAll(':scope > .activity-breakdown .activity-panel, :scope > .activity-trend')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))};
  })()`)
  check(`${name}: 940x620 keeps readable panels without horizontal overflow`, layout.width === 940 && layout.height === 620 && layout.documentOverflow <= 1 && layout.contentOverflow <= 1 && layout.viewOverflow <= 1 && layout.panels.length === 3 && layout.panels.every((panel) => panel.width >= 200 && panel.height > 35), layout)
  await screenshot(name)
  await page.evaluate(`document.querySelector(${JSON.stringify(scope + ' .activity-trend')}).scrollIntoView({block:'center'})`)
  await screenshot(`${name}-trend`)
  await page.send('Emulation.clearDeviceMetricsOverride')
}

let today, previousMonday, historical, alpha, beta, goal, pauseId
async function createFixture() {
  const initial = await call('state:get')
  check('Isolated profile starts with no projects, tasks or sessions', initial.projects.length === 0 && initial.tasks.length === 0 && initial.sessions.length === 0)
  today = keyAt(Date.now())
  await call('settings:update', { patch: { onboardedAt: Date.now(), lastWelcomeDate: today, dayStartHour: 4, showSessionCard: false, soundOnExpire: false, autoPauseOnSuspend: false, launchAtLogin: false, shortcuts: { startPause: '', currentWork: '', dashboard: '' } } })
  await page.send('Page.reload')
  await until(() => page.evaluate('Boolean(document.querySelector(".today")) && !document.querySelector(".onboarding") && !document.querySelector(".welcome")'), 'isolated onboarding dismissed')
  const weekday = new Date(`${today}T12:00:00`).getDay()
  previousMonday = shift(today, -((weekday + 6) % 7) - 7)
  const projectA = await call('project:create', { name: 'Activity Alpha' })
  const projectB = await call('project:create', { name: 'Activity Beta' })
  goal = await call('goal:create', { goal: '成果は人が判定する' })
  alpha = await call('task:create', { title: 'Alpha の実作業', projectId: projectA.id, status: 'todo', goalNodeId: goal.id })
  beta = await call('task:create', { title: 'Beta の実作業', projectId: projectB.id, status: 'todo', goalNodeId: goal.id })
  const removed = await call('task:create', { title: '削除前の記録', status: 'todo' })
  const boundary = await recorded(alpha.id, at(previousMonday, 3, 30), at(previousMonday, 4, 30), '月曜4時の前後に30分ずつ')
  const primary = await recorded(alpha.id, at(previousMonday, 8), at(previousMonday, 9), '先行記録60分')
  const overlapping = await recorded(beta.id, at(previousMonday, 8, 30), at(previousMonday, 9, 30), '重複30分と追加30分')
  const edited = await recorded(alpha.id, at(shift(previousMonday, 1), 10), at(shift(previousMonday, 1), 10, 30), '終了時刻の編集')
  await call('session:update', { id: edited, patch: { endedAt: at(shift(previousMonday, 1), 10, 45) } })
  const deleted = await recorded(removed.id, at(shift(previousMonday, 2), 11), at(shift(previousMonday, 2), 11, 20), 'タスク削除後も20分を保持')
  await call('task:delete', { id: removed.id })
  await call('task:update', { id: alpha.id, patch: { status: 'todo', progress: 70 } })
  await call('task:update', { id: beta.id, patch: { status: 'done', progress: 100, doneAt: at(shift(previousMonday, 1), 12) } })
  historical = { boundary, primary, overlapping, edited, deleted }
  const persisted = read()
  check('Fixtures use IPC edits and preserve deleted-task session references', persisted.sessions.length === 5 && persisted.sessions.every((session) => session.editedAt !== null) && persisted.sessions.find((session) => session.id === deleted).segments[0].taskId === removed.id && !persisted.tasks.some((task) => task.id === removed.id))
  check('Editing times and completing tasks do not assess the linked goal', isDeepStrictEqual(persisted.goalMap.nodes[goal.id], goal))
}

async function verifyWeek(expectedToday = 0) {
  await navigate('週', '.week')
  await button('前の週', '.week-navigation')
  await until(() => page.evaluate(`document.querySelector('.week .view-title').textContent.startsWith(${JSON.stringify(previousMonday)})`), 'previous week selected')
  verifyAmounts('Previous week', await amounts('.week'), 185, { 'Activity Alpha': 135, 'Activity Beta': 30, 'プロジェクトなし・削除済み': 20 }, { 'Alpha の実作業': 135, 'Beta の実作業': 30, '（削除されたタスク）': 20 })
  const metrics = await page.evaluate(`[...document.querySelectorAll('.week > .today-strip .metric')].map(el=>({label:el.querySelector('.label').textContent,value:el.querySelector('.metric-value').textContent}))`)
  check('Weekly metrics count three worked days, five original sessions and one completed task', isDeepStrictEqual(Object.fromEntries(metrics.map((metric) => [metric.label, Number(metric.value)])), { '記録のある日': 3, 'セッション': 5, '完了したタスク': 1 }), metrics)
  const days = await page.evaluate(`[...document.querySelectorAll('.week-day > summary')].map(el=>({label:el.querySelector('span').textContent,time:el.querySelector('.num').textContent}))`)
  check('Week starts Monday and includes all seven daily totals, including zero days', days.length === 7 && days[0].label.includes('月') && isDeepStrictEqual(days.map((day) => durationMinutes(day.time)), [120, 45, 20, 0, 0, 0, 0]), days)
  for (let index = 0; index < 7; index++) await click(`.week-day:nth-of-type(${index + 1}) > summary`)
  const sessionTimes = await page.evaluate(`[...document.querySelectorAll('.week-day[open] .srow-focus')].map(el=>{const copy=el.cloneNode(true);copy.querySelector('small')?.remove();return copy.textContent.trim()})`)
  check('In-period session values sum to the same 185 minutes', sessionTimes.length === 5 && sessionTimes.reduce((sum, value) => sum + durationMinutes(value), 0) === 185, sessionTimes)
  check('Original 60-minute boundary session is distinguished from the 30-minute daily portion', await page.evaluate(`(() => { const row=[...document.querySelectorAll('.week-day[open] .srow')].find(el=>el.textContent.includes('月曜4時の前後に30分ずつ')); return row.querySelector('.srow-scope').textContent.includes('全体 1h') && row.querySelector('.srow-focus').firstChild.textContent.trim()==='30m' && document.querySelector('.week').textContent.includes('タスク完了は目標の成果達成とは別'); })()`))
  for (let index = 0; index < 7; index++) await click(`.week-day:nth-of-type(${index + 1}) > summary`)
  await page.evaluate("document.querySelector('.main-content').scrollTop=0")
  await screenshot('01-previous-week')
  await page.evaluate("document.querySelector('.week > .activity-breakdown').scrollIntoView({block:'center'})")
  await screenshot('01b-week-breakdown')
  await verifyMinimum('.week', '02-minimum-week')
  await button('前の週', '.week-navigation')
  const preceding = await amounts('.week')
  verifyAmounts('Preceding week', preceding, 30, { 'Activity Alpha': 30 }, { 'Alpha の実作業': 30 })
  const precedingDays = await page.evaluate(`[...document.querySelectorAll('.week-day > summary .num')].map(el=>el.textContent)`)
  check('The other 30 boundary minutes belong to Sunday of the preceding week', isDeepStrictEqual(precedingDays.map(durationMinutes), [0, 0, 0, 0, 0, 0, 30]))
  await button('次の週', '.week-navigation')
  check('Next week restores the original selection', await page.evaluate(`document.querySelector('.week .view-title').textContent.startsWith(${JSON.stringify(previousMonday)})`))
  await button('今週', '.week-navigation')
  await navigate('今日', '.today')
  check('Historical fixtures do not leak into today', durationMinutes((await amounts('.today')).total) === expectedToday)
}

async function verifyTodayAndLive() {
  const session = await call('session:start', { taskId: alpha.id, mode: 'stopwatch' })
  await wait(1100)
  const running = await call('state:get')
  check('Live stopwatch appears before a session is ended', running.live?.sessionId === session.id && await page.evaluate('document.querySelectorAll(".today .srow.is-live").length===1'))
  await call('session:pause')
  await wait(1200)
  await call('session:resume')
  await wait(1100)
  await call('session:end')
  await call('session:skipReview')
  const ended = (await call('state:get')).sessions.find((item) => item.id === session.id)
  const observedPause = ended.pauses.filter((pause) => pause.reason === 'manual').reduce((sum, pause) => sum + pause.endedAt - pause.startedAt, 0)
  check('Real pause/resume records an observed interval', observedPause >= 1000)
  const elapsedDay = ended.endedAt - at(today, 4)
  const workMs = Math.min(8 * MINUTE, Math.max(0, elapsedDay - observedPause - MINUTE))
  assert.ok(workMs > 0 && keyAt(ended.endedAt) === today, 'Run must keep a stable recording day with room before the observed pause')
  const start = ended.endedAt - workMs - observedPause
  const exclusionMs = Math.min(3 * MINUTE, Math.floor(workMs / 2))
  await call('session:update', { id: session.id, patch: { startedAt: start, exclusions: [{ startedAt: start, endedAt: start + exclusionMs }] } })
  await call('task:update', { id: alpha.id, patch: { status: 'todo', progress: 70 } })
  pauseId = session.id
  const expectedMinutes = Math.floor((workMs - exclusionMs) / MINUTE)
  await until(async () => durationMinutes((await amounts('.today')).total) === expectedMinutes, 'today pause and exclusion values')
  verifyAmounts('Today', await amounts('.today'), expectedMinutes, { 'Activity Alpha': expectedMinutes }, { 'Alpha の実作業': expectedMinutes })
  check('Today shows declared progress, observed pause and exclusion separately', await page.evaluate(`document.querySelector('.today .activity-progress').textContent.includes('現在 70%') && document.querySelectorAll('.today .ribbon-pause').length > 0 && document.querySelectorAll('.today .ribbon-excluded').length > 0`))
  const timelineWork = await page.evaluate(`[...document.querySelectorAll('.today .ribbon-work')].map(el=>el.getAttribute('aria-label'))`)
  check('Timeline work descriptions remain accessible', timelineWork.length > 0 && timelineWork.every((label) => label.includes('Alpha の実作業') && label.includes('実作業')), timelineWork)
  await screenshot('03-today-pause-exclusion')
  await verifyMinimum('.today', '04-minimum-today')
  const trend = await page.evaluate(`[...document.querySelectorAll('.today .trend-values li')].map(el=>({key:el.querySelector('span').textContent,time:el.querySelector('.num').textContent}))`)
  const expected = { [previousMonday]: 120, [shift(previousMonday, 1)]: 45, [shift(previousMonday, 2)]: 20, [shift(previousMonday, -1)]: 30, [today]: expectedMinutes }
  check('Fourteen consecutive trend days include independently expected nonzero and zero values', trend.length === 14 && trend.every((day, index) => day.key === shift(today, index - 13) && durationMinutes(day.time) === (expected[day.key] ?? 0)) && trend.some((day) => durationMinutes(day.time) === 0), trend)
  check('Trend draws all fourteen points, including zero days', await page.evaluate('document.querySelectorAll(".today .trend-point").length===14'))
  await call('task:update', { id: beta.id, patch: { status: 'todo' } })
  const timer = await call('session:start', { taskId: beta.id, mode: 'timer', minutes: 1 })
  const timerStart = start - 2 * MINUTE
  await call('session:update', { id: timer.id, patch: { startedAt: timerStart } })
  await call('session:pause')
  await until(async () => (await call('state:get')).sessions.find((item) => item.id === timer.id).expiredNotifiedAt !== null, 'real timer reaches its planned cap')
  const beforeWait = await amounts('.today')
  await wait(1300)
  const afterWait = await amounts('.today')
  const timerTodayMinutes = Math.floor(Math.max(0, timerStart + MINUTE - Math.max(timerStart, at(today, 4))) / MINUTE)
  check('Expired live timer contributes only its one-minute work cap and stops growing', durationMinutes(beforeWait.total) === expectedMinutes + timerTodayMinutes && isDeepStrictEqual(afterWait, beforeWait), afterWait)
  await screenshot('05-expired-live-timer')
  await call('session:end')
  await call('session:skipReview')
  await call('task:update', { id: beta.id, patch: { status: 'done', progress: 100, doneAt: at(shift(previousMonday, 1), 12) } })
  const state = await call('state:get')
  check('Viewing activity never changes declared progress or goal achievement', state.tasks.find((task) => task.id === alpha.id).progress === 70 && isDeepStrictEqual(state.goalMap.nodes[goal.id], goal))
  return { expectedMinutes, timerTodayMinutes }
}

let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  await createFixture()
  await verifyWeek()
  const expected = await verifyTodayAndLive()
  const persisted = read()
  fs.writeFileSync(path.join(RUN, 'before-restart.json'), JSON.stringify(persisted, null, 2))
  await stop()
  await launch('restart')
  const restarted = await call('state:get')
  check('Restart preserves every edited session, task declaration and unassessed goal', isDeepStrictEqual(restarted.sessions, persisted.sessions) && isDeepStrictEqual(restarted.tasks, persisted.tasks) && isDeepStrictEqual(restarted.goalMap, persisted.goalMap))
  check('Restarted daily total retains the edited pause/exclusion and expired timer cap', durationMinutes((await amounts('.today')).total) === expected.expectedMinutes + expected.timerTodayMinutes)
  check('The saved exclusion and historical session IDs survive reload', restarted.sessions.find((session) => session.id === pauseId).pauses.some((pause) => pause.reason === 'excluded') && Object.values(historical).every((id) => restarted.sessions.some((session) => session.id === id)))
  await verifyWeek(expected.expectedMinutes + expected.timerTodayMinutes)
  await screenshot('06-restarted-today')
  check('Renderer has no console errors or uncaught exceptions', errors.length === 0, errors)
  check('Screenshots contain captured PNG evidence', fs.readdirSync(RUN).filter((name) => name.endsWith('.png')).length >= 8 && fs.readdirSync(RUN).filter((name) => name.endsWith('.png')).every((name) => fs.statSync(path.join(RUN, name)).size > 1000))
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


import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e')
fs.mkdirSync(OUTPUT, { recursive: true })
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'task-priority-run-'))
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

async function fill(selector, value) {
  await click(selector)
  await key('a', 'KeyA', 2)
  await page.send('Input.insertText', { text: value })
}


const now = Date.now()
const DAY = 86_400_000
const calendar = (at) => { const date=new Date(at); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}` }
const task = (id, patch={}) => ({ id, title:id, projectId:null, parentId:null, notes:'', status:'todo', progress:0,
  priority:'normal', order:0, createdAt:now - 100 * DAY, updatedAt:now, doneAt:null, createdInSessionId:null, ...patch })
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify({ version:1, projects:[
  { id:'archived-project', name:'アーカイブした仕事', hue:150, archived:true, order:0, createdAt:now, updatedAt:now },
], sessions:[], dayNotes:{}, tasks:[
  task('legacy-inbox', { status:'inbox', priority:'high' }), task('legacy-todo'),
  task('aging-warning', { committedAt:now - 4 * DAY }),
  task('negative-slack', { committedAt:now, due:calendar(now + DAY), remainingEffortMinutes:100000, safetyBufferMinutes:0 }),
  task('deadline-overdue', { committedAt:now, due:calendar(now - DAY), blocked:true, blockReason:'承認待ち',
    externalBlock:{who:'確認担当',what:'承認の返答',since:calendar(now - DAY),lastContactOn:null,nextFollowUpOn:calendar(now)} }),
  task('archived-overdue', { projectId:'archived-project', committedAt:now, due:calendar(now - DAY) }),
], settings:{ onboardedAt:now, lastWelcomeDate:null, stallWarningDays:3, shortcuts:{startPause:'',currentWork:'',dashboard:''} } }))

async function board() {
  await key('2','Digit2',2)
  await until(() => page.evaluate('Boolean(document.querySelector(".board"))'), 'board')
  if (!await page.evaluate('Boolean(document.querySelector(".board-cols"))')) await click('.board-head .segmented-item:first-child')
  await until(() => page.evaluate('Boolean(document.querySelector(".board-cols"))'), 'board view')
}
async function detail(id) {
  await click(`[data-card][data-task-id="${id}"]`)
  await until(() => page.evaluate('Boolean(document.querySelector(".detail"))'), 'task detail')
}
async function warningSnapshot(surface) {
  return page.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(surface+' .task-warnings [data-warning-task]')}), row => ({
    id:row.dataset.warningTask, risk:row.querySelector('.task-risk-badge').dataset.risk,
    disabled:row.querySelector('.btn-primary').disabled, problem:row.querySelector('[data-warning-execution]')?.textContent ?? ''
  }))`)
}
async function waitingDetail(label) {
  await until(() => page.evaluate(`document.querySelector('.detail-title')?.value==='deadline-overdue'`), label+' detail')
  check(label+' opens the shared detail with readable Blocked reason and disabled start',await page.evaluate(`
    document.querySelector('.detail [data-execution-problem]').textContent.includes('承認待ち') &&
    document.querySelector('.detail-foot .btn-primary').disabled &&
    document.querySelector('.task-control input[type="checkbox"]').checked
  `))
  await page.evaluate(`document.querySelector('.task-control').scrollIntoView({block:'center'})`)
  check(label+' reaches the waiting and predecessor editor',await page.evaluate(`(() => {
    const r=document.querySelector('input[aria-label="Blocked の理由"]').getBoundingClientRect();
    return r.top>=0 && r.bottom<=innerHeight && Boolean(document.querySelector('.task-control .external-summary'));
  })()`))
}
const effortInput='input[aria-label="残作業の見積（任意）"]'
const bufferInput='input[aria-label="安全余裕（任意）"]'
let exitCode=1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  const initial=await call('state:get')
  const legacy=initial.tasks.find(item=>item.id==='legacy-inbox')
  check('Legacy load leaves optional planning and commitment fields absent', ['remainingEffortMinutes','safetyBufferMinutes','committedAt','lastProgressAt'].every(field=>!Object.hasOwn(legacy,field)))
  await until(() => page.evaluate('Boolean(document.querySelector(".welcome"))'), 'Welcome overlay')
  check('Welcome displays Warning, High Risk and Overdue with their reasons', await page.evaluate(`['Warning','High Risk','Overdue'].every(label=>document.querySelector('.welcome .task-warnings').innerText.includes(label))`))
  check('Legacy Inbox and unobserved legacy Todo have no warning', await page.evaluate(`!document.querySelector('.welcome [data-warning-task="legacy-inbox"]') && !document.querySelector('.welcome [data-warning-task="legacy-todo"]')`))
  const expectedWarnings=await warningSnapshot('.welcome')
  check('Welcome excludes archived warnings and shows the Blocked start reason',expectedWarnings.length===3 && !expectedWarnings.some(item=>item.id==='archived-overdue') && expectedWarnings.find(item=>item.id==='deadline-overdue')?.disabled && expectedWarnings.find(item=>item.id==='deadline-overdue')?.problem.includes('承認待ち'))
  const beforeBlocked=read()
  const blockedStart=await raw('session:start',{taskId:'deadline-overdue',minutes:30})
  check('Blocked start is rejected by public IPC without changing saved data',blockedStart.ok===false && JSON.stringify(read())===JSON.stringify(beforeBlocked))
  await screenshot('01-welcome-warnings')
  await click('.welcome [data-warning-task="deadline-overdue"] [data-warning-organize]')
  await waitingDetail('Welcome warning')
  await screenshot('01b-welcome-waiting-detail')
  await click('.detail-close')
  for (const surface of [{key:'1',code:'Digit1',selector:'.today',name:'Today'}, {key:'8',code:'Digit8',selector:'.week',name:'Week'}]) {
    await key(surface.key,surface.code,2)
    await until(()=>page.evaluate(`Boolean(document.querySelector(${JSON.stringify(surface.selector+' .task-warnings')}))`),surface.name+' warnings')
    const current=await warningSnapshot(surface.selector)
    check(surface.name+' shows the same warnings, Blocked guard and archive exclusion',JSON.stringify(current)===JSON.stringify(expectedWarnings),current)
    await screenshot('01-'+surface.name.toLowerCase()+'-warnings')
    await click(`${surface.selector} [data-warning-task="deadline-overdue"] [data-warning-organize]`)
    await waitingDetail(surface.name+' warning')
    await click('.detail-close')
  }
  await board()
  check('Board has the same three warnings', await page.evaluate('document.querySelectorAll(".board > .task-warnings [data-warning-task]").length===3'))
  check('Board shows the same warnings, Blocked guard and archive exclusion',JSON.stringify(await warningSnapshot('.board'))===JSON.stringify(expectedWarnings))
  check('ExternalWaiting is preserved alongside the warning panel',await page.evaluate(`Boolean(document.querySelector('[data-external-task-id="deadline-overdue"]'))`))
  await click('.board-head .segmented-item:nth-child(2)')
  await click('[data-warning-task="deadline-overdue"] .task-warning-title')
  check('Warning title opens detail from the list view too',await page.evaluate(`Boolean(document.querySelector('.board-cols')) && document.querySelector('.detail-title').value==='deadline-overdue'`))
  await waitingDetail('Board warning')
  await fill('input[aria-label="Blocked の理由"]','次の確認日を調整している')
  await click('.detail-title')
  await until(()=>read().tasks.find(item=>item.id==='deadline-overdue').blockReason==='次の確認日を調整している','waiting reason saved from UI')
  check('Warning detail lets the user save waiting information',read().tasks.find(item=>item.id==='deadline-overdue').blocked===true)
  await click('.detail-close')
  await key('4','Digit4',2)
  await until(() => page.evaluate('Boolean(document.querySelector(".settings"))'), 'settings view')
  await page.evaluate(`(() => { const row=[...document.querySelectorAll('.set-row')].find(item=>item.querySelector('.set-row-label')?.textContent==='Todo の警告までの日数'); if(!row) throw Error('Warning threshold setting missing'); row.querySelector('input').setAttribute('data-aging-threshold','true'); })()`)
  await fill('[data-aging-threshold]','10')
  await until(()=>read().settings.stallWarningDays===10,'warning threshold saved from UI')
  await board()
  check('User threshold changes Aging warnings while deadline warnings remain',await page.evaluate(`!document.querySelector('[data-warning-task="aging-warning"]') && Boolean(document.querySelector('[data-warning-task="deadline-overdue"]'))`))
  await call('settings:update',{patch:{stallWarningDays:3}})
  await until(() => page.evaluate(`Boolean(document.querySelector('[data-warning-task="aging-warning"]'))`), 'Aging warning restored after threshold reset')
  await call('task:move',{id:'legacy-inbox',status:'todo',index:0})
  const committed=read().tasks.find(item=>item.id==='legacy-inbox')
  check('Old Inbox becomes newly committed Todo without an immediate warning', committed.committedAt >= now && await page.evaluate(`!document.querySelector('[data-warning-task="legacy-inbox"]')`))
  await detail('legacy-inbox')
  check('Unentered remaining effort and safety buffer stay blank; Slack is unknown', await page.evaluate(`document.querySelector(${JSON.stringify(effortInput)}).value==='' && document.querySelector(${JSON.stringify(bufferInput)}).value==='' && document.querySelector('.detail .task-risk-summary').innerText.includes('Slack: 不明')`))
  await fill(effortInput,'90')
  await click('.detail-title')
  await until(()=>read().tasks.find(item=>item.id==='legacy-inbox').remainingEffortMinutes===90,'effort saved from UI')
  await fill(bufferInput,'0')
  await click('.detail-title')
  await until(()=>read().tasks.find(item=>item.id==='legacy-inbox').safetyBufferMinutes===0,'explicit zero buffer saved from UI')
  await call('task:update',{id:'legacy-inbox',patch:{due:calendar(now + DAY)}})
  await until(() => page.evaluate(`!document.querySelector('.detail .task-risk-summary').innerText.includes('Slack: 不明')`), 'Slack visible')
  await page.evaluate(`(() => { const select=document.querySelector('select[aria-label="残作業の見積（任意）の単位"]'); select.value='60'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  await until(() => page.evaluate(`document.querySelector(${JSON.stringify(effortInput)}).value==='1.5'`), 'hours displayed')
  await fill(effortInput,'2')
  await click('.detail-title')
  await until(()=>read().tasks.find(item=>item.id==='legacy-inbox').remainingEffortMinutes===120,'two hours saved as minutes')
  await fill(effortInput,'-2')
  await click('.detail-title')
  check('Negative UI input reports an error and keeps the saved effort',read().tasks.find(item=>item.id==='legacy-inbox').remainingEffortMinutes===120 && await page.evaluate(`Boolean(document.querySelector('.detail [role="alert"]'))`))
  await fill(effortInput,'2')
  await click('.detail-title')
  await until(() => page.evaluate(`!document.querySelector('.detail [role="alert"]')`), 'corrected input clears error')
  await fill(bufferInput,'')
  await click('.detail-title')
  await until(()=>read().tasks.find(item=>item.id==='legacy-inbox').safetyBufferMinutes===null,'cleared buffer saved as unknown')
  check('Clearing optional buffer makes Slack unknown',await page.evaluate(`document.querySelector('.detail .task-risk-summary').innerText.includes('Slack: 不明')`))
  await fill(bufferInput,'0')
  await click('.detail-title')
  await until(()=>read().tasks.find(item=>item.id==='legacy-inbox').safetyBufferMinutes===0,'explicit zero buffer restored')
  const faultPath=path.join(DATA,'data.json.tmp')
  assert.equal(fs.existsSync(faultPath),false,'fault fixture must not replace an existing path')
  const beforeFailure=read().tasks.find(item=>item.id==='legacy-inbox')
  fs.mkdirSync(faultPath)
  try {
    await fill(effortInput,'3')
    await click('.detail-title')
    await until(() => page.evaluate(`Boolean(document.querySelector('.detail [role="alert"]'))`), 'actual save failure shown')
    const current=await call('state:get')
    check('Actual save failure restores task state and keeps disk data unchanged',JSON.stringify(current.tasks.find(item=>item.id==='legacy-inbox'))===JSON.stringify(beforeFailure) && JSON.stringify(read().tasks.find(item=>item.id==='legacy-inbox'))===JSON.stringify(beforeFailure))
    await page.evaluate(`document.querySelector('.detail [role="alert"]').scrollIntoView({block:'center'})`)
    await screenshot('02b-save-failure-visible')
  } finally { fs.rmdirSync(faultPath) }
  await fill(effortInput,'2')
  await click('.detail-title')
  await until(() => page.evaluate(`!document.querySelector('.detail [role="alert"]')`), 'save failure corrected')
  const before=read().tasks.find(item=>item.id==='legacy-inbox')
  for (const patch of [{remainingEffortMinutes:-1},{safetyBufferMinutes:'0'},{remainingEffortMinute:1},{committedAt:0}]) {
    const result=await raw('task:update',{id:'legacy-inbox',patch})
    check('Strict IPC rejects invalid planning input '+JSON.stringify(patch),result.ok===false)
  }
  check('Invalid IPC does not change saved values',JSON.stringify(read().tasks.find(item=>item.id==='legacy-inbox'))===JSON.stringify(before))
  await page.evaluate(`document.querySelector('.detail .task-risk-summary').scrollIntoView({block:'center'})`)
  await screenshot('02-board-effort-slack')
  await click('.detail-close')
  const agingAnchor=read().tasks.find(item=>item.id==='aging-warning').committedAt
  await call('task:update',{id:'aging-warning',patch:{notes:'次の再開の手がかり'}})
  check('Notes edit preserves the commitment and Aging warning',read().tasks.find(item=>item.id==='aging-warning').committedAt===agingAnchor && await page.evaluate(`Boolean(document.querySelector('[data-warning-task="aging-warning"]'))`))
  await call('task:update',{id:'aging-warning',patch:{progress:10}})
  await until(() => page.evaluate(`!document.querySelector('[data-warning-task="aging-warning"]')`), 'progress clears Aging warning')
  check('Actual progress records its anchor',read().tasks.find(item=>item.id==='aging-warning').lastProgressAt>=now)
  await click('[data-warning-task="negative-slack"] button.btn-ghost')
  await until(()=>read().tasks.find(item=>item.id==='negative-slack').status==='inbox','warning action Inbox persisted')
  check('Inbox action removes that warning',await page.evaluate(`!document.querySelector('[data-warning-task="negative-slack"]')`))
  await detail('legacy-inbox')
  await click('.detail-foot .btn-primary')
  await until(()=>read().sessions.length===1,'chosen session saved')
  check('User can start a chosen task even when another is Overdue',read().sessions[0].segments[0].taskId==='legacy-inbox')
  await wait(1200)
  await call('session:end')
  const sessionId=read().sessions[0].id
  await call('session:review',{sessionId,changes:[{taskId:'legacy-inbox',from:0,to:20,markedDone:false}]})
  check('Working and review do not decrement the remaining estimate',read().tasks.find(item=>item.id==='legacy-inbox').remainingEffortMinutes===120)
  await stop()
  await launch('restart')
  const restored=await call('state:get')
  const saved=restored.tasks.find(item=>item.id==='legacy-inbox')
  check('Restart restores effort, explicit buffer, progress and commitment',saved.remainingEffortMinutes===120 && saved.safetyBufferMinutes===0 && saved.progress===20 && saved.committedAt===committed.committedAt && saved.lastProgressAt>=now)
  check('Restart preserves other legacy unknown fields',!Object.hasOwn(restored.tasks.find(item=>item.id==='legacy-todo'),'committedAt'))
  await board()
  await screenshot('03-board-after-restart')
  check('Renderer has no console errors or uncaught exceptions',errors.length===0,errors)
  exitCode=0
} catch(error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN,'failure.txt'),error.stack || String(error))
  if(page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN,'failure-dom.txt'),await page.evaluate('document.body.innerText')) } catch {} }
} finally {
  try { await stop() } catch(error) { console.error(error); exitCode=1 }
  fs.writeFileSync(path.join(RUN,'result.json'),JSON.stringify({exitCode,checks,errors},null,2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}

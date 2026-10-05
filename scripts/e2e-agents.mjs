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
const RUN = fs.mkdtempSync(path.join(OUTPUT, 'agents-run-'))
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
  if (!child || child.exitCode !== null) { page?.close(); return }
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try { await page?.evaluate('void window.whitebox.call("app:quit")') } catch { child.kill() }
  page?.close()
  if (!await Promise.race([exited.then(() => true), wait(15000).then(() => false)])) {
    child.kill('SIGKILL')
    await Promise.race([exited, wait(5000).then(() => { throw new Error('Owned Electron did not exit') })])
  }
}

async function screenshot(name) {
  await page.send('Page.bringToFront')
  await wait(350)
  const state = await page.evaluate('({ visibility: document.visibilityState, hidden: document.hidden, focused: document.hasFocus(), width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio })')
  fs.writeFileSync(path.join(RUN, `${name}-state.json`), JSON.stringify(state, null, 2))
  console.log(`Screenshot state: ${name} ${JSON.stringify(state)}`)
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 30000)
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
  await page.evaluate(`document.querySelectorAll(${JSON.stringify(scope + ' button')})[${selector}].setAttribute('data-agents-e2e-click','true')`)
  await click('[data-agents-e2e-click="true"]')
  await page.evaluate(`document.querySelector('[data-agents-e2e-click="true"]')?.removeAttribute('data-agents-e2e-click')`)
}

let mcp
let mcpSequence = 0
const mcpRequests = new Map()
async function startMcp(config) {
  const settings = JSON.parse(config).mcpServers['white-box']
  const appRoot = process.env.WHITEBOX_EXE ? path.join(path.dirname(electron), 'resources', 'app') : ROOT
  check('Copied MCP settings point at this application and isolated connection file', settings.args[0] === path.join(appRoot, 'scripts', 'white-box-mcp.mjs') && settings.env.WHITEBOX_AGENT_CONFIG === path.join(DATA, 'agent-connection.json'))
  const log = fs.openSync(path.join(RUN, 'mcp-stderr.log'), 'a')
  mcp = spawn(settings.command, settings.args, { cwd: ROOT, env: { ...process.env, ...settings.env }, stdio: ['pipe', 'pipe', log], windowsHide: true })
  fs.closeSync(log)
  let partial = ''
  mcp.stdout.on('data', (data) => {
    partial += data.toString('utf8')
    const lines = partial.split('\n')
    partial = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      let response
      try { response = JSON.parse(line) } catch { continue }
      const request = mcpRequests.get(response.id)
      if (!request) continue
      clearTimeout(request.timer)
      mcpRequests.delete(response.id)
      request.resolve(response)
    }
  })
  mcp.once('error', (error) => {
    for (const request of mcpRequests.values()) { clearTimeout(request.timer); request.reject(error) }
    mcpRequests.clear()
  })
  mcp.once('exit', () => {
    for (const request of mcpRequests.values()) { clearTimeout(request.timer); request.reject(new Error('MCP child exited')) }
    mcpRequests.clear()
  })
}

function rpc(method, params = {}) {
  const id = ++mcpSequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { mcpRequests.delete(id); reject(new Error(`MCP timeout: ${method}`)) }, 12000)
    mcpRequests.set(id, { resolve, reject, timer })
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
const mcpTool = (name, args) => rpc('tools/call', { name, arguments: args })
function toolData(response) {
  assert.equal(response.result?.isError, undefined, 'MCP tool succeeds')
  assert.ok(response.result?.content?.[0]?.text, 'MCP returns structured data as text')
  return JSON.parse(response.result.content[0].text)
}

async function stopMcp() {
  if (!mcp || mcp.exitCode !== null) return
  const exited = new Promise((resolve) => mcp.once('exit', resolve))
  mcp.stdin.end()
  if (!await Promise.race([exited.then(() => true), wait(3000).then(() => false)])) { mcp.kill(); await exited }
}

const now = Date.now()
const day = new Date(now - 4 * 3600000)
const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
const oldTask = { id: 'original-task', projectId: 'p', parentId: null, title: '既存の仕事', notes: '本人が書いた内容', status: 'todo', progress: 30, priority: 'normal', order: 0, createdAt: now - 1000, updatedAt: now - 1000, doneAt: null, createdInSessionId: null }
const session = (id) => ({ id, startedAt: now - 1200000, endedAt: now - 600000, plannedMs: 600000, state: 'ended', segments: [], pauses: [{ startedAt: now - 1100000, endedAt: now - 1000000, reason: 'manual' }, { startedAt: now - 900000, endedAt: now - 850000, reason: 'excluded' }], events: [], progressChanges: [], note: '本人の実行メモ', expiredNotifiedAt: null, editedAt: null, createdAt: now - 1200000 })
const seed = {
  version: 1,
  projects: [{ id: 'p', name: 'MCP検証プロジェクト', hue: 150, archived: false, order: 0, createdAt: now, updatedAt: now }],
  tasks: [oldTask], sessions: [session('unknown-session'), session('dismiss-session')], dayNotes: { [today]: '本人の日誌' },
  settings: { displayName: '', defaultSessionMinutes: 50, defaultExtendMinutes: 15, extendOptions: [5, 10, 15], shortcuts: { startPause: '', currentWork: '', dashboard: '' }, launchAtLogin: false, autoPauseOnSuspend: true, soundOnExpire: false, dayStartHour: 4, lastWelcomeDate: today, stallWarningDays: 3, onboardedAt: now, enableAgentApi: false },
}
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(seed, null, 2))

async function verify() {
  check('AI integration is disabled by default in the isolated profile', (await call('state:get')).settings.enableAgentApi === false && !fs.existsSync(path.join(DATA, 'agent-connection.json')))
  await key('4', 'Digit4', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".settings"))'), 'settings UI')
  await page.evaluate(`(() => { const row=[...document.querySelectorAll('.set-row')].find(el=>el.querySelector('.set-row-label')?.textContent==='ローカルのAIエージェントからつなぐ'); if(!row) throw Error('Missing AI toggle'); row.querySelector('[role="switch"]').setAttribute('data-agents-toggle','true'); })()`)
  await click('[data-agents-toggle="true"]')
  await until(() => read().settings.enableAgentApi && fs.existsSync(path.join(DATA, 'agent-connection.json')), 'local agent API enabled')
  check('Settings UI enables the local authenticated API', read().settings.enableAgentApi)
  await button('AI連携の接続設定をコピー')
  await until(() => page.evaluate('document.body.innerText.includes("AI連携の接続設定をコピーした")'), 'copy success UI')
  const config = await call('agent:config')
  const clipboard = await page.evaluate(`navigator.clipboard.readText().then(text=>({matches:JSON.stringify(JSON.parse(text))===JSON.stringify(JSON.parse(${JSON.stringify(config)}))})).catch(error=>({matches:false,error:error.message}))`)
  check('Copy settings UI writes the exact connection configuration to clipboard', clipboard.matches, clipboard)
  await screenshot('01-settings-copy')
  await startMcp(config)
  const premature = await rpc('tools/list')
  check('MCP rejects tools before initialization', premature.error?.code === -32000)
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'white-box-e2e', version: '1' } })
  check('Real stdio MCP initializes with embedded task planning instructions', initialized.result.serverInfo.name === 'white-box' && initialized.result.instructions.includes('親を先に') && initialized.result.instructions.includes('本人の確認前'))
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const listed = await rpc('tools/list')
  check('MCP exposes context, task registration and record proposals', isDeepStrictEqual(listed.result.tools.map((tool) => tool.name).sort(), ['white_box_context', 'white_box_propose_record', 'white_box_register_tasks'].sort()))
  const taskTool = listed.result.tools.find((tool) => tool.name === 'white_box_register_tasks')
  check('MCP advertises deadlines in the task registration schema', Object.hasOwn(taskTool.inputSchema.properties.tasks.items.properties, 'due'))
  const prompt = await rpc('prompts/get', { name: 'white-box-task-planning' })
  check('MCP supplies the reusable task planning workflow', prompt.result.messages[0].content.text.includes('音声の書き起こし') && prompt.result.messages[0].content.text.includes('同じrequestId'))
  const goal = await call('goal:create', { goal: '本人の意図を実際のタスクへ結ぶ', reason: 'MCPの通し検証' })
  const context = toolData(await mcpTool('white_box_context', {}))
  check('MCP reads the actual project, goal and execution record', context.projects.some((project) => project.id === 'p') && context.goals.some((item) => item.id === goal.id) && context.sessions.some((item) => item.id === 'unknown-session'))
  const plan = { requestId: 'mcp-hierarchy', tasks: [
    { title: '調査の計画を実行する', notes: '音声から整理した本人の意図', projectId: 'p', goalNodeId: goal.id, priority: 'high', due: '2026-12-31' },
    { title: '保存の挙動を確認する', parentIndex: 0 }, { title: '結果を記録する', parentIndex: 1 },
  ] }
  const created = toolData(await mcpTool('white_box_register_tasks', plan))
  check('MCP registers an Inbox hierarchy with project, goal, deadline and notes', created.length === 3 && created[0].status === 'inbox' && created[0].due === '2026-12-31' && created[0].goalNodeId === goal.id && created[0].notes === plan.tasks[0].notes && created[1].parentId === created[0].id && created[2].parentId === created[1].id && created.every((task) => task.projectId === 'p'))
  const beforeRetry = read()
  const retry = toolData(await mcpTool('white_box_register_tasks', plan))
  check('MCP retry returns the same IDs and leaves storage unchanged', isDeepStrictEqual(retry.map((task) => task.id), created.map((task) => task.id)) && isDeepStrictEqual(read(), beforeRetry))
  const changed = await mcpTool('white_box_register_tasks', { ...plan, tasks: [{ title: '変更された再送' }] })
  check('Changed retry is rejected without any storage mutation', changed.result.isError === true && isDeepStrictEqual(read(), beforeRetry))
  const badPlan = await mcpTool('white_box_register_tasks', { requestId: 'mcp-atomic-failure', tasks: [{ title: '途中まで保存しない' }, { title: '不正日付', due: '2026-02-30' }] })
  check('Invalid deadline rejects the entire MCP batch', badPlan.result.isError === true && isDeepStrictEqual(read(), beforeRetry))
  const beforeProposal = read()
  const proposed = toolData(await mcpTool('white_box_propose_record', { sessionId: 'unknown-session', title: '本人が確認した調査', reason: '本人の実行メモに基づく提案', markDone: true }))
  check('MCP proposal preserves tasks and timing until the user confirms', proposed.status === 'pending' && isDeepStrictEqual(read().tasks, beforeProposal.tasks) && isDeepStrictEqual(read().sessions, beforeProposal.sessions))
  await key('1', 'Digit1', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".task-suggestions"))'), 'record proposal UI')
  await until(() => page.evaluate(`(() => { const r=document.querySelector('.task-suggestion')?.getBoundingClientRect(); return r && r.top>=0 && r.bottom<=innerHeight; })()`), 'proposal visible after switching from scrolled settings')
  await screenshot('02-proposal')
  check('Proposal identifies the exact session and shows its original note', await page.evaluate(`(() => { const el=document.querySelector('.task-suggestion'); return el.querySelector('.task-suggestion-session')?.textContent.includes(new Date(${seed.sessions[0].startedAt}).toLocaleString('ja-JP')) && el.textContent.includes(${JSON.stringify('本人のメモ: ' + seed.sessions[0].note)}); })()`))
  const layout = await page.evaluate(`(() => { const el=document.querySelector('.task-suggestion'); const r=el.getBoundingClientRect(); return {width:r.width,height:r.height,top:r.top,bottom:r.bottom,viewport:innerHeight,text:el.textContent.includes('本人の実行メモ'),actions:[...el.querySelectorAll('button')].map(button=>({width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height}))}; })()`)
  check('Proposal and both confirmation actions are visible with usable dimensions', layout.width >= 300 && layout.height >= 50 && layout.top>=0 && layout.bottom<=layout.viewport && layout.text && layout.actions.length === 2 && layout.actions.every((action) => action.width > 20 && action.height >= 24), layout)
  await button('確認して記録', '.task-suggestions')
  await until(() => read().taskSuggestions.find((item) => item.id === proposed.id)?.status === 'accepted', 'user confirmation persisted')
  const acceptedTask = read().tasks.find((task) => task.title === '本人が確認した調査')
  const acceptedSession = read().sessions.find((item) => item.id === 'unknown-session')
  check('User confirmation creates the unknown task, assigns its record and marks it done', acceptedTask?.status === 'done' && acceptedTask.progress === 100 && acceptedTask.doneAt !== null && acceptedSession.segments[0].taskId === acceptedTask.id && acceptedSession.startedAt === seed.sessions[0].startedAt && acceptedSession.endedAt === seed.sessions[0].endedAt && acceptedSession.segments.length === 1 && acceptedSession.segments[0].startedAt === seed.sessions[0].startedAt && acceptedSession.segments[0].endedAt === seed.sessions[0].endedAt && isDeepStrictEqual(acceptedSession.pauses, seed.sessions[0].pauses) && acceptedSession.note === seed.sessions[0].note)
  const beforeAcceptedRetry = read()
  const acceptedRetry = toolData(await mcpTool('white_box_propose_record', { sessionId: 'unknown-session', title: '本人が確認した調査', reason: '本人の実行メモに基づく提案', markDone: true }))
  check('MCP retry of an accepted proposal preserves the decision and all records', acceptedRetry.id === proposed.id && acceptedRetry.status === 'accepted' && isDeepStrictEqual(read(), beforeAcceptedRetry))
  const beforeDismiss = read()
  const dismiss = toolData(await mcpTool('white_box_propose_record', { sessionId: 'dismiss-session', taskId: 'original-task', reason: '本人が却下する提案', markDone: true }))
  await until(() => page.evaluate('Boolean(document.querySelector(".task-suggestions"))'), 'second proposal UI')
  await button('違う', '.task-suggestions')
  await until(() => read().taskSuggestions.find((item) => item.id === dismiss.id)?.status === 'dismissed', 'dismissal persisted')
  check('User dismissal keeps every task and timing record unchanged', isDeepStrictEqual(read().tasks, beforeDismiss.tasks) && isDeepStrictEqual(read().sessions, beforeDismiss.sessions))
  await key('3', 'Digit3', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".history-days"))'), 'history view')
  if (await page.evaluate('Boolean(document.querySelector(".hday:not(.is-open) .hday-head"))')) {
    await click('.hday:not(.is-open) .hday-head')
  }
  const recordVisible = await until(() => page.evaluate(`(() => { const el=[...document.querySelectorAll('.srow')].find(row=>row.textContent.includes('本人が確認した調査')); if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return r.height>20 && r.top>=0 && r.bottom<=innerHeight; })()`), 'confirmed record shown in the actual session list')
  check('The confirmed task appears in the actual session record UI', recordVisible)
  await screenshot('03-confirmed-record')
  check('Original task content and daily notes remain unchanged', isDeepStrictEqual(read().tasks.find((task) => task.id === 'original-task'), oldTask) && isDeepStrictEqual(read().dayNotes, seed.dayNotes))
}

let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  await verify()
  const persisted = read()
  fs.writeFileSync(path.join(RUN, 'before-restart.json'), JSON.stringify(persisted, null, 2))
  await stopMcp()
  await stop()
  await launch('restart')
  const restarted = await call('state:get')
  check('Restart preserves Inbox tasks and accepted/dismissed record suggestions', isDeepStrictEqual(restarted.tasks, persisted.tasks) && isDeepStrictEqual(restarted.sessions, persisted.sessions) && isDeepStrictEqual(restarted.taskSuggestions, persisted.taskSuggestions))
  await until(() => fs.existsSync(path.join(DATA, 'agent-connection.json')), 'API restarted')
  await startMcp(await call('agent:config'))
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'white-box-e2e', version: '1' } })
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const firstRequest = persisted.agentRequests['mcp-hierarchy']
  const retryTasks = persisted.tasks.filter((task) => firstRequest.taskIds.includes(task.id))
  const originalPlan = JSON.parse(firstRequest.fingerprint)
  const retried = toolData(await mcpTool('white_box_register_tasks', { requestId: 'mcp-hierarchy', tasks: originalPlan }))
  check('Persisted request IDs remain idempotent after app and MCP restart', isDeepStrictEqual(retried.map((task) => task.id), retryTasks.map((task) => task.id)) && isDeepStrictEqual(read().agentRequests, persisted.agentRequests))
  check('Renderer has no console errors or uncaught exceptions', errors.length === 0, errors)
  exitCode = 0
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) { try { await screenshot('failure'); fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {} }
} finally {
  try { await stopMcp(); await stop() } catch (error) { console.error(error); exitCode = 1 }
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, checks, errors }, null, 2))
  console.log(`Evidence: ${RUN}`)
  process.exit(exitCode)
}


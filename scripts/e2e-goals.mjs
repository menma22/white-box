import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUTPUT = path.join(ROOT, '.e2e-goals')
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection is not open')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send('Runtime.enable')
  await send('Log.enable')
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
async function stateData() { const { revision, ...data } = await state(); return data }

async function launch(label) {
  port = await freePort()
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.VITE_DEV_SERVER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(RUN, `${label}-app.log`), 'a')
  const args = ['--hidden', '--open=main', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(RUN, 'profile')}`]
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
  if (!child || child.exitCode !== null) { page?.close(); return }
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try { await page?.evaluate('void window.whitebox.call("app:quit")') } catch { child.kill() }
  page?.close()
  if (!await Promise.race([exited.then(() => true), wait(15000).then(() => false)])) {
    console.log(`Cleanup: terminating owned Electron PID ${child.pid} after quit timeout`)
    child.kill('SIGKILL')
    await Promise.race([exited, wait(5000).then(() => { throw new Error('Owned Electron did not exit after cleanup') })])
  }
}

async function screenshot(name) {
  await wait(350)
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(RUN, `${name}.png`), Buffer.from(shot.data, 'base64'))
}

async function key(key, code, modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}), windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers })
}

async function click(selector) {
  const point = await until(() => page.evaluate(`(async () => { const el = document.querySelector(${JSON.stringify(selector)}); if(!el) return null; el.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=el.getBoundingClientRect(); const point={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && point.x>0 && point.x<innerWidth && point.y>0 && point.y<innerHeight && el.contains(document.elementFromPoint(point.x,point.y)) ? point : null })()`), selector)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await wait(100)
}

async function button(text, scope = 'body') {
  const point = await until(() => page.evaluate(`(async () => { const el = [...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(el => el.textContent.trim() === ${JSON.stringify(text)}); if(!el) return null; el.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=el.getBoundingClientRect(); const point={x:r.x+r.width/2,y:r.y+r.height/2}; return r.width && r.height && point.x>0 && point.x<innerWidth && point.y>0 && point.y<innerHeight && el.contains(document.elementFromPoint(point.x,point.y)) ? point : null })()`), `button ${text}`)
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
const day = new Date(now - 4 * 3600000)
const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
const oldTask = { id: 'old-task', projectId: 'old-project', parentId: null, title: '既存の仕事', notes: '以前のメモ', status: 'todo', progress: 35, priority: 'normal', order: 0, createdAt: now - 1000, updatedAt: now - 1000, doneAt: null, createdInSessionId: null }
const oldSession = { id: 'old-session', startedAt: now - 120000, endedAt: now - 60000, plannedMs: 60000, state: 'ended', segments: [{ id: 'old-segment', taskId: oldTask.id, startedAt: now - 120000, endedAt: now - 60000 }], pauses: [], events: [], progressChanges: [], note: '以前の実行記録', expiredNotifiedAt: null, editedAt: null, createdAt: now - 120000 }
const seed = {
  version: 1,
  projects: [{ id: 'old-project', name: '既存プロジェクト', hue: 150, archived: false, order: 0, createdAt: now, updatedAt: now }],
  tasks: [oldTask], sessions: [oldSession], dayNotes: { [today]: '消えてはいけない日誌' },
  settings: { displayName: '', defaultSessionMinutes: 50, defaultExtendMinutes: 15, extendOptions: [5, 10, 15], shortcuts: { startPause: '', currentWork: '', dashboard: '' }, launchAtLogin: false, autoPauseOnSuspend: true, soundOnExpire: false, dayStartHour: 4, lastWelcomeDate: today, stallWarningDays: 3 },
}
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(seed, null, 2))

async function verifyIpc() {
  const loaded = await state()
  check('Old database gets an empty goal map and retains tasks', loaded.goalMap.heads.length === 0 && JSON.stringify(loaded.tasks[0]) === JSON.stringify(oldTask))
  const a = await call('goal:create', { goal: '検証ヘッドA', reason: '理由A' })
  const b = await call('goal:create', { goal: '検証ヘッドB' })
  const branch = await call('goal:create', { goal: '検証の子', parentId: a.id })
  const leaf = await call('goal:create', { goal: '検証の孫', parentId: branch.id })
  const historyBeforeEdit = (await state()).goalMap.history.length
  await call('goal:update', { id: branch.id, patch: { goal: '編集した子', reason: '編集した理由' } })
  check('Editing content preserves the structural history', (await state()).goalMap.history.length === historyBeforeEdit)
  await call('goal:hide', { id: branch.id, reason: '優先順位を変更した' })
  await call('goal:hide', { id: a.id, reason: '上位も一時停止' })
  let map = (await state()).goalMap
  check('Hide preserves descendants, links, reason and timestamp', map.nodes[branch.id].children[0] === leaf.id && map.nodes[leaf.id].parentId === branch.id && map.nodes[branch.id].hidden && map.nodes[branch.id].hideReason === '優先順位を変更した' && typeof map.nodes[branch.id].hiddenAt === 'number')
  check('History records hidden branch and its reason', map.history.some((h) => h.type === 'hide' && h.nodeId === branch.id && h.parentId === a.id && h.note === '優先順位を変更した'))
  await call('goal:restore', { id: leaf.id })
  map = (await state()).goalMap
  check('Restoring a descendant restores hidden ancestors', !map.nodes[a.id].hidden && !map.nodes[branch.id].hidden && map.activeHeadId === a.id)
  const merged = await call('goal:merge', { ids: [a.id, b.id], goal: '統合したヘッド', reason: '二つを結ぶ' })
  const promoted = await call('goal:merge', { ids: [merged.id], goal: 'さらに上位' })
  map = (await state()).goalMap
  check('Merge and promote preserve complete subtrees', map.nodes[a.id].parentId === merged.id && map.nodes[b.id].parentId === merged.id && map.nodes[merged.id].parentId === promoted.id && map.nodes[branch.id].children.includes(leaf.id) && map.history.some((h) => h.type === 'merge') && map.history.some((h) => h.type === 'promote'))
  const issue = await call('issue:create', { kind: 'question', text: '何を先に調べるか', nodeId: leaf.id })
  await call('issue:update', { id: issue.id, patch: { resolved: true, kind: 'idea', text: '調査方針を改善' } })
  check('Issue edit and resolution are saved', (await state()).goalMap.issues.some((x) => x.id === issue.id && x.resolved && x.kind === 'idea' && x.text === '調査方針を改善'))
  const linked = await call('task:create', { title: '目標につながる既存タスク', status: 'todo', due: '2026-12-31', goalNodeId: leaf.id })
  await call('task:update', { id: linked.id, patch: { status: 'done', priority: 'high' } })
  check('Linked task uses the shared task collection', (await state()).tasks.some((t) => t.id === linked.id && t.goalNodeId === leaf.id && t.due === '2026-12-31' && t.status === 'done' && t.priority === 'high'))

  const invalid = [
    ['goal:create', { goal: '不正な親', parentId: 'missing' }],
    ['goal:update', { id: leaf.id, patch: { goal: '部分変更禁止', reason: 123 } }],
    ['goal:merge', { ids: [promoted.id, 'missing'], goal: '部分成功は禁止' }],
    ['goal:merge', { ids: [branch.id], goal: '子の統合は禁止' }],
    ['goal:hide', { id: 'missing', reason: '' }],
    ['issue:create', { kind: 'unknown', text: '不正種別' }],
    ['issue:create', { kind: 'idea', text: '参照切れ', nodeId: 'missing' }],
    ['task:update', { id: linked.id, patch: { title: '部分変更禁止', due: '2026-02-30' } }],
    ['task:update', { id: linked.id, patch: { goalNodeId: 'missing' } }],
    ['goal:ui', { patch: { view: 'unknown' } }],
  ]
  for (const [name, args] of invalid) {
    const before = JSON.stringify(read())
    const memoryBefore = JSON.stringify(await stateData())
    const result = await raw(name, args)
    check(`Invalid ${name} is rejected atomically`, !result.ok && JSON.stringify(read()) === before && JSON.stringify(await stateData()) === memoryBefore, args)
  }
  return { leaf, linked }
}

async function verifyImport() {
  const legacy = {
    version: 1, seq: 3, taskSeq: 3, issueSeq: 2, historySeq: 3,
    nodes: {
      n1: { id: 'n1', goal: '移行ヘッド', reason: '元の理由', parentId: null, children: ['n2'], hidden: false, hiddenAt: null, hideReason: '' },
      n2: { id: 'n2', goal: '移行した隠れた枝', reason: '枝の理由', parentId: 'n1', children: [], hidden: true, hiddenAt: now - 500, hideReason: '保留する根拠' },
    },
    heads: ['n1'], activeHeadId: 'n1',
    tasks: [
      { id: 't1', title: '移行する未完了', priority: 'high', due: '2026-10-01', done: false, createdAt: now - 900 },
      { id: 't2', title: '移行する完了済み', priority: 'mid', due: '', done: true, createdAt: now - 800 },
    ],
    issues: [{ id: 'i1', kind: 'problem', text: '移行した問題', nodeId: 'n2', resolved: true, createdAt: now - 700 }],
    history: [
      { id: 'h1', at: now - 600, type: 'create-head', nodeId: 'n1', parentId: null, note: '', withIds: [] },
      { id: 'h2', at: now - 500, type: 'hide', nodeId: 'n2', parentId: 'n1', note: '保留する根拠', withIds: [] },
    ],
    ui: { view: 'history', headsOpen: false, doneOpen: true, resolvedOpen: true, showHidden: true },
  }
  const before = read()
  await key('5', 'Digit5', 2)
  await click('[aria-label="その他の操作"]')
  await button('道標のデータを取り込む')
  await fill('.gm-import-json', JSON.stringify(legacy))
  await button('追加して取り込む')
  await until(() => page.evaluate('Boolean(document.querySelector("[role=status]"))'), 'UI import completed')
  await screenshot('00-import')
  await button('閉じる', '[role="dialog"]')
  await click('[aria-label="その他の操作"]')
  const imported = read()
  const nodes = Object.values(imported.goalMap.nodes)
  const head = nodes.find((n) => n.goal === '移行ヘッド')
  const branch = nodes.find((n) => n.goal === '移行した隠れた枝')
  check('Import preserves source node content and hierarchy', head.reason === '元の理由' && head.children.includes(branch.id) && branch.parentId === head.id && branch.reason === '枝の理由' && branch.hidden && branch.hiddenAt === now - 500 && branch.hideReason === '保留する根拠')
  check('Import remaps issue and history references', imported.goalMap.issues.some((i) => i.text === '移行した問題' && i.nodeId === branch.id && i.resolved) && imported.goalMap.history.some((h) => h.type === 'hide' && h.nodeId === branch.id && h.parentId === head.id && h.note === '保留する根拠' && h.at === now - 500))
  check('Import keeps task completion, priority, due and creation time', imported.tasks.some((t) => t.title === '移行する未完了' && t.priority === 'high' && t.due === '2026-10-01' && t.createdAt === now - 900) && imported.tasks.some((t) => t.title === '移行する完了済み' && t.status === 'done' && t.priority === 'normal' && t.createdAt === now - 800))
  check('Import retains all existing White Box records', before.tasks.every((task) => imported.tasks.some((t) => JSON.stringify(t) === JSON.stringify(task))) && JSON.stringify(imported.projects) === JSON.stringify(seed.projects) && JSON.stringify(imported.sessions) === JSON.stringify(seed.sessions) && JSON.stringify(imported.dayNotes) === JSON.stringify(seed.dayNotes))
  check('Import retains disclosure preferences and opens the map', JSON.stringify(imported.goalMap.ui) === JSON.stringify({ ...legacy.ui, view: 'map' }) && imported.goalMap.activeHeadId === head.id)
  const duplicateBefore = JSON.stringify(imported)
  const duplicate = await raw('goal:import', { data: legacy })
  check('Duplicate import does not duplicate records', !duplicate.ok && JSON.stringify(read()) === duplicateBefore)
  const broken = structuredClone(legacy)
  broken.nodes.n1.children = ['missing']
  const rejected = await raw('goal:import', { data: broken })
  check('Broken import leaves the database unchanged', !rejected.ok && JSON.stringify(read()) === duplicateBefore)
}

async function verifyUi() {
  await call('goal:ui', { patch: { view: 'map', headsOpen: true, showHidden: false } })
  await key('5', 'Digit5', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".gm-root"))'), 'goal map tab')
  check('Ctrl+5 opens the goal map', true)
  await button('目標を追加')
  await fill('[aria-label="新しい目標"]', '画面で作る最上位目標')
  await fill('[aria-label="新しい目標の理由"]', '日々の実行と目標をつなげる')
  await button('作成する')
  const head = await until(() => Object.values(read().goalMap.nodes).find((n) => n.goal === '画面で作る最上位目標'), 'UI head persisted')
  await button('＋ 子目標', '.gm-detail')
  await fill('[aria-label="新しい目標"]', '画面で作る子目標')
  await button('作成する')
  const node = await until(() => Object.values(read().goalMap.nodes).find((n) => n.goal === '画面で作る子目標'), 'UI child persisted')
  check('UI creates a head and a linked child', node.parentId === head.id && read().goalMap.nodes[head.id].children.includes(node.id))
  const historyCount = read().goalMap.history.length
  await fill('[aria-label="目標"]', '画面で編集した子目標')
  await fill('[aria-label="この目標を目指す理由"]', '実画面から編集した理由')
  await until(() => read().goalMap.nodes[node.id].reason === '実画面から編集した理由', 'UI node edit persisted')
  check('UI goal editing autosaves without structural history', read().goalMap.nodes[node.id].goal === '画面で編集した子目標' && read().goalMap.history.length === historyCount)
  await click('.gm-detail-section:has(.gm-issues) > summary')
  await select('[aria-label="追加する問題の種別"]', 'question')
  await fill('[aria-label="新しい問題・問い・改善"]', '画面で作る目標への問い')
  await key('Enter', 'Enter')
  const issue = await until(() => read().goalMap.issues.find((i) => i.text === '画面で作る目標への問い'), 'UI issue persisted')
  check('UI issue is linked to the selected goal', issue.nodeId === node.id && issue.kind === 'question')
  await fill('[aria-label="問題・問い・改善の本文"]', '画面で編集した問い')
  await select('[aria-label="問題の種別"]', 'idea')
  await click('.gm-issue-row input[type="checkbox"]')
  await until(() => read().goalMap.issues.find((i) => i.id === issue.id)?.resolved, 'UI issue resolved')
  check('UI edits and resolves the same issue', read().goalMap.issues.some((i) => i.id === issue.id && i.text === '画面で編集した問い' && i.kind === 'idea' && i.resolved))
  await click('.gm-issue-row input[type="checkbox"]')
  await until(() => !read().goalMap.issues.find((i) => i.id === issue.id)?.resolved, 'UI issue reopened')
  await click('.gm-detail-section:has(.gm-linked-tasks) > summary')
  await fill('[aria-label="この目標に追加するタスク"]', '画面で作る目標タスク')
  await key('Enter', 'Enter')
  const linked = await until(() => read().tasks.find((t) => t.title === '画面で作る目標タスク'), 'UI linked task persisted')
  check('UI creates a shared task linked to the goal', linked.goalNodeId === node.id)
  await screenshot('01-goal-map-detail')
  await click('.gm-linked-task')
  await until(() => page.evaluate('document.querySelector(".detail-title")?.value === "画面で作る目標タスク"'), 'linked task opens shared detail')
  check('Goal task link opens the common task detail', await page.evaluate('Boolean(document.querySelector(".board .gm-task-view"))'))
  await button('このタスクで開始', '.detail')
  const running = await until(async () => { const current = await state(); return current.live?.activeTaskId === linked.id ? current : null }, 'goal task timer starts')
  await wait(300)
  await call('session:end')
  await call('session:skipReview')
  const session = read().sessions.find((s) => s.id === running.live.sessionId)
  check('Goal task starts real timing and saves its session', session?.state === 'ended' && session.endedAt > session.startedAt && session.segments.every((s) => s.taskId === linked.id && s.endedAt !== null) && read().tasks.find((t) => t.id === linked.id)?.goalNodeId === node.id)
  await page.send('Page.bringToFront')
  await click('.detail-close')
  await click(`.gm-task-row[data-task-id="${linked.id}"] .gm-task-goal`)
  await until(() => page.evaluate(`Boolean(document.querySelector('[data-node-id="${node.id}"].gm-node-selected'))`), 'task link returns to its goal')

  await click('.gm-detail-actions .gm-more > summary')
  await button('枝を隠す')
  await fill('[aria-label="隠す理由"]', '別の道筋を先に試すため')
  await button('隠す', '.gm-dialog')
  await until(() => read().goalMap.nodes[node.id].hidden, 'UI hide persisted')
  check('Hidden branch disappears from the visible map', await page.evaluate(`!document.querySelector('[data-node-id="${node.id}"]')`))
  await key('6', 'Digit6', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".gm-issues:not(.gm-issues-compact)"))'), 'independent issues page')
  check('Ctrl+6 opens the independent issues page', !await page.evaluate('Boolean(document.querySelector(".gm-canvas"))'))
  await screenshot('02-issues')
  await click(`.gm-node-link[title="画面で編集した子目標"]`)
  await until(() => page.evaluate(`Boolean(document.querySelector('[data-node-id="${node.id}"].gm-node-hidden'))`), 'issue jump shows hidden branch')
  check('Issue jump exposes the hidden branch without restoring it', read().goalMap.ui.showHidden && read().goalMap.nodes[node.id].hidden && await page.evaluate('document.querySelector(".gm-hidden-note").textContent.includes("別の道筋を先に試すため")'))
  await screenshot('03-hidden-branch')
  await button('表示に戻す')
  await until(() => !read().goalMap.nodes[node.id].hidden, 'UI restore persisted')
  check('UI restore preserves the reason in history', read().goalMap.history.some((h) => h.nodeId === node.id && h.note === '別の道筋を先に試すため'))

  await button('閉じる', '.gm-detail')
  await button('全体を表示')
  const beforeZoom = await page.evaluate('document.querySelector(".gm-scene").style.transform')
  const rect = await page.evaluate('(() => {const r=document.querySelector(".gm-canvas").getBoundingClientRect();return {x:r.x+40,y:r.y+40}})()')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...rect, deltaX: 0, deltaY: -120 })
  await until(() => page.evaluate(`document.querySelector('.gm-scene').style.transform !== ${JSON.stringify(beforeZoom)}`), 'wheel zoom')
  const beforePan = await page.evaluate('document.querySelector(".gm-scene").style.transform')
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + 65, y: rect.y + 35, button: 'left', buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 65, y: rect.y + 35, button: 'left', clickCount: 1 })
  check('Mouse drag pans the map', beforePan !== await page.evaluate('document.querySelector(".gm-scene").style.transform'))
  await button('全体を表示')

  await button('目標を統合')
  await click('.gm-head[title="画面で作る最上位目標"]')
  await click('.gm-head[title="移行ヘッド"]')
  await button('選んだ目標を統合')
  await fill('[aria-label="新しい目標"]', '画面で統合した最上位目標')
  await button('作成する')
  const merged = await until(() => Object.values(read().goalMap.nodes).find((n) => n.goal === '画面で統合した最上位目標'), 'UI merge')
  check('UI merge links both selected heads', merged.children.length === 2 && read().goalMap.nodes[head.id].parentId === merged.id)
  await button('閉じる', '.gm-detail')
  await button('全体を表示')
  await screenshot('04-merged-map')
  async function tooltip() {
    const point = await page.evaluate(`(() => { const r=document.querySelector('[data-node-id="${merged.id}"] .gm-node-body').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    return until(() => page.evaluate('(() => {const tip=document.querySelector(".gm-tooltip");if(!tip)return null;const r=tip.getBoundingClientRect();return {text:tip.textContent,font:getComputedStyle(tip).fontSize,width:r.width,height:r.height}})()'), 'node tooltip')
  }
  await click('[title="100%に戻す"]')
  const originalTip = await tooltip()
  for (let i = 0; i < 6; i++) await click('[title="縮小"]')
  const smallTip = await tooltip()
  check('Tooltip remains full size and preserves its content when zoomed out', smallTip.text === originalTip.text && smallTip.text.includes(merged.goal) && smallTip.font === originalTip.font && Math.abs(smallTip.width - originalTip.width) < 1 && Math.abs(smallTip.height - originalTip.height) < 1)
  await screenshot('10-tooltip-zoomed-out')
  await button('全体を表示')

  await key('2', 'Digit2', 2)
  await until(() => page.evaluate('Boolean(document.querySelector(".board"))'), 'return to board')
  check('Returning to the board does not reopen a closed task detail', !await page.evaluate('Boolean(document.querySelector(".detail"))'))
  await button('一覧', '.board-head')
  await fill('[aria-label="新しいタスク"]', '画面で追加する共通タスク')
  await key('Enter', 'Enter')
  const task = await until(() => read().tasks.find((t) => t.title === '画面で追加する共通タスク'), 'UI task persisted')
  const row = `.gm-task-row[data-task-id="${task.id}"]`
  await fill(`${row} [aria-label="タスク名"]`, '編集した共通タスク')
  await select(`${row} select`, 'high')
  await page.evaluate(`(() => {const input=document.querySelector(${JSON.stringify(row + ' input[type=date]')}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-12-25');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await until(() => read().tasks.find((t) => t.id === task.id)?.due === '2026-12-25', 'UI due saved')
  await button('詳細', row)
  await until(() => page.evaluate('document.querySelector(".detail-title")?.value === "編集した共通タスク"'), 'shared detail opened')
  await fill(`${row} [aria-label="タスク名"]`, '詳細と同期した共通タスク')
  await until(() => page.evaluate('document.querySelector(".detail-title")?.value === "詳細と同期した共通タスク"'), 'open detail synchronizes title')
  await click('.detail-title')
  await click('.detail-close')
  check('Open task detail synchronizes list edits and does not overwrite on blur', read().tasks.find((t) => t.id === task.id)?.title === '詳細と同期した共通タスク')
  await click(`${row} input[type="checkbox"]`)
  await until(() => read().tasks.find((t) => t.id === task.id)?.status === 'done', 'UI completed task')
  check('UI updates shared task title, priority, due and status', read().tasks.some((t) => t.id === task.id && t.title === '詳細と同期した共通タスク' && t.priority === 'high' && t.due === '2026-12-25' && t.status === 'done'))
  await screenshot('05-tasks')
  await button('ボード', '.board-head')
  await until(() => page.evaluate('Boolean(document.querySelector(".board"))'), 'board view')
  check('Board displays the exact task created in goals', await page.evaluate(`Boolean([...document.querySelectorAll('[data-card]')].find(el=>el.textContent.includes('詳細と同期した共通タスク')))`))
  await screenshot('06-board-shared-tasks')
  await key('5', 'Digit5', 2)
  await button('構造の履歴', '.gm-map-toolbar')
  check('History UI displays the hidden reason', await page.evaluate('document.querySelector("[aria-label=構造の履歴]").textContent.includes("別の道筋を先に試すため")'))
  await screenshot('07-history')
  await button('見る', '.gm-history-row:first-of-type')
  await until(() => page.evaluate(`Boolean(document.querySelector('[data-node-id="${merged.id}"].gm-node-selected'))`), 'history link opens its node')
  check('Structural history opens the recorded goal on the map', read().goalMap.ui.view === 'map')
  await button('構造の履歴', '.gm-map-toolbar')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 940, height: 620, deviceScaleFactor: 1, mobile: false })
  await button('マップに戻る', '.gm-map-toolbar')
  await button('全体を表示')
  await click(`[data-node-id="${merged.id}"] .gm-node-body`)
  await screenshot('08-minimum-map-detail')
  const minimum = await page.evaluate('({width:innerWidth,height:innerHeight,canvas:document.querySelector(".gm-canvas").getBoundingClientRect().height,detail:document.querySelector(".gm-detail").getBoundingClientRect().height,overflow:document.querySelector(".gm-root").scrollWidth-document.querySelector(".gm-root").clientWidth})')
  check('940x620 viewport retains visible map and scrollable detail', minimum.width === 940 && minimum.height === 620 && minimum.canvas >= 100 && minimum.detail >= 100 && minimum.overflow <= 1, minimum)
  await key('2', 'Digit2', 2)
  await button('一覧', '.board-head')
  await screenshot('09-minimum-tasks')
  await page.send('Emulation.clearDeviceMetricsOverride')

  const sessionsBeforeDelete = read().sessions
  const disposable = await call('task:create', { title: '削除検証用の親タスク', status: 'todo' })
  const disposableChild = await call('task:create', { title: '削除検証用の子タスク', parentId: disposable.id, status: 'todo' })
  const disposableRow = `.gm-task-row[data-task-id="${disposable.id}"]`
  await button('削除', disposableRow)
  await button('やめる', '[role="dialog"]')
  check('Cancelling task deletion preserves parent and child', read().tasks.some((t) => t.id === disposable.id) && read().tasks.some((t) => t.id === disposableChild.id))
  await button('削除', disposableRow)
  await screenshot('11-task-delete-confirmation')
  await button('削除する', '[role="dialog"]')
  await until(() => !read().tasks.some((t) => t.id === disposable.id), 'task deletion committed')
  check('Confirmed task deletion removes descendants and retains timing records', !read().tasks.some((t) => t.id === disposableChild.id) && isDeepStrictEqual(read().sessions, sessionsBeforeDelete))
  await key('6', 'Digit6', 2)
  await fill('[aria-label="新しい問題・問い・改善"]', '削除検証用の問題')
  await key('Enter', 'Enter')
  const disposableIssue = await until(() => read().goalMap.issues.find((i) => i.text === '削除検証用の問題'), 'disposable issue created')
  const issueRow = '.gm-issue-row:has(input[aria-label="削除検証用の問題を解決する"])'
  await button('削除', issueRow)
  await button('キャンセル', '[role="dialog"]')
  check('Cancelling issue deletion preserves the issue', read().goalMap.issues.some((i) => i.id === disposableIssue.id))
  await button('削除', issueRow)
  await button('削除する', '[role="dialog"]')
  await until(() => !read().goalMap.issues.some((i) => i.id === disposableIssue.id), 'issue deletion committed')
  check('Confirmed issue deletion removes only the selected issue', read().goalMap.issues.some((i) => i.id === issue.id) && isDeepStrictEqual(read().sessions, sessionsBeforeDelete))
}

let exitCode = 1
try {
  console.log(`Evidence: ${RUN}`)
  await launch('first')
  await verifyIpc()
  await verifyImport()
  await verifyUi()
  const persisted = read()
  fs.writeFileSync(path.join(RUN, 'before-restart.json'), JSON.stringify(persisted, null, 2))
  await stop()
  await launch('restart')
  const restarted = await state()
  fs.writeFileSync(path.join(RUN, 'after-restart.json'), JSON.stringify(restarted, null, 2))
  check('Restart retains complete goal map, shared tasks and timing records', isDeepStrictEqual(restarted.goalMap, persisted.goalMap) && isDeepStrictEqual(restarted.tasks, persisted.tasks) && isDeepStrictEqual(restarted.sessions, persisted.sessions))
  check('Renderer has no console errors or uncaught exceptions', errors.length === 0, errors)
  exitCode = 0
} catch (error) {
  console.error(error)
  fs.writeFileSync(path.join(RUN, 'failure.txt'), error.stack || String(error))
  if (page) {
    try { await screenshot('failure'); fs.writeFileSync(path.join(RUN, 'failure-dom.txt'), await page.evaluate('document.body.innerText')) } catch {}
  }
} finally {
  try { await stop() } catch (error) { console.error(error); exitCode = 1 }
  fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify({ exitCode, checks, errors }, null, 2))
  console.log(`Evidence: ${RUN}`)
  process.exitCode = exitCode
}

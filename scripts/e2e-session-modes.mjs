import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { emptyGoalMap } from '@white-box/core/goal-map'
import { dayKey } from '@white-box/core/engine'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
fs.mkdirSync(path.join(ROOT, '.e2e'), { recursive: true })
const DATA = fs.mkdtempSync(path.join(ROOT, '.e2e', 'session-modes-'))
const SHOTS = path.join(DATA, 'shots')
fs.mkdirSync(SHOTS)
const now = Date.now()
const seed = {
  version: 1, projects: [], tasks: [], sessions: [], dayNotes: {}, goalMap: emptyGoalMap(),
  settings: {
    displayName: '', defaultSessionMinutes: 25, defaultExtendMinutes: 5, extendOptions: [5, 10, 15],
    shortcuts: { startPause: '', currentWork: '', dashboard: '' }, launchAtLogin: false,
    autoPauseOnSuspend: true, soundOnExpire: false, dayStartHour: 4,
    lastWelcomeDate: dayKey(now, 4), stallWarningDays: 3, showSessionCard: true, onboardedAt: now,
  },
}
const file = path.join(DATA, 'data.json')
fs.writeFileSync(file, JSON.stringify(seed))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const errors = []
let child
let main
const clients = new Set()
let port
const packaged = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : null
const electron = packaged || createRequire(import.meta.url)('electron')
const expected = pathToFileURL(path.join(packaged ? path.join(path.dirname(packaged), 'resources', 'app') : ROOT, 'dist', 'index.html')).href

function check(name, condition, details) {
  if (!condition) throw new Error(`${name}: ${JSON.stringify(details)}`)
  console.log(`PASS ${name}`)
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let sequence = 0
    socket.addEventListener('error', reject)
    socket.addEventListener('close', () => {
      for (const callback of pending.values()) { clearTimeout(callback.timer); callback.reject(new Error('CDP接続が閉じた')) }
      pending.clear()
    })
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      const callback = pending.get(message.id)
      if (!callback) return
      pending.delete(message.id)
      clearTimeout(callback.timer)
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
      else callback.resolve(message.result)
    })
    socket.addEventListener('open', () => {
      const client = {
        close: () => socket.close(),
        send: (method, params = {}) => new Promise((res, rej) => {
          const id = ++sequence
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timeout`)) }, 10000)
          pending.set(id, { resolve: res, reject: rej, timer })
          socket.send(JSON.stringify({ id, method, params }))
        }),
        async evaluate(expression) {
          const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
          return result.result.value
        },
      }
      clients.add(client)
      resolve(client)
    })
  })
}

async function page(kind) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
    const target = pages.find((p) => p.type === 'page' && decodeURI(p.url) === decodeURI(`${expected}#${kind}`))
    if (target) {
      const client = await connect(target.webSocketDebuggerUrl)
      await client.send('Runtime.enable')
      for (let ready = 0; ready < 30; ready++) {
        if (await client.evaluate('document.readyState === "complete" && typeof window.whitebox === "object" && !document.querySelector(".boot")').catch(() => false)) return client
        await wait(100)
      }
      throw new Error(`${kind} の描画が完了しない`)
    }
    await wait(100)
  }
  throw new Error(`${kind} の実ウィンドウが見つからない`)
}

async function command(name, args = {}) {
  const result = await main.evaluate(`window.whitebox.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`)
  if (!result.ok) throw new Error(`${name}: ${result.error}`)
  return result.data
}

async function screenshot(client, name) {
  await client.send('Page.bringToFront')
  await wait(250)
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: false })
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
}

async function startApp() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const args = ['--hidden', '--open=main', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(DATA, 'userdata')}`]
  if (!packaged) args.unshift('.')
  child = spawn(electron, args, { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', fs.openSync(path.join(DATA, 'app.log'), 'a'), fs.openSync(path.join(DATA, 'app.log'), 'a')] })
  main = await page('main')
}

async function stopApp() {
  const stopped = child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve))
  void main.evaluate('window.whitebox.call("app:quit", {}); true').catch(() => undefined)
  await Promise.race([stopped, wait(4000)])
  for (const client of clients) client.close()
  clients.clear()
  if (child.exitCode === null) child.kill()
  await wait(250)
}

async function live() {
  return (await command('state:get')).live
}

try {
  await startApp()
  const task = await command('task:create', { title: '満了停止の検証' })
  await main.evaluate('Array.from(document.querySelectorAll(".rail-tab")).find((el) => el.querySelector(".rail-tab-label").textContent === "設定").click(); true')
  check('設定画面に計測方式と休憩を表示', await main.evaluate('document.body.innerText.includes("既定の計測方法") && document.body.innerText.includes("ポモドーロの休憩")'))
  await main.evaluate('Array.from(document.querySelectorAll(".set-row")).find((el) => el.querySelector(".set-row-label").textContent === "既定の計測方法").scrollIntoView({ block: "center" }); true')
  await screenshot(main, '00-settings-modes')
  await command('window:open', { kind: 'start' })
  const start = await page('start')
  check('開始画面で3方式を選べる', await start.evaluate('document.querySelectorAll(".start-mode").length') === 3)
  await screenshot(start, '01-start-timer')
  await start.evaluate('document.querySelectorAll(".start-mode")[2].click(); true')
  check('ポモドーロの自動再開は既定で無効', await start.evaluate('document.querySelector(".start-pomodoro input[type=checkbox]").checked') === false)
  await screenshot(start, '02-start-pomodoro')
  await start.evaluate('document.querySelectorAll(".start-mode")[1].click(); true')
  await screenshot(start, '03-start-stopwatch')
  await start.evaluate('document.querySelector(".start-row").click(); true')
  await wait(1200)
  check('選択したタスクでストップウォッチを実UIから開始', (await live())?.mode === 'stopwatch')
  await screenshot(await page('hud'), '04-hud-stopwatch')
  await command('session:end')
  const review = await page('review')
  check('ストップウォッチの振り返りに予定時間を表示しない', await review.evaluate('document.querySelectorAll(".review-summary .stat").length === 4 && !Array.from(document.querySelectorAll(".review-summary .stat > .label")).some((el) => el.textContent === "予定")'))
  await screenshot(review, '04b-review-stopwatch')
  await command('session:skipReview')

  await command('session:start', { taskId: task.id, minutes: 100 })
  await wait(1200)
  await command('window:open', { kind: 'current' })
  let current = await page('current')
  const before = await live()
  await wait(1600)
  const during = await live()
  check('管理窓が開いている間は実作業が増えない', before.elapsedMs === during.elapsedMs, { before, during })
  check('管理窓に除外中の説明を表示', await current.evaluate('document.querySelector(".current-management").textContent.includes("実作業から除外中")'))
  await screenshot(current, '05-current-management')
  await current.evaluate('document.querySelector(".titlebar-close").click(); true')
  await wait(1700)
  check('×で閉じると元の実行中を再開', (await live()).elapsedMs > during.elapsedMs && (await live()).state === 'running')
  await command('session:pause')
  await command('window:open', { kind: 'current' })
  current = await page('current')
  await screenshot(current, '05b-current-manual-pause')
  await command('window:toggle', { kind: 'current' })
  await wait(350)
  check('閉じても元の手動停止を維持', (await live()).state === 'paused')
  await command('session:end')
  await command('session:skipReview')

  const timer = await command('session:start', { taskId: task.id, minutes: 1 })
  await command('session:update', { id: timer.id, patch: { plannedMs: 1800 } })
  await wait(3000)
  const expired = await live()
  check('タイマーは満了時刻で停止', expired.state === 'paused' && expired.elapsedMs === 1800, expired)
  const persisted = JSON.parse(fs.readFileSync(file)).sessions.find((s) => s.id === timer.id)
  check('正確な満了時刻を保存', persisted.pauses.at(-1).startedAt === timer.startedAt + 1800, persisted.pauses)
  await screenshot(await page('expire'), '06-expired-timer')
  await wait(1200)
  check('放置しても実作業を加算しない', (await live()).elapsedMs === 1800)
  await command('session:resume')
  check('満了後のショートカット再開は停止を維持', (await live()).state === 'paused' && (await live()).elapsedMs === 1800)
  await command('session:break', { minutes: 0.02 })
  await wait(2200)
  await command('session:resume')
  check('満了後の休憩も再開だけでは停止を保つ', (await live()).state === 'paused' && (await live()).elapsedMs === 1800)
  const expiredBreakPage = await page('expire')
  check('休憩終了画面から明示延長を選べる', await expiredBreakPage.evaluate('document.querySelector(".btn-primary").textContent.includes("続ける")'))
  await screenshot(expiredBreakPage, '06b-expired-timer-break')
  await command('session:extend', { minutes: 1 })
  await wait(1300)
  check('明示延長から再開', (await live()).state === 'running' && (await live()).elapsedMs > 1800)
  await command('session:end')
  await command('session:skipReview')
  await stopApp()

  const saved = JSON.parse(fs.readFileSync(file))
  const startedAt = Date.now()
  saved.sessions.push({
    id: 'pomodoro-boundary', startedAt, endedAt: null, createdAt: startedAt,
    plannedMs: 1200, pomodoroWorkMs: 1200, pomodoroBreakMs: 5000, mode: 'pomodoro', pomodoroAutoResume: false,
    state: 'running', segments: [{ id: 'pomodoro-segment', taskId: task.id, startedAt, endedAt: null }], pauses: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null,
  })
  fs.writeFileSync(file, JSON.stringify(saved))
  await startApp()
  await wait(2000)
  const state = await command('state:get')
  check('ポモドーロは自動で休憩へ移る', state.breakTimer !== null && state.live.elapsedMs === 1200, state.live)
  await screenshot(await page('hud'), '07-pomodoro-break')
  await wait(5500)
  const rested = await command('state:get')
  check('休憩後も明示再開まで停止', rested.breakTimer.notifiedAt !== null && rested.live.state === 'paused' && rested.live.elapsedMs === 1200)
  await screenshot(await page('expire'), '08-pomodoro-break-finished')
  await command('session:resume')
  check('明示再開で次の作業周期', (await live()).state === 'running' && (await live()).plannedMs === 2400)
  check('描画時の例外がない', errors.length === 0, errors)
  console.log(`画像と隔離記録: ${DATA}`)
} finally {
  if (child?.exitCode === null) await stopApp()
}

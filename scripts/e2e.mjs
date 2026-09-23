/**
 * 本体（メインプロセス）を通した通し確認。
 * `node scripts/e2e.mjs` で、実際のアプリを起動し、レンダラから本物の IPC を叩いて data.json を検証する。
 *
 * 使うのは公開済みの window.whitebox だけ。ここに本体の処理を書き写さないこと。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
fs.mkdirSync(path.join(ROOT, '.e2e'), { recursive: true })
const DATA = fs.mkdtempSync(path.join(ROOT, '.e2e', 'run-'))
const portServer = net.createServer()
await new Promise((resolve, reject) => { portServer.once('error', reject); portServer.listen(0, '127.0.0.1', resolve) })
const PORT = portServer.address().port
await new Promise((resolve) => portServer.close(resolve))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const fails = []
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)))
  if (!ok) fails.push(name)
}

function mkTask(id, title, progress) {
  return {
    id,
    projectId: 'p1',
    parentId: null,
    title,
    notes: '',
    status: 'todo',
    progress,
    priority: 'normal',
    order: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    doneAt: null,
    createdInSessionId: null,
  }
}

// ── 準備：この日は Welcome を出さない状態から始める ────────────────
fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true })

const now = Date.now()
const dayStartHour = 4
const d = new Date(now - dayStartHour * 3600000)
const todayKey =
  d.getFullYear() +
  '-' +
  String(d.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(d.getDate()).padStart(2, '0')

const seed = {
  version: 1,
  projects: [{ id: 'p1', name: 'テスト', hue: 150, archived: false, order: 0, createdAt: now, updatedAt: now }],
  tasks: [mkTask('t1', 'ひとつめの仕事', 20), mkTask('t2', 'ふたつめの仕事', 0)],
  sessions: [],
  dayNotes: {},
  settings: {
    displayName: '',
    defaultSessionMinutes: 50,
    defaultExtendMinutes: 15,
    extendOptions: [5, 10, 15, 25, 50],
    shortcuts: { startPause: '', currentWork: '', dashboard: '' },
    launchAtLogin: false,
    autoPauseOnSuspend: true,
    soundOnExpire: false,
    dayStartHour,
    lastWelcomeDate: todayKey,
    stallWarningDays: 3,
  },
}
fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(seed, null, 2), 'utf-8')

// ── CDP ────────────────────────────────────────────────────────────
async function findTarget(hashSuffix, tries) {
  let lastErr = null
  for (let i = 0; i < (tries || 40); i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list')
      const list = await res.json()
      const hit = list.find((t) => t.type === 'page' && decodeURI(t.url) === decodeURI(expectedPage + hashSuffix))
      if (hit) return hit
    } catch (e) {
      lastErr = e
    }
    await wait(400)
  }
  let seen = 'なし'
  try {
    const res = await fetch('http://127.0.0.1:' + PORT + '/json/list')
    seen = (await res.json()).map((t) => t.type + ':' + t.url).join(', ')
  } catch (e) {
    seen = '接続できない ' + e
  }
  throw new Error('ウィンドウが見つからない: ' + hashSuffix + ' / 見えているもの: ' + seen + ' / ' + lastErr)
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let seq = 0
    const pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    })
    ws.addEventListener('error', reject)
    ws.addEventListener('open', () =>
      resolve({
        close: () => ws.close(),
        async evaluate(expression) {
          const id = ++seq
          const result = await new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej })
            ws.send(
              JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: { expression, awaitPromise: true, returnByValue: true },
              }),
            )
          })
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
          return result.result.value
        },
      }),
    )
  })
}

const call = (name, args) => 'window.whitebox.call(' + JSON.stringify(name) + ', ' + JSON.stringify(args || {}) + ')'

// ── 実行 ───────────────────────────────────────────────────────────
// WHITEBOX_EXE を指せば、組み上げた release の exe をそのまま確かめられる
const packaged = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : null
const electron = packaged || createRequire(import.meta.url)('electron')
const buildRoot = packaged ? path.join(path.dirname(packaged), 'resources', 'app') : ROOT
const expectedPage = pathToFileURL(path.join(buildRoot, 'dist', 'index.html')).href
const args = ['--hidden', '--open=hud', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(DATA, 'profile')]
if (!packaged) args.unshift('.')
console.log('対象: ' + electron)
const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
delete env.VITE_DEV_SERVER_URL
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, args, {
  cwd: ROOT,
  env,
  stdio: ['ignore', fs.openSync(path.join(DATA, 'app.log'), 'w'), fs.openSync(path.join(DATA, 'app.log'), 'a')],
  windowsHide: true,
})

let exitCode = 1
try {
  const hudTarget = await findTarget('#hud')
  let hud = await connect(hudTarget.webSocketDebuggerUrl)

  await hud.evaluate('(() => { ' + call('session:start', { taskId: 't1', minutes: 50 }) + '; return true })()')
  hud.close()
  await wait(300)
  const startedTarget = await findTarget('#hud')
  hud = await connect(startedTarget.webSocketDebuggerUrl)
  const started = await hud.evaluate('window.whitebox.call("state:get")')
  check('セッションが始まる', started.ok && started.data.live && started.data.live.state === 'running')

  await wait(2500)
  await hud.evaluate(call('session:pause'))
  const paused = await hud.evaluate('window.whitebox.call("state:get")')
  check('一時停止すると paused になる', paused.data.live.state === 'paused', paused.data.live.state)
  const elapsedAtPause = paused.data.live.elapsedMs

  await wait(2500)
  const stillPaused = await hud.evaluate('window.whitebox.call("state:get")')
  check('停止中は実作業が増えない', Math.abs(stillPaused.data.live.elapsedMs - elapsedAtPause) < 300, {
    before: elapsedAtPause,
    after: stillPaused.data.live.elapsedMs,
  })

  await hud.evaluate(call('session:resume'))
  await hud.evaluate(call('session:break', { minutes: 0.01 }))
  const onBreak = await hud.evaluate('window.whitebox.call("state:get")')
  check('休憩を始めると paused になる', onBreak.data.live.state === 'paused')
  check('休憩終了時刻が状態に入る', Boolean(onBreak.data.breakTimer && onBreak.data.breakTimer.endsAt))
  const breakHud = await hud.evaluate('({ label: document.querySelector(".hud-time-label")?.textContent, time: document.querySelector(".hud-time")?.textContent, body: document.body.innerText })')
  check('HUD が停止中ではなく休憩タイマーを表示する', breakHud.label === '休憩' && !breakHud.body.includes('停止中'), breakHud)

  const breakTarget = await findTarget('#expire')
  const breakWindow = await connect(breakTarget.webSocketDebuggerUrl)
  const afterBreak = await breakWindow.evaluate('window.whitebox.call("state:get")')
  check('休憩終了後も明示的な再開までは paused のまま', afterBreak.data.live.state === 'paused')
  check('休憩終了通知が記録される', Boolean(afterBreak.data.breakTimer && afterBreak.data.breakTimer.notifiedAt))
  await breakWindow.evaluate(call('session:resume'))
  breakWindow.close()
  await wait(300)
  const afterBreakResume = await hud.evaluate('window.whitebox.call("state:get")')
  check('休憩通知から再開できる', afterBreakResume.data.live.state === 'running' && afterBreakResume.data.breakTimer === null)

  await wait(1200)
  await hud.evaluate(call('session:switchTask', { taskId: 't2' }))
  const switched = await hud.evaluate('window.whitebox.call("state:get")')
  check('タスクを切り替えると Foreground が変わる', switched.data.live.activeTaskId === 't2')
  check('切り替えで区間が 2 つになる', switched.data.sessions[0].segments.length === 2, switched.data.sessions[0].segments.length)

  await wait(1200)
  // このコマンドは HUD 自身を閉じるので、返事は待てない
  await hud.evaluate('(() => { ' + call('session:end') + '; return true })()')
  hud.close()

  const reviewTarget = await findTarget('#review')
  const review = await connect(reviewTarget.webSocketDebuggerUrl)
  const afterEnd = await review.evaluate('window.whitebox.call("state:get")')
  check('終了後に live が消える', afterEnd.data.live === null)
  check('レビュー対象が指定される', Boolean(afterEnd.data.pendingReview))

  const sessionId = afterEnd.data.sessions[0].id
  // このコマンドもレビュー窓自身を閉じるので、返事は待てない
  await review.evaluate(
    '(() => { ' +
      call('session:review', {
      sessionId,
      changes: [
        { taskId: 't1', from: 20, to: 45, markedDone: false },
        { taskId: 't2', from: 0, to: 100, markedDone: true },
      ],
        note: '通し確認',
      }) +
      '; return true })()',
  )
  await wait(1200)
  review.close()

  // ── 保存されたファイルを直接読んで確かめる ──
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf-8'))
  const s = saved.sessions[0]
  const pausedTotal = s.pauses.reduce((a, p) => a + (p.endedAt - p.startedAt), 0)
  const gross = s.endedAt - s.startedAt

  check('セッションが 1 本保存されている', saved.sessions.length === 1, saved.sessions.length)
  check('終了時刻が入っている', typeof s.endedAt === 'number' && s.state === 'ended')
  check('一時停止と休憩が閉じている', s.pauses.length === 2 && s.pauses.every((p) => p.endedAt !== null))
  check('停止時間に手動停止と休憩の両方が入る', pausedTotal > 3000, pausedTotal)
  check('停止ぶんが実作業から引かれている', pausedTotal > 0 && gross - pausedTotal < gross, { gross, pausedTotal })
  check('区間が 2 本、どちらも閉じている', s.segments.length === 2 && s.segments.every((x) => x.endedAt !== null))
  check('イベントが記録されている', s.events.length >= 6, s.events.map((e) => e.type))
  check('ひとことが保存されている', s.note === '通し確認')

  const t1 = saved.tasks.find((t) => t.id === 't1')
  const t2 = saved.tasks.find((t) => t.id === 't2')
  check('進捗がタスクへ反映される', t1.progress === 45, t1.progress)
  check('完了にしたタスクが Done になる', t2.status === 'done' && t2.doneAt !== null, t2.status)
  check('進捗の変化が記録に残る', s.progressChanges.length === 2)
  check('バックアップが作られている', fs.readdirSync(path.join(DATA, 'backups')).length >= 1)

  exitCode = fails.length === 0 ? 0 : 1
  console.log(fails.length === 0 ? '\nすべて通った' : '\n落ちた項目: ' + fails.join(', '))
} catch (err) {
  console.error('E2E が途中で失敗:', err)
} finally {
  child.kill()
  await wait(500)
  process.exit(exitCode)
}

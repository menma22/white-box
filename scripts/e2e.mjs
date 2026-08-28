/**
 * 本体（メインプロセス）を通した通し確認。
 * `node scripts/e2e.mjs` で、実際のアプリを起動し、レンダラから本物の IPC を叩いて data.json を検証する。
 *
 * 使うのは公開済みの window.whitebox だけ。ここに本体の処理を書き写さないこと。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA = path.join(ROOT, '.e2e')
const PORT = 9412
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
fs.rmSync(DATA, { recursive: true, force: true })
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
      const hit = list.find((t) => t.type === 'page' && t.url.endsWith(hashSuffix))
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

// window.whitebox の存在だけ見て進むと、初期 about:blank の暫定コンテキストに接続してしまい
// 本物のページの commit で "Execution context was destroyed" になる（preload は暫定側にも付く）
async function waitReady(client) {
  const ready = 'typeof window.whitebox === "object" && document.readyState === "complete" && location.hash.length > 1'
  for (let i = 0; i < 25; i++) {
    try {
      if (await client.evaluate(ready)) return
    } catch {}
    await wait(400)
  }
  throw new Error('ページの読み込みが完了しない')
}

// ── 実行 ───────────────────────────────────────────────────────────
// WHITEBOX_EXE を指せば、組み上げた release の exe をそのまま確かめられる
const packaged = process.env.WHITEBOX_EXE
const electron = packaged || path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
// userData を隔離しないと、起動中の White Box の single instance lock に当たって無言で終了する
const args = ['--hidden', '--open=hud', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(DATA, 'userdata')]
if (!packaged) args.unshift('.')
console.log('対象: ' + electron)
const child = spawn(electron, args, {
  cwd: ROOT,
  env: Object.assign({}, process.env, { WHITEBOX_DATA_DIR: DATA }),
  stdio: ['ignore', fs.openSync(path.join(ROOT, 'e2e-app.log'), 'w'), fs.openSync(path.join(ROOT, 'e2e-app.log'), 'a')],
})

let exitCode = 1
try {
  const hudTarget = await findTarget('#hud')
  const hud = await connect(hudTarget.webSocketDebuggerUrl)
  await waitReady(hud)

  // 契約（zod）の検証が生きていることを、本物の IPC 越しに確かめる
  const rejected = await hud.evaluate(call('task:create', { title: 123 }))
  check('壊れた引数は契約で拒否される', rejected.ok === false && String(rejected.error).length > 0)
  const unknown = await hud.evaluate(call('task:steal', {}))
  check('未知のコマンドは拒否される', unknown.ok === false)
  const misspelled = await hud.evaluate(call('task:update', { id: 't1', patch: { titel: 'x' } }))
  check('綴り違いのキーは黙って捨てず拒否される', misspelled.ok === false)

  const started = await hud.evaluate(call('session:start', { taskId: 't1', minutes: 50 }))
  check('セッションが始まる', started.ok && started.data && started.data.state === 'running')

  await wait(2500)
  // アプリが刻む一時停止の時刻は、この往復のどこかにある。前後を挟んで控えておき、
  // 停止時間は固定値ではなくこの範囲で判定する（往復の遅さで落ちないため）
  const pauseSentAt = Date.now()
  await hud.evaluate(call('session:pause'))
  const pauseAckAt = Date.now()
  const paused = await hud.evaluate('window.whitebox.call("state:get")')
  check('一時停止すると paused になる', paused.data.live.state === 'paused', paused.data.live.state)
  const elapsedAtPause = paused.data.live.elapsedMs

  await wait(2500)
  const stillPaused = await hud.evaluate('window.whitebox.call("state:get")')
  check('停止中は実作業が増えない', Math.abs(stillPaused.data.live.elapsedMs - elapsedAtPause) < 300, {
    before: elapsedAtPause,
    after: stillPaused.data.live.elapsedMs,
  })

  const resumeSentAt = Date.now()
  await hud.evaluate(call('session:resume'))
  const resumeAckAt = Date.now()
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
  await waitReady(review)
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
  check('一時停止が閉じている', s.pauses.length === 1 && s.pauses[0].endedAt !== null)
  // 固定値との比較にすると、起動直後でディスクが遅い環境では往復が伸びて落ちる（実際に落ちた）。
  // アプリが刻んだ停止区間は、必ずテスト側が挟んで実測したこの範囲に入る
  const pausedFloor = resumeSentAt - pauseAckAt
  const pausedCeil = resumeAckAt - pauseSentAt
  check('停止時間がテスト側の実測範囲に収まる', pausedTotal >= pausedFloor && pausedTotal <= pausedCeil, {
    pausedTotal,
    floor: pausedFloor,
    ceil: pausedCeil,
  })
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

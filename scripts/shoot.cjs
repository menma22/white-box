/**
 * 見た目確認用の撮影台。`electron scripts/shoot.cjs <データディレクトリ> <出力先>` で走らせる。
 *
 * 画面に出さずに撮るため、ウィンドウは show:false のまま capturePage する。
 * ここは state:get にだけ答える置き台であって、コマンドの処理は書かないこと（本体と二重実装になる）。
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.dirname(__dirname)
const dataDir = process.argv[2]
const outDir = process.argv[3]
const MIN = 60000

const logPath = path.join(ROOT, 'shoot.log')
function log(msg) {
  fs.appendFileSync(logPath, String(msg) + require('node:os').EOL)
}

const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf-8'))
fs.mkdirSync(outDir, { recursive: true })

const now = Date.now()
const liveTaskId = (db.tasks.find((t) => t.status === 'doing') || db.tasks[0]).id
const subTaskId = (db.tasks.find((t) => t.parentId) || { id: liveTaskId }).id

const liveSession = {
  id: 'ses_live',
  startedAt: now - 34 * MIN,
  endedAt: null,
  plannedMs: 50 * MIN,
  state: 'running',
  segments: [
    { id: 'seg_a', taskId: subTaskId, startedAt: now - 34 * MIN, endedAt: now - 12 * MIN },
    { id: 'seg_b', taskId: liveTaskId, startedAt: now - 12 * MIN, endedAt: null },
  ],
  pauses: [{ startedAt: now - 26 * MIN, endedAt: now - 22 * MIN, reason: 'manual' }],
  events: [
    { at: now - 34 * MIN, type: 'session_started', label: 'セッション開始（50分）' },
    { at: now - 26 * MIN, type: 'paused', label: '一時停止' },
    { at: now - 22 * MIN, type: 'resumed', label: '再開' },
    { at: now - 12 * MIN, type: 'task_switched', label: 'バックエンドPRを完成させる' },
  ],
  progressChanges: [],
  note: '',
  expiredNotifiedAt: null,
  editedAt: null,
  createdAt: now - 34 * MIN,
}

const SHOTS = [
  { kind: 'main', w: 1240, h: 820, tab: 0, live: true, name: '01-today' },
  {
    kind: 'main',
    w: 1240,
    h: 820,
    tab: 1,
    live: true,
    name: '02-board',
    probe: '(()=>{const c=document.querySelector(".board-cols");return {scroll:c.scrollWidth,client:c.clientWidth};})()',
  },
  { kind: 'main', w: 1240, h: 820, tab: 2, live: false, name: '03-history' },
  { kind: 'main', w: 1240, h: 820, tab: 3, live: false, name: '04-settings' },
  { kind: 'main', w: 1240, h: 820, tab: 0, live: false, welcome: true, name: '05-welcome' },
  { kind: 'start', w: 660, h: 500, live: false, name: '06-start' },
  { kind: 'hud', w: 248, h: 88, live: true, name: '07-hud' },
  { kind: 'hud', w: 248, h: 88, live: true, breakActive: true, name: '07b-hud-break' },
  {
    kind: 'expire',
    w: 500,
    h: 458,
    live: true,
    over: true,
    name: '08-expire',
    probe:
      '(()=>{const e=document.querySelector(".expire-task");if(!e)return "MISSING";const r=e.getBoundingClientRect();return {text:e.textContent,w:r.width,h:r.height,color:getComputedStyle(e).color};})()',
  },
  { kind: 'expire', w: 500, h: 458, live: true, breakFinished: true, name: '08b-break-finished' },
  { kind: 'review', w: 900, h: 720, live: false, review: true, name: '09-review' },
  { kind: 'current', w: 760, h: 660, live: true, name: '10-current' },
  {
    kind: 'main',
    w: 1240,
    h: 820,
    tab: 1,
    live: true,
    detail: true,
    name: '11-task-detail',
    probe:
      '(()=>{const t=document.querySelector(".detail-title");const c=document.querySelector(".board-cols");return {value:t&&t.value,h:t&&t.getBoundingClientRect().height,cols:c&&c.scrollWidth,visible:c&&c.clientWidth};})()',
  },
]

let current = SHOTS[0]

function todayKey(dayStartHour) {
  const d = new Date(now - dayStartHour * 3600000)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + m + '-' + day
}

function stateFor(shot) {
  const sessions = shot.live ? db.sessions.concat([liveSession]) : db.sessions
  return {
    revision: 1,
    projects: db.projects,
    tasks: db.tasks,
    sessions: sessions,
    settings: Object.assign({}, db.settings, {
      // 今日の日付が入っていれば Welcome は出ない
      lastWelcomeDate: shot.welcome ? null : todayKey(db.settings.dayStartHour),
      soundOnExpire: false,
    }),
    dayNotes: {},
    live: shot.live
      ? {
          sessionId: liveSession.id,
          state: shot.breakFinished || shot.breakActive ? 'paused' : 'running',
          elapsedMs: shot.over ? 53 * MIN : 30 * MIN,
          remainingMs: shot.over ? -3 * MIN : 20 * MIN,
          plannedMs: 50 * MIN,
          activeTaskId: liveTaskId,
        }
      : null,
    breakTimer: shot.breakActive
      ? { startedAt: now - MIN, endsAt: now + 4 * MIN, notifiedAt: null }
      : shot.breakFinished
        ? { startedAt: now - 5 * MIN, endsAt: now, notifiedAt: now }
        : null,
    recovery: null,
    pendingReview: shot.review ? { sessionId: db.sessions[0].id, thenStart: false } : null,
  }
}

ipcMain.handle('whitebox:cmd', function (_e, payload) {
  return payload && payload.name === 'state:get'
    ? { ok: true, data: stateFor(current) }
    : { ok: true, data: null }
})

// 撮り終えるたびにウィンドウが 0 枚になるので、既定の自動終了を止める
app.on('window-all-closed', () => {})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  for (const shot of SHOTS) {
    current = shot
    const win = new BrowserWindow({
      width: shot.w,
      height: shot.h,
      show: false,
      frame: false,
      transparent: shot.kind === 'hud',
      backgroundColor: shot.kind === 'hud' ? '#00000000' : '#F6F2EA',
      webPreferences: {
        preload: path.join(ROOT, 'apps', 'desktop', 'src', 'presentation', 'preload.cjs'),
        contextIsolation: true,
        sandbox: false,
      },
    })
    // 直前のウィンドウを壊した直後は読み込みが中断されることがあるので、一度だけ入れ直す
    try {
      await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { hash: shot.kind })
    } catch (e) {
      log('retry ' + shot.name + ': ' + e)
      await wait(400)
      await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { hash: shot.kind })
    }
    if (shot.kind === 'hud') {
      await win.webContents.insertCSS('html,body,.boot{background:transparent!important}body::before{content:none!important}')
    }
    // 非表示のままだと DOM が変わっても再合成されず、最初のフレームが撮れてしまう。
    // 透明にして表示だけしておくと、画面には出ないまま合成が続く。
    win.setOpacity(0)
    win.setSkipTaskbar(true)
    win.showInactive()
    await wait(1200)
    if (shot.tab) {
      // 本体と同じ Ctrl+数字の経路で切り替える（クリックの合成より確実）
      await win.webContents.executeJavaScript(
        'window.dispatchEvent(new KeyboardEvent("keydown",{key:"' +
          (shot.tab + 1) +
          '",ctrlKey:true,bubbles:true})); true',
      )
      await wait(700)
      const active = await win.webContents.executeJavaScript(
        'document.querySelector(".rail-tab.is-active")?.innerText || "?"',
      )
      log('  tab=' + String(active).replace(/\s+/g, ' '))
    }
    if (shot.detail) {
      await win.webContents.executeJavaScript('document.querySelector(".card").click(); true')
      await wait(500)
    }
    if (shot.probe) {
      const r = await win.webContents.executeJavaScript(shot.probe)
      log('  probe=' + JSON.stringify(r))
    }
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, shot.name + '.png'), image.toPNG())
    log('shot ' + shot.name)
    win.destroy()
    await wait(350)
  }
}

app.whenReady()
  .then(main)
  .catch((e) => log('ERROR ' + (e && e.stack ? e.stack : e)))
  .finally(() => app.quit())

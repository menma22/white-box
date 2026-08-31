/**
 * 動作確認用のデータを書き出す。WHITEBOX_DATA_DIR を指してから White Box を起動する。
 * 本番のデータフォルダには絶対に向けないこと（data.json を上書きする）。
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('使い方: node scripts/seed-demo.mjs <出力先ディレクトリ>')
  process.exit(1)
}
fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })

const MIN = 60_000
const H = 3_600_000
const now = Date.now()
const at = (h, m) => {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

let n = 0
const id = (p) => `${p}_${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const projects = [
  { id: 'prj_app', name: 'プロダクト', hue: 18, archived: false, order: 0, createdAt: now, updatedAt: now },
  { id: 'prj_paper', name: '論文', hue: 200, archived: false, order: 1, createdAt: now, updatedAt: now },
  { id: 'prj_wb', name: 'White Box', hue: 150, archived: false, order: 2, createdAt: now, updatedAt: now },
]

const task = (o) => ({
  id: id('tsk'),
  projectId: null,
  parentId: null,
  notes: '',
  status: 'todo',
  progress: 0,
  priority: 'normal',
  order: 0,
  createdAt: now - 5 * 86400000,
  updatedAt: now,
  doneAt: null,
  createdInSessionId: null,
  ...o,
})

const backend = task({ title: 'バックエンドPRを完成させる', projectId: 'prj_app', status: 'doing', progress: 65, priority: 'high', order: 0 })
const thesis = task({ title: '第3章の実験結果を書く', projectId: 'prj_paper', status: 'todo', progress: 20, priority: 'high', order: 0, createdAt: now - 9 * 86400000 })
const tasks = [
  backend,
  task({ title: 'API を追加する', projectId: 'prj_app', parentId: backend.id, status: 'done', progress: 100, order: 0, doneAt: now - 3 * H }),
  task({ title: 'Schema を直す', projectId: 'prj_app', parentId: backend.id, status: 'doing', progress: 40, order: 1 }),
  task({ title: 'テストを足す', projectId: 'prj_app', parentId: backend.id, status: 'todo', progress: 0, order: 3 }),
  thesis,
  task({ title: '先行研究を5本読む', projectId: 'prj_paper', status: 'todo', progress: 40, order: 1 }),
  task({ title: 'レビュー指摘を反映する', projectId: 'prj_app', status: 'todo', order: 2 }),
  task({ title: '開始UIのキーボード操作を詰める', projectId: 'prj_wb', status: 'todo', order: 4 }),
  task({ title: '週次の振り返りをどう聞くか考える', projectId: 'prj_wb', status: 'inbox', order: 0 }),
  task({ title: '確定申告の書類を探す', status: 'inbox', order: 1 }),
  task({
    title: '研究計画書を書き直す',
    projectId: 'prj_paper',
    status: 'todo',
    priority: 'high',
    order: 5,
    createdAt: now - 12 * 86400000,
  }),
  task({ title: '記録の書き出し形式を決める', projectId: 'prj_wb', status: 'inbox', order: 2 }),
  task({ title: '要件を棚卸しする', projectId: 'prj_wb', status: 'done', progress: 100, order: 0, doneAt: now - 26 * H }),
  task({ title: 'Kanban の列を決める', projectId: 'prj_wb', status: 'done', progress: 100, order: 1, doneAt: now - 25 * H }),
]

const session = (startedAt, mins, segs, pauses = [], changes = [], note = '') => {
  const endedAt = startedAt + mins * MIN
  return {
    id: id('ses'),
    startedAt,
    endedAt,
    plannedMs: 50 * MIN,
    state: 'ended',
    segments: segs.map(([taskId, a, b]) => ({ id: id('seg'), taskId, startedAt: startedAt + a * MIN, endedAt: startedAt + b * MIN })),
    pauses: pauses.map(([a, b]) => ({ startedAt: startedAt + a * MIN, endedAt: startedAt + b * MIN, reason: 'manual' })),
    events: [
      { at: startedAt, type: 'session_started', label: 'セッション開始（50分）' },
      { at: endedAt, type: 'session_ended', label: `セッション終了（実作業 ${mins}分）` },
    ],
    progressChanges: changes,
    note,
    expiredNotifiedAt: null,
    editedAt: null,
    createdAt: startedAt,
  }
}

const sessions = [
  session(at(9, 12), 52, [[backend.id, 0, 52]], [[24, 31]], [{ taskId: backend.id, from: 45, to: 58, markedDone: false }]),
  session(at(10, 20), 50, [[thesis.id, 0, 50]], [], [{ taskId: thesis.id, from: 10, to: 20, markedDone: false }], '図表の番号がずれてる。次はそこから。'),
  session(at(13, 5), 38, [[tasks[5].id, 0, 22], [tasks[6].id, 22, 38]]),
  session(at(15, 40), 46, [[backend.id, 0, 46]], [[18, 22]], [{ taskId: backend.id, from: 58, to: 65, markedDone: false }]),
  session(at(9, 30) - 24 * H, 65, [[backend.id, 0, 65]]),
  session(at(14, 0) - 24 * H, 45, [[tasks[7].id, 0, 45]]),
  session(at(10, 0) - 48 * H, 92, [[thesis.id, 0, 92]], [[40, 48]]),
]

const db = {
  version: 1,
  projects,
  tasks,
  sessions,
  dayNotes: {},
  settings: {
    displayName: '',
    defaultSessionMinutes: 50,
    defaultExtendMinutes: 15,
    extendOptions: [5, 10, 15, 25, 50],
    shortcuts: { startPause: 'Control+Alt+S', currentWork: 'Control+Alt+W', dashboard: 'Control+Alt+D' },
    launchAtLogin: false,
    autoPauseOnSuspend: true,
    soundOnExpire: false,
    dayStartHour: 4,
    lastWelcomeDate: null,
    stallWarningDays: 3,
    // 既に使っている人のデータなので済みにする。null にすると撮影台の全カットに初回オンボーディングが被る
    onboardedAt: now,
  },
}

fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(db, null, 2), 'utf-8')
console.log('seeded', path.join(dir, 'data.json'))

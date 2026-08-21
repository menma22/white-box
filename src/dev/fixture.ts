/**
 * ブラウザで見た目を確認するための固定データ。アプリの動作には一切使わない。
 * 振る舞い（コマンドの処理）をここに足さないこと。
 */
import type { AppState, Project, Session, Task } from '@white-box/core/types'

const MIN = 60_000
const H = 3_600_000

let seq = 0
const id = (p: string) => `${p}_fx${++seq}`

export function devFixture(): AppState {
  const now = Date.now()
  const today = new Date(now)
  today.setHours(9, 12, 0, 0)
  const t0 = today.getTime()

  const projects: Project[] = [
    { id: 'prj_app', name: 'プロダクト', hue: 18, archived: false, order: 0, createdAt: now, updatedAt: now },
    { id: 'prj_paper', name: '論文', hue: 200, archived: false, order: 1, createdAt: now, updatedAt: now },
    { id: 'prj_wb', name: 'White Box', hue: 150, archived: false, order: 2, createdAt: now, updatedAt: now },
  ]

  const mk = (
    over: Partial<Task> & { title: string },
  ): Task => ({
    id: id('tsk'),
    projectId: null,
    parentId: null,
    notes: '',
    status: 'todo',
    progress: 0,
    priority: 'normal',
    order: 0,
    createdAt: now - 3 * 86400000,
    updatedAt: now,
    doneAt: null,
    createdInSessionId: null,
    ...over,
  })

  const backend = mk({ title: 'バックエンドPRを完成させる', projectId: 'prj_app', status: 'doing', progress: 65, priority: 'high', order: 0 })
  const tasks: Task[] = [
    backend,
    mk({ title: 'API 追加', projectId: 'prj_app', parentId: backend.id, status: 'done', progress: 100, order: 0, doneAt: now - 2 * H }),
    mk({ title: 'Schema 修正', projectId: 'prj_app', parentId: backend.id, status: 'doing', progress: 40, order: 1 }),
    mk({ title: 'Test 追加', projectId: 'prj_app', parentId: backend.id, status: 'todo', progress: 0, order: 2 }),
    mk({ title: '第3章の実験結果を書く', projectId: 'prj_paper', status: 'todo', progress: 20, priority: 'high', order: 1 }),
    mk({ title: '先行研究を5本読む', projectId: 'prj_paper', status: 'todo', progress: 40, order: 2 }),
    mk({ title: 'レビュー指摘の反映', projectId: 'prj_app', status: 'todo', order: 3 }),
    mk({ title: 'Start UI のキーボード操作', projectId: 'prj_wb', status: 'todo', order: 4 }),
    mk({ title: '週次の振り返りをどう聞くか考える', projectId: 'prj_wb', status: 'inbox', order: 0 }),
    mk({ title: '確定申告の書類を探す', status: 'inbox', order: 1 }),
    mk({ title: 'Session 記録の書き出し形式', projectId: 'prj_wb', status: 'inbox', order: 2 }),
    mk({ title: '要件の棚卸し', projectId: 'prj_wb', status: 'done', progress: 100, order: 0, doneAt: now - 26 * H }),
    mk({ title: 'Kanban の列を決める', projectId: 'prj_wb', status: 'done', progress: 100, order: 1, doneAt: now - 25 * H }),
  ]

  const ses = (startedAt: number, mins: number, taskId: string, pauses: [number, number][] = []): Session => ({
    id: id('ses'),
    startedAt,
    endedAt: startedAt + mins * MIN,
    plannedMs: 50 * MIN,
    state: 'ended',
    segments: [{ id: id('seg'), taskId, startedAt, endedAt: startedAt + mins * MIN }],
    pauses: pauses.map(([a, b]) => ({ startedAt: startedAt + a * MIN, endedAt: startedAt + b * MIN, reason: 'manual' as const })),
    events: [
      { at: startedAt, type: 'session_started', label: 'セッション開始（50分）' },
      { at: startedAt + mins * MIN, type: 'session_ended', label: `セッション終了（実作業 ${mins}分）` },
    ],
    progressChanges: [],
    note: '',
    expiredNotifiedAt: null,
    editedAt: null,
    createdAt: startedAt,
  })

  const live = ses(now - 34 * MIN, 34, backend.id, [[12, 18]])
  live.id = 'ses_live'
  live.endedAt = null
  live.state = 'running'
  live.segments = [
    { id: id('seg'), taskId: tasks[2]!.id, startedAt: now - 34 * MIN, endedAt: now - 11 * MIN },
    { id: id('seg'), taskId: backend.id, startedAt: now - 11 * MIN, endedAt: null },
  ]

  const sessions: Session[] = [
    ses(t0, 52, backend.id, [[24, 31]]),
    ses(t0 + 70 * MIN, 50, tasks[4]!.id),
    ses(t0 + 3 * H, 38, tasks[5]!.id),
    ses(t0 - 22 * H, 65, backend.id),
    ses(t0 - 20 * H, 45, tasks[7]!.id),
    live,
  ]

  return {
    revision: 1,
    projects,
    tasks,
    sessions,
    settings: {
      displayName: '',
      defaultSessionMinutes: 50,
      defaultExtendMinutes: 15,
      extendOptions: [5, 10, 15, 25, 50],
      shortcuts: { startPause: 'Control+Alt+S', currentWork: 'Control+Alt+W', dashboard: 'Control+Alt+D' },
      launchAtLogin: false,
      autoPauseOnSuspend: true,
      soundOnExpire: true,
      dayStartHour: 4,
      lastWelcomeDate: null,
      stallWarningDays: 3,
    },
    live: {
      sessionId: 'ses_live',
      state: 'running',
      elapsedMs: 28 * MIN + 14_000,
      remainingMs: 21 * MIN + 46_000,
      plannedMs: 50 * MIN,
      activeTaskId: backend.id,
    },
    dayNotes: {},
    recovery: null,
    pendingReview: { sessionId: sessions[0]!.id, thenStart: false },
  }
}

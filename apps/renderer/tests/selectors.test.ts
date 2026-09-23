import { describe, expect, it } from 'vitest'
import type { AppState, Session, Task } from '@white-box/core/types'
import { HOUR, MINUTE } from '@white-box/core/engine'
import {
  ancestorTitles,
  candidateTasks,
  columnRoots,
  dayKeysWithSessions,
  dayTotalMs,
  matchTask,
  nestedChildren,
  stalledTasks,
  taskTitle,
} from '../src/lib/selectors.js'
import { remainingLabel, shortcutLabel } from '../src/lib/format.js'

function task(over: Partial<Task> & { id: string }): Task {
  return {
    projectId: null,
    parentId: null,
    title: over.id,
    notes: '',
    status: 'todo',
    progress: 0,
    priority: 'normal',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    doneAt: null,
    createdInSessionId: null,
    ...over,
  }
}

function session(startedAt: number, minutes: number, taskId = 'a'): Session {
  return {
    id: `ses_${startedAt}`,
    startedAt,
    endedAt: startedAt + minutes * MINUTE,
    plannedMs: minutes * MINUTE,
    state: 'ended',
    segments: [{ id: `seg_${startedAt}`, taskId, startedAt, endedAt: startedAt + minutes * MINUTE }],
    pauses: [],
    events: [],
    progressChanges: [],
    note: '',
    expiredNotifiedAt: null,
    editedAt: null,
    createdAt: startedAt,
  }
}

function state(over: Partial<AppState> = {}): AppState {
  return {
    revision: 1,
    projects: [],
    tasks: [],
    sessions: [],
    settings: {
      displayName: '',
      defaultSessionMinutes: 50,
      defaultExtendMinutes: 15,
      extendOptions: [5],
      shortcuts: { startPause: 'Control+Alt+S', currentWork: '', dashboard: '' },
      launchAtLogin: false,
      autoPauseOnSuspend: true,
      soundOnExpire: true,
      dayStartHour: 4,
      lastWelcomeDate: null,
      stallWarningDays: 3,
      showSessionCard: true,
      onboardedAt: null,
    },
    dayNotes: {},
    live: null,
    breakTimer: null,
    recovery: null,
    pendingReview: null,
    ...over,
  }
}

describe('selectors', () => {
  it('columnRoots は「親が同じ列にいる子」を列の一覧から外す', () => {
    const s = state({
      tasks: [
        task({ id: 'p', status: 'todo', order: 1 }),
        task({ id: 'c-same', status: 'todo', parentId: 'p', order: 0 }),
        task({ id: 'c-other', status: 'doing', parentId: 'p' }),
      ],
    })
    // 同じ列の子は親の入れ子で描くので roots に出ない
    expect(columnRoots(s, 'todo').map((t) => t.id)).toEqual(['p'])
    // 親が別の列にいる子は、その列の root として出る
    expect(columnRoots(s, 'doing').map((t) => t.id)).toEqual(['c-other'])
    expect(nestedChildren(s, s.tasks[0]!).map((t) => t.id)).toEqual(['c-same'])
  })

  it('ancestorTitles は親をさかのぼり、循環しても止まる', () => {
    const s = state({
      tasks: [task({ id: 'a', title: 'A', parentId: 'b' }), task({ id: 'b', title: 'B', parentId: 'a' })],
    })
    expect(ancestorTitles(s, s.tasks[0]!).length).toBeLessThanOrEqual(12)
  })

  it('stalledTasks は「重要なのに動いていない」タスクだけを日数つきで返す', () => {
    const now = 10 * 86_400_000
    const s = state({
      tasks: [
        task({ id: 'stalled', priority: 'high', status: 'todo', createdAt: 0 }),
        task({ id: 'fresh', priority: 'high', status: 'todo', createdAt: now - 86_400_000 }),
        task({ id: 'normal-old', priority: 'normal', status: 'todo', createdAt: 0 }),
        task({ id: 'inbox-high', priority: 'high', status: 'inbox', createdAt: 0 }),
        task({ id: 'done-high', priority: 'high', status: 'done', createdAt: 0 }),
      ],
    })
    const stalls = stalledTasks(s, now)
    expect(stalls.map((x) => x.task.id)).toEqual(['stalled'])
    expect(stalls[0]!.days).toBe(10)
  })

  it('stalledTasks はセッションで触った日から数え直す', () => {
    const now = 10 * 86_400_000
    const s = state({
      tasks: [task({ id: 'touched', priority: 'high', status: 'todo', createdAt: 0 })],
      sessions: [session(now - 86_400_000, 30, 'touched')],
    })
    expect(stalledTasks(s, now)).toHaveLength(0) // 1 日前に触った → 閾値 3 日に届かない
  })

  it('candidateTasks は doing → todo → inbox、同じ列では重要度順に並ぶ', () => {
    const s = state({
      tasks: [
        task({ id: 'inbox', status: 'inbox' }),
        task({ id: 'todo-high', status: 'todo', priority: 'high' }),
        task({ id: 'todo-low', status: 'todo', priority: 'low' }),
        task({ id: 'doing', status: 'doing' }),
        task({ id: 'done', status: 'done' }),
      ],
    })
    expect(candidateTasks(s).map((t) => t.id)).toEqual(['doing', 'todo-high', 'todo-low', 'inbox'])
  })

  it('matchTask はタスク名とプロジェクト名を大文字小文字を区別せず見る', () => {
    const s = state({
      projects: [{ id: 'p', name: 'Quri', hue: 1, archived: false, order: 0, createdAt: 0, updatedAt: 0 }],
      tasks: [task({ id: 'a', title: 'レビュー対応', projectId: 'p' })],
    })
    const t = s.tasks[0]!
    expect(matchTask(s, t, 'レビュー')).toBe(true)
    expect(matchTask(s, t, 'quri')).toBe(true)
    expect(matchTask(s, t, '別件')).toBe(false)
    expect(matchTask(s, t, '  ')).toBe(true) // 空検索は全件
  })

  it('dayKeysWithSessions は dayStartHour の境目で日付を割り、新しい順に返す', () => {
    const day1 = new Date(2026, 7, 20, 10, 0).getTime()
    const day1Night = new Date(2026, 7, 21, 2, 0).getTime() // 深夜 2 時 → まだ 8/20 の扱い
    const day2 = new Date(2026, 7, 21, 9, 0).getTime()
    const s = state({ sessions: [session(day1, 50), session(day1Night, 30), session(day2, 20)] })
    expect(dayKeysWithSessions(s)).toEqual(['2026-08-21', '2026-08-20'])
    expect(dayTotalMs(s, '2026-08-20', day2 + HOUR)).toBe(80 * MINUTE) // 昼 50 分 + 深夜 30 分
  })

  it('taskTitle は消えたタスクを（削除されたタスク）として返す', () => {
    const s = state({ tasks: [task({ id: 'a', title: '生きてる' })] })
    expect(taskTitle(s, 'a')).toBe('生きてる')
    expect(taskTitle(s, 'ghost')).toBe('（削除されたタスク）')
    expect(taskTitle(s, null)).toBe('（削除されたタスク）')
  })
})

describe('format', () => {
  it('remainingLabel は満了後を + 付きで出す', () => {
    expect(remainingLabel(83 * MINUTE)).toBe('1:23:00')
    expect(remainingLabel(-3 * MINUTE - 21_000)).toBe('+03:21')
    expect(remainingLabel(0)).toBe('00:00')
  })

  it('shortcutLabel は Control を Ctrl にし + を読みやすくする', () => {
    expect(shortcutLabel('Control+Alt+S')).toBe('Ctrl + Alt + S')
    expect(shortcutLabel('Shift+F1')).toBe('Shift + F1')
  })
})

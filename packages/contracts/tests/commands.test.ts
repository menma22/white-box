import { describe, expect, it } from 'vitest'
import { COMMANDS, isCommand, parseArgs, type ArgsOf, type CommandName } from '../src/commands.js'
import { AppStateSchema, SessionSchema } from '../src/schemas.js'

describe('コマンド契約', () => {
  it('コマンドは 33 個で固定（増減するときはこのテストを意図的に更新する）', () => {
    expect(Object.keys(COMMANDS)).toHaveLength(33)
  })

  it('全コマンドが args と result の両スキーマを持つ', () => {
    for (const [name, def] of Object.entries(COMMANDS)) {
      expect(typeof def.args.parse, name).toBe('function')
      expect(typeof def.result.parse, name).toBe('function')
    }
  })

  it('正しい引数は通る（代表例）', () => {
    expect(parseArgs('session:start', { taskId: 't1', minutes: 50 })).toEqual({ taskId: 't1', minutes: 50 })
    expect(parseArgs('session:start', { newTask: { title: 'X', projectId: null }, minutes: 25 })).toEqual({
      newTask: { title: 'X', projectId: null },
      minutes: 25,
    })
    expect(parseArgs('task:move', { id: 't1', status: 'todo', index: 0 })).toEqual({ id: 't1', status: 'todo', index: 0 })
    expect(parseArgs('settings:update', { patch: { dayStartHour: 5 } })).toEqual({ patch: { dayStartHour: 5 } })
    // 引数なしコマンドは undefined を {} に正規化する
    expect(parseArgs('session:resume', undefined)).toEqual({})
  })

  it('除外区間つきの記録修正が通る', () => {
    expect(parseArgs('session:update', { id: 's1', patch: { exclusions: [{ startedAt: 1000, endedAt: 2000 }] } })).toEqual({
      id: 's1',
      patch: { exclusions: [{ startedAt: 1000, endedAt: 2000 }] },
    })
  })

  it('壊れた引数は落ちる（代表例）', () => {
    expect(() => parseArgs('task:create', {})).toThrow() // title 欠落
    expect(() => parseArgs('session:start', { minutes: 'fifty' })).toThrow() // 型違い
    expect(() => parseArgs('task:move', { id: 't', status: 'later', index: 0 })).toThrow() // 存在しない列
    expect(() => parseArgs('window:open', { kind: 'popup' })).toThrow() // 存在しない窓
    expect(() => parseArgs('session:review', { sessionId: 's', changes: [{ taskId: 't' }] })).toThrow() // 変更行の欠落
    expect(() => parseArgs('session:pause', { reason: 'excluded' })).toThrow()
    expect(() => parseArgs('session:update', { id: 's', patch: { exclusions: [{ startedAt: 1.5, endedAt: 2 }] } })).toThrow()
    expect(() => parseArgs('session:update', { id: 's', patch: { exclusions: [{ startedAt: NaN, endedAt: 2 }] } })).toThrow()
    expect(() => parseArgs('session:update', { id: 's', patch: { exclusions: [{ startedAt: 1 }] } })).toThrow()
  })

  // コマンドを足すとここが型エラーになるので、新しいコマンドも必ずこの検査を通ることになる
  const sample: { [N in CommandName]: ArgsOf<N> } = {
    'state:get': {},
    'project:create': { name: 'P' },
    'project:update': { id: 'p1', patch: { name: 'P2' } },
    'project:delete': { id: 'p1' },
    'task:create': { title: 'T' },
    'task:update': { id: 't1', patch: { progress: 10 } },
    'task:move': { id: 't1', status: 'todo', index: 0 },
    'task:delete': { id: 't1' },
    'task:hasTime': { id: 't1' },
    'session:start': { taskId: 't1', minutes: 50 },
    'session:pause': {},
    'session:resume': {},
    'session:toggle': {},
    'session:extend': { minutes: 5 },
    'session:switchTask': { taskId: 't1' },
    'session:end': {},
    'session:review': { sessionId: 's1', changes: [{ taskId: 't1', from: 0, to: 50, markedDone: false }] },
    'session:skipReview': {},
    'session:update': { id: 's1', patch: { note: 'n', exclusions: [{ startedAt: 1000, endedAt: 2000 }] } },
    'session:delete': { id: 's1' },
    'recovery:close': {},
    'recovery:resume': {},
    'window:open': { kind: 'main' },
    'window:close': { kind: 'main' },
    'window:toggle': { kind: 'main' },
    'window:minimize': {},
    'settings:update': { patch: { dayStartHour: 5 } },
    'day:note': { key: '2026-08-21', text: 'メモ' },
    'welcome:dismiss': {},
    'data:export': {},
    'data:import': {},
    'data:reveal': {},
    'app:quit': {},
  }

  it('身に覚えのないキーは全コマンドで落ちる（黙って捨てない）', () => {
    for (const name of Object.keys(COMMANDS) as CommandName[]) {
      expect(parseArgs(name, sample[name]), `${name} の正しい引数が通らない`).toEqual(sample[name])
      expect(() => parseArgs(name, { ...(sample[name] as object), tilte: 'x' }), `${name} が未知のキーを黙って捨てた`).toThrow()
    }
  })

  it('入れ子の patch・newTask・changes の綴り違いも落ちる', () => {
    expect(() => parseArgs('task:update', { id: 't1', patch: { titel: 'x' } })).toThrow()
    expect(() => parseArgs('project:update', { id: 'p1', patch: { nmae: 'x' } })).toThrow()
    expect(() => parseArgs('settings:update', { patch: { dayStartHor: 5 } })).toThrow()
    expect(() => parseArgs('session:update', { id: 's1', patch: { nte: 'x' } })).toThrow()
    expect(() =>
      parseArgs('session:update', { id: 's1', patch: { exclusions: [{ startedAt: 1, endedAt: 2, why: '離席' }] } }),
    ).toThrow()
    expect(() => parseArgs('session:start', { newTask: { title: 'X', projectid: null } })).toThrow()
    expect(() =>
      parseArgs('session:review', { sessionId: 's1', changes: [{ taskId: 't1', from: 0, to: 1, markedDone: false, extra: 1 }] }),
    ).toThrow()
  })

  it('未知のコマンド名は契約に居ない', () => {
    expect(isCommand('session:start')).toBe(true)
    expect(isCommand('session:steal')).toBe(false)
  })

  it('データスキーマは実データの形を受け入れる', () => {
    const session = {
      id: 'ses_x',
      startedAt: 1000,
      endedAt: null,
      plannedMs: 3_000_000,
      state: 'running',
      segments: [{ id: 'seg_x', taskId: 'tsk_x', startedAt: 1000, endedAt: null }],
      pauses: [
        { startedAt: 2000, endedAt: null, reason: 'manual' },
        { startedAt: 4000, endedAt: 5000, reason: 'excluded' },
      ],
      events: [{ at: 1000, type: 'session_started', label: '開始', ref: { minutes: 50 } }],
      progressChanges: [{ taskId: 'tsk_x', from: 0, to: 40, markedDone: false }],
      note: '',
      expiredNotifiedAt: null,
      editedAt: null,
      createdAt: 1000,
    }
    expect(() => SessionSchema.parse(session)).not.toThrow()

    const appState = {
      revision: 1,
      projects: [],
      tasks: [],
      sessions: [session],
      settings: {
        displayName: '',
        defaultSessionMinutes: 50,
        defaultExtendMinutes: 15,
        extendOptions: [5, 10, 15],
        shortcuts: { startPause: 'Control+Alt+S', currentWork: 'Control+Alt+W', dashboard: 'Control+Alt+D' },
        launchAtLogin: false,
        autoPauseOnSuspend: true,
        soundOnExpire: true,
        dayStartHour: 4,
        lastWelcomeDate: null,
        stallWarningDays: 3,
        showSessionCard: true,
        onboardedAt: null,
      },
      dayNotes: { '2026-08-21': 'メモ' },
      live: null,
      recovery: null,
      pendingReview: { sessionId: 'ses_x', thenStart: false },
    }
    expect(() => AppStateSchema.parse(appState)).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { COMMANDS, isCommand, parseArgs } from '../src/commands.js'
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

  it('壊れた引数は落ちる（代表例）', () => {
    expect(() => parseArgs('task:create', {})).toThrow() // title 欠落
    expect(() => parseArgs('session:start', { minutes: 'fifty' })).toThrow() // 型違い
    expect(() => parseArgs('task:move', { id: 't', status: 'later', index: 0 })).toThrow() // 存在しない列
    expect(() => parseArgs('window:open', { kind: 'popup' })).toThrow() // 存在しない窓
    expect(() => parseArgs('session:review', { sessionId: 's', changes: [{ taskId: 't' }] })).toThrow() // 変更行の欠落
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
      pauses: [{ startedAt: 2000, endedAt: null, reason: 'manual' }],
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
      },
      dayNotes: { '2026-08-21': 'メモ' },
      live: null,
      recovery: null,
      pendingReview: { sessionId: 'ses_x', thenStart: false },
    }
    expect(() => AppStateSchema.parse(appState)).not.toThrow()
  })
})

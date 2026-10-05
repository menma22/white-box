import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkExpire, prepareQuit, restoreOpenSession } from '../src/app/lifecycle.js'
import { createSession, startBreak } from '../src/domain/session-ops.js'
import { createTicker } from '../src/infra/ticker.js'
import { fakeCtx, task } from './helpers.js'

afterEach(() => vi.useRealTimers())

describe('終了中の計測', () => {
  it.each(['timer', 'pomodoro'] as const)('終了中の%s満了は保存済みセッションを変えず確認窓も出さない', (mode) => {
    const ctx = fakeCtx()
    ctx.store.data.tasks = [task({ id: 't' })]
    const session = createSession({ taskId: 't', taskTitle: 'T', mode, plannedMs: 1000, now: ctx.now(), pomodoroAutoResume: true })
    ctx.store.data.sessions = [session]
    ctx.advance(2000)
    ctx.runtime.quitting = true
    checkExpire(ctx)
    expect(ctx.store.data.sessions[0]).toBe(session)
    expect(ctx.calls).toEqual([])
  })

  it.each(['preparingQuit', 'quitting'] as const)('%s中の自動再開する休憩は計測を再開せず復旧も始めない', (stage) => {
    const ctx = fakeCtx()
    ctx.store.data.tasks = [task({ id: 't' })]
    const session = startBreak(createSession({ taskId: 't', taskTitle: 'T', mode: 'pomodoro', plannedMs: 1500000, now: ctx.now(), pomodoroAutoResume: true }), 1, ctx.now())
    ctx.store.data.sessions = [session]
    ctx.advance(120000)
    ctx.runtime[stage] = true
    checkExpire(ctx)
    restoreOpenSession(ctx)
    expect(ctx.store.data.sessions[0]).toBe(session)
    expect(ctx.calls).toEqual([])
  })

  it('終了前の入力保存中は休憩から自動再開せず、終了を撤回したら通常どおり再開する', () => {
    const ctx = fakeCtx()
    ctx.store.data.tasks = [task({ id: 't' })]
    const session = startBreak(createSession({ taskId: 't', taskTitle: 'T', mode: 'pomodoro', plannedMs: 1500000, now: ctx.now(), pomodoroAutoResume: true }), 1, ctx.now())
    ctx.store.data.sessions = [session]
    ctx.advance(120000)
    ctx.runtime.preparingQuit = true
    checkExpire(ctx)
    expect(ctx.store.data.sessions[0]).toBe(session)
    expect(ctx.calls).toEqual([])
    ctx.runtime.preparingQuit = false
    checkExpire(ctx)
    expect(ctx.store.data.sessions[0]?.state).toBe('running')
    expect(ctx.calls).toEqual(['publish'])
  })

  it('終了の保存は全フィールドを保持し、保存中から処理を禁止してから毎秒処理を止める', () => {
    const ctx = fakeCtx()
    const before = structuredClone(ctx.store.data)
    ctx.store.save = () => { expect(ctx.runtime.quitting).toBe(true); ctx.calls.push('save') }
    prepareQuit(ctx)
    expect(ctx.calls).toEqual(['markAlive', 'save', 'ticker:stop'])
    expect(ctx.store.data).toEqual(before)
    expect(ctx.runtime.quitting).toBe(true)
  })

  it('保存失敗は元の例外を返し、終了を撤回して既存の計測を止めない', () => {
    const ctx = fakeCtx()
    const error = new Error('disk full')
    const before = structuredClone(ctx.store.data)
    ctx.store.save = () => { throw error }
    let caught: unknown
    try { prepareQuit(ctx) } catch (cause) { caught = cause }
    expect(caught).toBe(error)
    expect(ctx.runtime.quitting).toBe(false)
    expect(ctx.calls).toEqual(['markAlive'])
    expect(ctx.store.data).toEqual(before)
  })

  it('終了後に届く毎秒処理や再startは何も実行せず、通常の刻みは動く', () => {
    vi.useFakeTimers()
    let enabled = true
    const tick = vi.fn()
    const ticker = createTicker(tick, () => enabled)
    ticker.start()
    vi.advanceTimersByTime(1000)
    expect(tick).toHaveBeenCalledTimes(1)
    enabled = false
    vi.advanceTimersByTime(1000)
    expect(tick).toHaveBeenCalledTimes(1)
    ticker.stop()
    ticker.start()
    vi.advanceTimersByTime(3000)
    expect(tick).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

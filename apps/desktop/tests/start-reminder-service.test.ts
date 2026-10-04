import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStartReminderService } from '../src/infra/start-reminder-service.js'
import { createSession } from '../src/domain/session-ops.js'
import { fakeCtx } from './helpers.js'

const input = vi.hoisted(() => ({ starts: 0, stops: 0, failOnStart: false, count: null as ((count: number) => void) | null, error: null as ((error: Error) => void) | null }))
const native = vi.hoisted(() => ({ notices: [] as { shown: boolean; closed: boolean; emit(event: string): boolean }[] }))
vi.mock('../src/infra/input-activity.js', () => ({ watchInputActivity: (count: (count: number) => void, error: (error: Error) => void) => {
  input.starts++; input.count = count; input.error = error
  if (input.failOnStart) error(new Error('helper unavailable'))
  return () => { input.stops++ }
} }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { Notification: class extends EventEmitter {
    static isSupported() { return true }
    shown = false
    closed = false
    constructor(_options: { title: string; body: string }) { super(); native.notices.push(this) }
    show() { this.shown = true }
    close() { this.closed = true; this.emit('close') }
  } }
})

beforeEach(() => { input.starts = 0; input.stops = 0; input.failOnStart = false; input.count = null; input.error = null; native.notices = [] })
afterEach(() => vi.restoreAllMocks())

describe('開始通知の監視を設定へつなぐ', () => {
  it('入力サンプルの間に開始・終了したセッションも、開始前の入力をリセットする', () => {
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    ctx.store.data.settings.startReminderMinutes = 1
    const service = createStartReminderService(ctx)
    input.count!(12)
    ctx.advance(59000)
    ctx.store.data.sessions = [createSession({ taskId: 't', taskTitle: 'T', plannedMs: 60000, now: ctx.now() })]
    service.refresh()
    ctx.advance(1000)
    ctx.store.data.sessions = []
    service.refresh()
    input.count!(1)
    expect(native.notices).toHaveLength(0)
    service.stop()
  })

  it('起動時に同期エラーが起きてもOFFと停止を維持し、次にONにすれば再起動できる', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    input.failOnStart = true
    const service = createStartReminderService(ctx)
    expect(ctx.store.data.settings.remindToStart).toBe(false)
    expect(input.stops).toBe(1)
    input.failOnStart = false
    ctx.store.data.settings.remindToStart = true
    service.refresh()
    expect(input.starts).toBe(2)
    service.stop()
    expect(input.stops).toBe(2)
  })

  it('停止後に届いた監視callbackは通知せず、再開した監視をOFFにしない', () => {
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    ctx.store.data.settings.startReminderMinutes = 1
    const service = createStartReminderService(ctx)
    const oldCount = input.count!, oldError = input.error!
    oldCount(12)
    ctx.store.data.settings.remindToStart = false
    service.refresh()
    ctx.advance(60000)
    oldCount(12)
    expect(native.notices).toHaveLength(0)
    ctx.store.data.settings.remindToStart = true
    service.refresh()
    oldError(new Error('old helper exited'))
    expect(ctx.store.data.settings.remindToStart).toBe(true)
    const currentCount = input.count!
    currentCount(12)
    service.stop()
    ctx.advance(60000)
    currentCount(12)
    expect(native.notices).toHaveLength(0)
  })

  it('OFFでは表示済み通知も閉じ、古い通知クリックは開始画面を開かない', () => {
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    ctx.store.data.settings.startReminderMinutes = 1
    const service = createStartReminderService(ctx)
    input.count!(12); ctx.advance(60000); input.count!(1)
    expect(native.notices).toHaveLength(1)
    ctx.store.data.settings.remindToStart = false
    service.refresh()
    expect(native.notices[0]!.closed).toBe(true)
    native.notices[0]!.emit('click')
    expect(ctx.calls).not.toContain('open:start')
    service.stop()
  })

  it('OFFでは監視せず、ONを繰り返しても1つだけ起動し、OFFと終了で止める', () => {
    const ctx = fakeCtx()
    const service = createStartReminderService(ctx)
    expect(input.starts).toBe(0)
    ctx.store.data.settings.remindToStart = true
    service.refresh(); service.refresh()
    expect(input.starts).toBe(1)
    ctx.store.data.settings.remindToStart = false
    service.refresh()
    expect(input.stops).toBe(1)
    ctx.store.data.settings.remindToStart = true
    service.refresh()
    service.stop(); service.refresh()
    expect([input.starts, input.stops]).toEqual([2, 2])
  })

  it('既定3分と12回を満たした通知から開始画面を開き、30分は繰り返さない', () => {
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    const service = createStartReminderService(ctx)
    input.count!(2)
    for (let i = 0; i < 5; i++) { ctx.advance(30000); input.count!(2) }
    expect(native.notices).toHaveLength(0)
    ctx.advance(30000); input.count!(2)
    expect(native.notices).toHaveLength(1)
    expect(native.notices[0]!.shown).toBe(true)
    native.notices[0]!.emit('click')
    expect(ctx.calls).toContain('open:start')
    ctx.advance(30000); input.count!(20)
    expect(native.notices).toHaveLength(1)
    service.stop()
    expect(native.notices[0]!.closed).toBe(true)
  })

  it('セッション中の入力を通知に使わず、終了後は新しい入力から計る', () => {
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    ctx.store.data.settings.startReminderMinutes = 1
    ctx.store.data.sessions = [createSession({ taskId: 't', taskTitle: 'T', plannedMs: 60000, now: ctx.now() })]
    const service = createStartReminderService(ctx)
    input.count!(30); ctx.advance(60000); input.count!(30)
    expect(native.notices).toHaveLength(0)
    ctx.store.data.sessions = []
    input.count!(30)
    expect(native.notices).toHaveLength(0)
    ctx.advance(60000); input.count!(1)
    expect(native.notices).toHaveLength(1)
    service.stop()
  })

  it('監視エラーでOFFへ戻して配布し、起動中のhelperを止める', () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = fakeCtx()
    ctx.store.data.settings.remindToStart = true
    const service = createStartReminderService(ctx)
    ctx.publish = () => { ctx.calls.push('publish'); service.refresh() }
    input.error!(new Error('helper failed'))
    expect(ctx.store.data.settings.remindToStart).toBe(false)
    expect(ctx.calls).toContain('publish')
    expect(input.stops).toBe(1)
    expect(errorLog).toHaveBeenCalledOnce()
    service.stop()
  })
})

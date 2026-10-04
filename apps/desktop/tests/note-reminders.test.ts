import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note } from '@white-box/core/notes'
import { createNoteReminders } from '../src/infra/note-reminders.js'
import { normalizeDatabase } from '../src/infra/store.js'
import { emptyDb, fakeCtx } from './helpers.js'

const native = vi.hoisted(() => ({
  supported: true,
  notices: [] as { title: string; body: string; shown: boolean; closed: boolean; emit(event: string): boolean }[],
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { getPath: () => process.env.TEMP ?? '' },
    Notification: class extends EventEmitter {
      static isSupported() { return native.supported }
      title: string
      body: string
      shown = false
      closed = false
      constructor(options: { title: string; body: string }) { super(); this.title = options.title; this.body = options.body; native.notices.push(this) }
      show() { this.shown = true }
      close() { this.closed = true; this.emit('close') }
    },
  }
})
function note(id: string, remindAt: number, patch: Partial<Note> = {}): Note {
  return { id, title: id, body: '本文', projectId: null, taskId: null, pinned: false, archived: false, remindAt, remindedAt: null, createdAt: 0, updatedAt: 0, ...patch }
}

describe('窓に依存しないノート通知', () => {
  beforeEach(() => { vi.useFakeTimers(); native.supported = true; native.notices = [] })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it('未通知の期限到達だけを保存して通知し、クリックでメイン画面を開く', () => {
    const ctx = fakeCtx()
    const now = ctx.now()
    ctx.store.data.notes = [note('due', now), note('future', now + 10000), note('archived', now, { archived: true }), note('sent', now, { remindedAt: now })]
    const service = createNoteReminders(ctx)
    expect(native.notices.map((item) => [item.title, item.shown])).toEqual([['due', true]])
    expect(ctx.store.data.notes[0]!.remindedAt).toBe(now)
    expect(ctx.calls).toEqual(['publish'])
    native.notices[0]!.emit('click')
    expect(ctx.calls).toContain('open:main')
    service.stop()
  })

  it('同じ予定は繰り返さず、後から期限に達したノートをタイマーで通知する', () => {
    const ctx = fakeCtx()
    ctx.store.data.notes = [note('due', ctx.now()), note('future', ctx.now() + 10000)]
    const service = createNoteReminders(ctx)
    ctx.advance(5000)
    vi.advanceTimersByTime(5000)
    expect(native.notices).toHaveLength(1)
    ctx.advance(5000)
    vi.advanceTimersByTime(5000)
    expect(native.notices.map((item) => item.title)).toEqual(['due', 'future'])
    expect(ctx.calls.filter((call) => call === 'publish')).toHaveLength(2)
    service.stop()
  })

  it('通知非対応では通知済みにせず、対応後の次の周期で通知する', () => {
    const ctx = fakeCtx()
    ctx.store.data.notes = [note('due', ctx.now())]
    native.supported = false
    const service = createNoteReminders(ctx)
    expect(ctx.store.data.notes[0]!.remindedAt).toBeNull()
    expect(native.notices).toEqual([])
    native.supported = true
    ctx.advance(5000)
    vi.advanceTimersByTime(5000)
    expect(native.notices).toHaveLength(1)
    service.stop()
  })

  it('stopで通知と監視を閉じ、未来の予定が期限に達しても変更しない', () => {
    const ctx = fakeCtx()
    ctx.store.data.notes = [note('due', ctx.now()), note('future', ctx.now() + 10000)]
    const service = createNoteReminders(ctx)
    service.stop()
    expect(vi.getTimerCount()).toBe(0)
    expect(native.notices.every((item) => item.closed)).toBe(true)
    ctx.advance(20000)
    vi.advanceTimersByTime(20000)
    expect(native.notices).toHaveLength(1)
    expect(ctx.store.data.notes[1]!.remindedAt).toBeNull()
  })

  it('編集段階の保存データをDB読み込みで移行し、元の本文を保持する', () => {
    const legacy = { id: 'n', title: '続き', body: '本文', projectId: null, taskId: null, pinned: true, archived: false, createdAt: 0, updatedAt: 0 }
    const payload = { ...emptyDb(), notes: [legacy] }
    expect(normalizeDatabase(JSON.parse(JSON.stringify(payload))).notes).toEqual([{ ...legacy, remindAt: null, remindedAt: null }])
    expect(payload.notes[0]).toEqual(legacy)
  })
})

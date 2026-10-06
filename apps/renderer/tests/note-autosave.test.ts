import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Note, NotePatch } from '@white-box/core/notes'
import { NoteAutosave } from '../src/features/notes/note-autosave.js'

function note(patch: Partial<Note> = {}): Note {
  return { id: 'n', title: '元のタイトル', body: '元の本文', projectId: null, taskId: null, pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 1, updatedAt: 1, ...patch }
}
function pending() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('ノートの自動保存', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('連続入力をまとめ、変更した項目だけを保存する', async () => {
    const save = vi.fn(async (_patch: NotePatch) => {})
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: 'a' })
    await vi.advanceTimersByTimeAsync(400)
    autosave.update({ body: 'ab' })
    await vi.advanceTimersByTimeAsync(599)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save.mock.calls).toEqual([[{ body: 'ab' }]])
    expect(autosave.snapshot().status).toBe('saved')
  })

  it('保存中に続けた入力は古い返事で消えず、順番に保存する', async () => {
    const first = pending(), second = pending()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: '一度目' })
    const flush = autosave.flush()
    autosave.update({ body: 'さらに入力' })
    autosave.receive(note({ body: '一度目', updatedAt: 2 }))
    expect(autosave.snapshot().draft.body).toBe('さらに入力')
    expect(autosave.flush()).toBe(flush)
    first.resolve()
    await Promise.resolve()
    expect(save.mock.calls).toEqual([[{ body: '一度目' }], [{ body: 'さらに入力' }]])
    second.resolve()
    expect(await flush).toBe(true)
    expect(autosave.snapshot()).toMatchObject({ draft: { body: 'さらに入力' }, status: 'saved' })
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('保存中に元の文字へ戻した入力も状態配布で巻き戻らない', async () => {
    const first = pending()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined)
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ title: '途中のタイトル' })
    const flush = autosave.flush()
    autosave.update({ title: '元のタイトル' })
    autosave.receive(note({ title: '途中のタイトル' }))
    expect(autosave.snapshot().draft.title).toBe('元のタイトル')
    first.resolve()
    expect(await flush).toBe(true)
    expect(save.mock.calls).toEqual([[{ title: '途中のタイトル' }], [{ title: '元のタイトル' }]])
  })

  it('他の状態更新から未編集項目を取り込み、編集中の本文を保持する', async () => {
    const save = vi.fn(async (_patch: NotePatch) => {})
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: '書きかけ' })
    autosave.receive(note({ title: '別の窓の変更', pinned: true }))
    expect(autosave.snapshot().draft).toMatchObject({ title: '別の窓の変更', pinned: true, body: '書きかけ' })
    await autosave.flush()
    expect(save.mock.calls).toEqual([[{ body: '書きかけ' }]])
  })

  it('失敗時は入力とエラーを保持し、明示再送で保存する', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('保存先が使えない')).mockResolvedValueOnce(undefined)
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: '失わない' })
    expect(await autosave.flush()).toBe(false)
    expect(autosave.snapshot()).toMatchObject({ draft: { body: '失わない' }, status: 'error', error: '保存先が使えない' })
    expect(await autosave.flush()).toBe(true)
    expect(save.mock.calls).toEqual([[{ body: '失わない' }], [{ body: '失わない' }]])
    expect(autosave.snapshot()).toMatchObject({ status: 'saved', error: '' })
  })

  it('画面を離れる前のflushは保存待ちを即時送信し、追加保存をしない', async () => {
    const save = vi.fn(async (_patch: NotePatch) => {})
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ title: '次の画面へ' })
    expect(await autosave.flush()).toBe(true)
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('別の画面と同じ本文を編集したら自動保存と画面移動を止め、両方を保持する', async () => {
    const save = vi.fn(async (_patch: NotePatch) => {})
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: 'この画面の書きかけ' })
    autosave.receive(note({ body: '別の画面で保存した本文', updatedAt: 2 }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(await autosave.flush()).toBe(false)
    expect(autosave.snapshot()).toMatchObject({ draft: { body: 'この画面の書きかけ' }, conflicts: { body: '別の画面で保存した本文' }, status: 'error' })
    autosave.update({ body: 'この画面でさらに編集' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(await autosave.flush()).toBe(false)
  })

  it('明示的な再保存だけが最新の本文を期待値にして自分の入力を送る', async () => {
    const expected: NotePatch[] = []
    const save = vi.fn(async (patch: NotePatch) => { expected.push(autosave.expected(patch)) })
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: '自分の入力' })
    autosave.receive(note({ body: '別の画面の入力' }))
    expect(await autosave.flush()).toBe(false)
    expect(await autosave.retry()).toBe(true)
    expect(expected).toEqual([{ body: '別の画面の入力' }])
    expect(save.mock.calls).toEqual([[{ body: '自分の入力' }]])
    expect(autosave.snapshot()).toMatchObject({ conflicts: {}, status: 'saved', error: '' })
  })

  it('最新の内容を採用すると競合した本文だけを置き換え、別の変更は保存する', async () => {
    const save = vi.fn(async (_patch: NotePatch) => {})
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: '自分の本文', title: '自分のタイトル' })
    autosave.receive(note({ body: '別の画面の本文' }))
    expect(await autosave.acceptLatest()).toBe(true)
    expect(autosave.snapshot()).toMatchObject({ draft: { title: '自分のタイトル', body: '別の画面の本文' }, conflicts: {}, status: 'saved' })
    expect(save.mock.calls).toEqual([[{ title: '自分のタイトル' }]])
  })

  it('自分の保存の配信は競合にせず、遅れて届く返答で新しい外部保存を消さない', async () => {
    const first = pending()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ body: '自分の保存' })
    const flush = autosave.flush()
    autosave.receive(note({ body: '自分の保存' }))
    expect(autosave.snapshot().conflicts).toEqual({})
    autosave.receive(note({ body: 'その後の外部保存' }))
    first.resolve()
    expect(await flush).toBe(false)
    expect(autosave.snapshot()).toMatchObject({ draft: { body: '自分の保存' }, conflicts: { body: 'その後の外部保存' }, status: 'error' })
    expect(autosave.expected({ body: '自分の保存' })).toEqual({ body: 'その後の外部保存' })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('未編集の本文への外部保存は取り込み、別の項目だけのローカル入力を保存する', async () => {
    const save = vi.fn(async (_patch: NotePatch) => {})
    const autosave = new NoteAutosave(note(), save)
    autosave.update({ title: '自分のタイトル' })
    autosave.receive(note({ body: '別の画面の本文' }))
    expect(await autosave.flush()).toBe(true)
    expect(autosave.snapshot().draft.body).toBe('別の画面の本文')
    expect(save.mock.calls).toEqual([[{ title: '自分のタイトル' }]])
  })

  it('nullable な関連先の期待値は保存中の配信で変えない', async () => {
    const first = pending()
    const autosave = new NoteAutosave(note(), () => first.promise)
    autosave.update({ taskId: 'task' })
    const flush = autosave.flush()
    autosave.receive(note({ taskId: 'task' }))
    expect(autosave.expected({ taskId: 'task' })).toEqual({ taskId: null })
    first.resolve()
    expect(await flush).toBe(true)
  })
})

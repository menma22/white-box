import { describe, expect, it, vi } from 'vitest'
import { OptionalDurationDraft } from '../src/features/task-control/optional-duration-draft.js'

function deferred() {
  let resolve!: () => void
  let reject!: (cause: Error) => void
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('見積入力の保存と画面移動', () => {
  it('blur の保存を画面移動が待ち、失敗した入力とエラーを残す', async () => {
    const pending = deferred()
    const save = vi.fn(() => pending.promise)
    const draft = new OptionalDurationDraft(null, save)
    draft.update('90')
    void draft.save()
    let completed = false
    const flush = draft.flush().then((ok) => { completed = true; return ok })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(draft.snapshot().flushing).toBe(true)
    draft.update('120')
    draft.changeUnit(60)
    expect(draft.snapshot()).toMatchObject({ draft: '90', unit: 1 })
    pending.reject(new Error('保存先に書き込めない'))
    expect(await flush).toBe(false)
    expect(draft.snapshot()).toMatchObject({ draft: '90', error: '保存先に書き込めない', saving: false, flushing: false })
    expect(save).toHaveBeenCalledOnce()
  })
  it('未 blur の入力も flush で保存し、失敗後に再試行できる', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('保存失敗')).mockResolvedValue(undefined)
    const draft = new OptionalDurationDraft(30, save)
    draft.focus(true)
    draft.update('90')
    expect(await draft.flush()).toBe(false)
    draft.receive(30)
    expect(draft.snapshot().draft).toBe('90')
    expect(await draft.flush()).toBe(true)
    expect(save.mock.calls).toEqual([[90], [90]])
    expect(draft.snapshot().error).toBe('')
  })
  it('保存中の配信では入力を置き換えず、追加の入力も保存する', async () => {
    const pending = deferred()
    const save = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined)
    const draft = new OptionalDurationDraft(30, save)
    draft.update('90')
    const saving = draft.save()
    draft.receive(30)
    draft.update('120')
    draft.receive(90)
    expect(draft.snapshot().draft).toBe('120')
    pending.resolve()
    expect(await saving).toBe(true)
    expect(save.mock.calls).toEqual([[90], [120]])
    expect(await draft.flush()).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
  })
  it('単位変更は保存中の値と入力を同じ分数で保持する', async () => {
    const pending = deferred()
    const save = vi.fn(() => pending.promise)
    const draft = new OptionalDurationDraft(null, save)
    draft.update('90')
    const saving = draft.save()
    draft.changeUnit(60)
    expect(draft.snapshot()).toMatchObject({ draft: '1.5', unit: 60 })
    pending.resolve()
    expect(await saving).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(90)
  })
  it('空欄と明示した 0 を区別し、不正値では画面移動を止める', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const draft = new OptionalDurationDraft(null, save)
    draft.update('0')
    expect(await draft.flush()).toBe(true)
    draft.update('')
    expect(await draft.flush()).toBe(true)
    expect(save.mock.calls).toEqual([[0], [null]])
    for (const [text, badInput] of [['-1', false], ['1e999', false], ['', true]] as const) {
      draft.update(text, badInput)
      expect(await draft.flush()).toBe(false)
      expect(draft.snapshot().draft).toBe(text)
      expect(draft.snapshot().error).toContain('0 以上')
    }
    expect(save).toHaveBeenCalledTimes(2)
  })
  it('未編集の欄だけは別画面で保存された値を受け取る', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const draft = new OptionalDurationDraft(30, save)
    draft.changeUnit(60)
    draft.receive(90)
    expect(draft.snapshot().draft).toBe('1.5')
    expect(await draft.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })
})

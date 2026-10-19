import { describe, expect, it, vi } from 'vitest'
import { TaskControlDraft } from '../src/features/board/task-control-draft.js'

function deferred() {
  let resolve!: (value: boolean) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<boolean>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

const external = { who: '担当者', what: '確認', since: '2026-10-06', lastContactOn: null, nextFollowUpOn: null }

describe('待ち状態の保存と画面移動', () => {
  it('理由の保存中は移動を待ち、false 失敗と古い通知でも入力を残す', async () => {
    const pending = deferred()
    const save = vi.fn(() => pending.promise)
    const draft = new TaskControlDraft('元の理由', save)
    draft.updateReason('新しい理由')
    void draft.saveReason()
    let completed = false
    const closing = draft.flush().then((saved) => { completed = true; return saved })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(draft.snapshot().flushing).toBe(true)
    draft.updateReason('移動中の変更')
    expect(draft.snapshot().reason).toBe('新しい理由')
    pending.resolve(false)
    expect(await closing).toBe(false)
    draft.receiveReason('元の理由')
    expect(draft.snapshot()).toEqual({ reason: '新しい理由', externalSaving: false, externalFailed: false, flushing: false })
    expect(save.mock.calls).toEqual([[{ blockReason: '新しい理由' }]])
  })

  it('理由保存中の追加入力を自身の通知で消さず、後続保存も完了する', async () => {
    const pending = deferred()
    const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(true)
    const draft = new TaskControlDraft('元', save)
    draft.updateReason('途中')
    const saving = draft.saveReason()
    draft.updateReason('最後まで入力')
    draft.receiveReason('途中')
    expect(draft.snapshot().reason).toBe('最後まで入力')
    const closing = draft.flush()
    pending.resolve(true)
    expect(await saving).toBe(true)
    expect(await closing).toBe(true)
    expect(save.mock.calls).toEqual([[{ blockReason: '途中' }], [{ blockReason: '最後まで入力' }]])
  })

  it('理由の失敗を再試行でき、空欄への解除も保存する', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('書き込めない')).mockResolvedValue(true)
    const draft = new TaskControlDraft('元', save)
    draft.updateReason('残す理由')
    expect(await draft.flush()).toBe(false)
    draft.receiveReason('元')
    expect(draft.snapshot().reason).toBe('残す理由')
    expect(await draft.flush()).toBe(true)
    draft.updateReason('')
    expect(await draft.flush()).toBe(true)
    expect(save.mock.calls).toEqual([[{ blockReason: '残す理由' }], [{ blockReason: '残す理由' }], [{ blockReason: '' }]])
  })

  it('未編集の理由は通知へ追従し、未提出の外部フォームを自動保存しない', async () => {
    const save = vi.fn().mockResolvedValue(true)
    const draft = new TaskControlDraft('元', save)
    draft.receiveReason('更新された理由')
    expect(draft.snapshot().reason).toBe('更新された理由')
    expect(await draft.flush()).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it('提出済み外部待ちの保存を待ち、失敗は明示キャンセルまで移動を止める', async () => {
    const pending = deferred()
    const save = vi.fn(() => pending.promise)
    const draft = new TaskControlDraft('', save)
    const submitted = draft.submitExternal(external)
    let completed = false
    const closing = draft.flush().then((saved) => { completed = true; return saved })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(draft.snapshot()).toMatchObject({ externalSaving: true, flushing: true })
    draft.cancelExternal()
    pending.resolve(false)
    expect(await submitted).toBe(false)
    expect(await closing).toBe(false)
    expect(draft.snapshot().externalFailed).toBe(true)
    expect(await draft.flush()).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    draft.cancelExternal()
    expect(await draft.flush()).toBe(true)
    expect(draft.snapshot().externalFailed).toBe(false)
  })

  it('外部待ちの明示再保存を許可し、重複提出せず、成功後は移動できる', async () => {
    const pending = deferred()
    const save = vi.fn().mockResolvedValueOnce(false).mockReturnValueOnce(pending.promise)
    const draft = new TaskControlDraft('', save)
    expect(await draft.submitExternal(external)).toBe(false)
    const retry = draft.submitExternal({ ...external, what: '再確認' })
    expect(draft.submitExternal(external)).toBe(retry)
    const closing = draft.flush()
    pending.resolve(true)
    expect(await retry).toBe(true)
    expect(await closing).toBe(true)
    expect(save.mock.calls).toEqual([[{ externalBlock: external }], [{ externalBlock: { ...external, what: '再確認' } }]])
  })

  it('理由が失敗しても同時提出した外部待ちの終了を待つ', async () => {
    const pending = deferred()
    const save = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(false)
    const draft = new TaskControlDraft('元', save)
    void draft.submitExternal(external)
    draft.updateReason('変更')
    let completed = false
    const closing = draft.flush().then((saved) => { completed = true; return saved })
    await Promise.resolve()
    await Promise.resolve()
    expect(completed).toBe(false)
    pending.resolve(true)
    expect(await closing).toBe(false)
    expect(draft.snapshot().reason).toBe('変更')
  })
})

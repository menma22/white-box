import { describe, expect, it } from 'vitest'
import { EditorFlush } from '../src/lib/editor-flush.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('EditorFlush', () => {
  it('freezes before awaiting saves and keeps the successful lease until backend release', async () => {
    const save = deferred<boolean>()
    const controller = new EditorFlush(() => save.promise, () => {})
    const request = controller.prepare('close-current')
    expect(controller.snapshot().frozen).toBe(true)
    save.resolve(true)
    expect(await request).toBe(true)
    expect(controller.snapshot().frozen).toBe(true)
    controller.release('close-current')
    expect(controller.snapshot().frozen).toBe(false)
  })

  it('a failed request releases its own lease and exposes the retained-input error', async () => {
    const controller = new EditorFlush(async () => false, () => {})
    expect(await controller.prepare('close-current')).toBe(false)
    expect(controller.snapshot()).toEqual({ frozen: false, error: expect.stringContaining('入力を保持') })
  })

  it('releasing another request cannot unfreeze an outstanding operation', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    let calls = 0
    const controller = new EditorFlush(() => ++calls === 1 ? first.promise : second.promise, () => {})
    const one = controller.prepare('one')
    const two = controller.prepare('two')
    first.resolve(true)
    expect(await one).toBe(true)
    controller.release('unknown')
    controller.release('one')
    expect(controller.snapshot().frozen).toBe(true)
    second.resolve(false)
    expect(await two).toBe(false)
    expect(controller.snapshot().frozen).toBe(false)
  })

  it('an exception vetoes the operation and does not leave the editor frozen', async () => {
    const controller = new EditorFlush(async () => { throw new Error('disk unavailable') }, () => {})
    expect(await controller.prepare('quit')).toBe(false)
    expect(controller.snapshot().frozen).toBe(false)
    expect(controller.snapshot().error).toContain('disk unavailable')
  })

  it('local navigation stays frozen across later saves and until navigation completes', async () => {
    const laterSave = deferred<boolean>()
    const navigation = deferred<void>()
    const actionStarted = deferred<void>()
    let firstSaved = false
    let navigated = false
    const controller = new EditorFlush(async () => { firstSaved = true; return laterSave.promise }, () => {})
    const leaving = controller.run('local', async () => { navigated = true; actionStarted.resolve(); await navigation.promise })
    expect(firstSaved).toBe(true)
    expect(controller.snapshot().frozen).toBe(true)
    expect(await controller.run('second navigation', () => {})).toBe(false)
    laterSave.resolve(true)
    await actionStarted.promise
    expect(navigated).toBe(true)
    expect(controller.snapshot().frozen).toBe(true)
    navigation.resolve()
    expect(await leaving).toBe(true)
    expect(controller.snapshot().frozen).toBe(false)
  })

  it('a failed local save retains input and cancels navigation', async () => {
    let navigated = false
    const controller = new EditorFlush(async () => false, () => {})
    expect(await controller.run('local', () => { navigated = true })).toBe(false)
    expect(navigated).toBe(false)
    expect(controller.snapshot()).toMatchObject({ frozen: false, error: expect.stringContaining('入力を保持') })
  })
})

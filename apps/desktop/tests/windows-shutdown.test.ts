import { afterEach, describe, expect, it, vi } from 'vitest'
import { allWindows, closeWindowsLater, getWindow, openWindow, setWindowOpeningGuard, setWindowCloseGuard, toggleWindow } from '../src/infra/windows.js'

const native = vi.hoisted(() => ({ created: 0, shows: 0 }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: class extends EventEmitter {
      webContents = { setWindowOpenHandler: vi.fn() }
      destroyed = false
      constructor() { super(); native.created++ }
      isDestroyed() { return this.destroyed }
      isVisible() { return false }
      isFocused() { return false }
      isMinimized() { return false }
      getSize() { return [800, 600] }
      setPosition() {}
      setAlwaysOnTop() {}
      loadFile() { return Promise.resolve() }
      show() { native.shows++ }
      showInactive() { native.shows++ }
      focus() {}
      close() {
        let prevented = false
        this.emit('close', { preventDefault: () => { prevented = true } })
        if (!prevented) {
          this.destroyed = true
          this.emit('closed')
        }
      }
    },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  }
})

afterEach(() => {
  vi.useRealTimers()
  setWindowCloseGuard(async () => () => {}, () => true)
  for (const win of allWindows()) win.close()
  setWindowOpeningGuard(() => true)
  setWindowCloseGuard(async () => () => {})
})

describe('予約した窓の遅延close', () => {
  it('does not close a reopened window when a second close request remains queued', async () => {
    vi.useFakeTimers()
    const original = openWindow('current')!
    closeWindowsLater('current')
    await vi.advanceTimersByTimeAsync(100)
    closeWindowsLater('current')
    await vi.advanceTimersByTimeAsync(50)
    expect(original.isDestroyed()).toBe(true)
    const reopened = openWindow('current')!
    const close = vi.spyOn(reopened, 'close')
    await vi.advanceTimersByTimeAsync(100)
    expect(close).not.toHaveBeenCalled()
    expect(getWindow('current')).toBe(reopened)
  })

  it('preserves the 150 ms delay and native input preparation for the original window', async () => {
    vi.useFakeTimers()
    const original = openWindow('current')!
    const prepare = vi.fn(async () => () => {})
    setWindowCloseGuard(prepare)
    closeWindowsLater('current')
    await vi.advanceTimersByTimeAsync(149)
    expect(prepare).not.toHaveBeenCalled()
    expect(original.isDestroyed()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(prepare).toHaveBeenCalledWith('current')
    expect(original.isDestroyed()).toBe(true)
  })

  it('does not call close again when the original window was already destroyed', async () => {
    vi.useFakeTimers()
    const original = openWindow('current')!
    const close = vi.spyOn(original, 'close')
    closeWindowsLater('current')
    original.close()
    await Promise.resolve()
    await Promise.resolve()
    close.mockClear()
    await vi.advanceTimersByTimeAsync(150)
    expect(close).not.toHaveBeenCalled()
  })

  it('does not close a window created after a request with no existing window', async () => {
    vi.useFakeTimers()
    closeWindowsLater('current')
    const created = openWindow('current')!
    const close = vi.spyOn(created, 'close')
    await vi.advanceTimersByTimeAsync(150)
    expect(close).not.toHaveBeenCalled()
    expect(getWindow('current')).toBe(created)
  })

  it.each(['preparingQuit', 'quitting'] as const)('does not close while runtime.%s becomes active before the callback', async (state) => {
    vi.useFakeTimers()
    const runtime = { preparingQuit: false, quitting: false }
    setWindowOpeningGuard(() => !runtime.preparingQuit && !runtime.quitting)
    const original = openWindow('current')!
    const close = vi.spyOn(original, 'close')
    closeWindowsLater('current')
    runtime[state] = true
    await vi.advanceTimersByTimeAsync(150)
    expect(close).not.toHaveBeenCalled()
    expect(getWindow('current')).toBe(original)
  })
})

describe('終了中の窓', () => {
  it('does not begin native close preparation while quit preparation is active', async () => {
    const win = openWindow('current')!
    const prepare = vi.fn(async () => () => {})
    const closed = vi.fn()
    win.on('closed', closed)
    setWindowCloseGuard(prepare, () => false, () => false)
    win.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(prepare).not.toHaveBeenCalled()
    expect(closed).not.toHaveBeenCalled()
    expect(getWindow('current')).toBe(win)
  })

  it('releases input without closing when quit preparation starts during the save acknowledgement', async () => {
    const win = openWindow('current')!
    let allowed = true
    let acknowledge!: (release: (closing?: string[]) => void) => void
    const pending = new Promise<(closing?: string[]) => void>((resolve) => { acknowledge = resolve })
    const prepare = vi.fn(() => pending)
    const release = vi.fn()
    const closed = vi.fn()
    win.on('closed', closed)
    setWindowCloseGuard(prepare, () => false, () => allowed)
    win.close()
    expect(prepare).toHaveBeenCalledOnce()
    allowed = false
    acknowledge(release)
    await Promise.resolve()
    await Promise.resolve()
    expect(release).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledWith()
    expect(closed).not.toHaveBeenCalled()
    expect(getWindow('current')).toBe(win)
  })

  it('allows retrying native close after quit preparation is cancelled', async () => {
    const win = openWindow('current')!
    let allowed = true
    let acknowledge!: (release: (closing?: string[]) => void) => void
    const pending = new Promise<(closing?: string[]) => void>((resolve) => { acknowledge = resolve })
    const release = vi.fn()
    const prepare = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(release)
    const closed = vi.fn()
    win.on('closed', closed)
    setWindowCloseGuard(prepare, () => false, () => allowed)
    win.close()
    allowed = false
    acknowledge(release)
    await Promise.resolve()
    await Promise.resolve()
    expect(getWindow('current')).toBe(win)
    allowed = true
    win.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenNthCalledWith(1)
    expect(release).toHaveBeenNthCalledWith(2, ['current'])
    expect(closed).toHaveBeenCalledOnce()
    expect(getWindow('current')).toBeNull()
  })

  it('allows native close after the final quit save without another editor preparation', () => {
    const win = openWindow('current')!
    const prepare = vi.fn(async () => () => {})
    const closed = vi.fn()
    win.on('closed', closed)
    setWindowCloseGuard(prepare, () => true, () => false)
    win.close()
    expect(prepare).not.toHaveBeenCalled()
    expect(closed).toHaveBeenCalledOnce()
    expect(getWindow('current')).toBeNull()
  })

  it('native close waits for input and a failed save keeps the window open for retry', async () => {
    const win = openWindow('current')!
    const closed = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    win.on('closed', closed)
    setWindowOpeningGuard(() => false)
    setWindowCloseGuard(async () => { throw new Error('保存できない') })
    win.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(closed).not.toHaveBeenCalled()
    const release = vi.fn()
    setWindowCloseGuard(async () => release)
    win.close()
    expect(closed).not.toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
    expect(closed).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledWith(['current'])
    error.mockRestore()
  })
  it('直接openとtoggleの両方から新しい窓を作れない', () => {
    setWindowOpeningGuard(() => false)
    const before = native.created
    expect(openWindow('expire')).toBeNull()
    toggleWindow('review')
    expect(native.created).toBe(before)
  })

  it('既存窓を再表示せず、読み込み完了が遅れて届いても表示しない', () => {
    let allowed = true
    setWindowOpeningGuard(() => allowed)
    const win = openWindow('main')!
    win.emit('ready-to-show')
    const shown = native.shows
    allowed = false
    expect(openWindow('main')).toBeNull()
    const loading = openWindow('current')
    expect(loading).toBeNull()
    expect(native.shows).toBe(shown)
    win.emit('closed')
    allowed = true
    const late = openWindow('main')!
    allowed = false
    late.emit('ready-to-show')
    expect(native.shows).toBe(shown)
    late.emit('closed')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWindow, setWindowOpeningGuard, setWindowCloseGuard, toggleWindow } from '../src/infra/windows.js'

const native = vi.hoisted(() => ({ created: 0, shows: 0 }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    BrowserWindow: class extends EventEmitter {
      webContents = { setWindowOpenHandler: vi.fn() }
      constructor() { super(); native.created++ }
      isDestroyed() { return false }
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
        if (!prevented) this.emit('closed')
      }
    },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  }
})

afterEach(() => { setWindowOpeningGuard(() => true); setWindowCloseGuard(async () => () => {}) })

describe('終了中の窓', () => {
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

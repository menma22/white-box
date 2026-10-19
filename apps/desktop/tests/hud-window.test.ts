import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => {
  class Window {
    bounds = { x: 0, y: 0, width: 96, height: 36 }
    visible = false
    destroyed = false
    listeners = new Map<string, Array<() => void>>()
    webContents = { on: vi.fn(), insertCSS: vi.fn(), setWindowOpenHandler: vi.fn() }
    setAlwaysOnTop = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    loadFile = vi.fn(async () => undefined)
    getSize() { return [this.bounds.width, this.bounds.height] }
    getBounds() { return { ...this.bounds } }
    setPosition(x: number, y: number) { this.bounds.x = x; this.bounds.y = y; this.bounds.height += 2 }
    setBounds(bounds: typeof this.bounds) { this.bounds = { ...bounds } }
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    showInactive() { this.visible = true }
    isMinimized() { return false }
    on(name: string, handler: () => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler])
    }
    once(name: string, handler: () => void) { this.on(name, handler) }
    emit(name: string) { this.listeners.get(name)?.forEach((handler) => handler()) }
    close() { this.destroyed = true; this.emit('closed') }
  }
  return {
    Window,
    cursor: { x: 2200, y: 400 },
    area: { x: 0, y: 0, width: 1280, height: 750 },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: desktop.Window,
  screen: {
    getPrimaryDisplay: () => ({ workArea: desktop.area }),
    getCursorScreenPoint: () => desktop.cursor,
    getDisplayNearestPoint: () => ({ workArea: { x: 1280, y: 0, width: 1280, height: 750 } }),
  },
  shell: {},
}))

import { closeWindow, openWindow } from '../src/infra/windows.js'

function openHud() {
  const win = openWindow('hud', false) as unknown as InstanceType<typeof desktop.Window>
  win.emit('ready-to-show')
  return win
}

beforeEach(() => {
  vi.useFakeTimers()
  desktop.cursor = { x: 2200, y: 400 }
  desktop.area = { x: 0, y: 0, width: 1280, height: 750 }
})
afterEach(() => {
  closeWindow('hud')
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('session card placement', () => {
  it('stays above the primary taskbar even when the cursor is on another display', () => {
    const win = openHud()
    expect(win.getBounds()).toEqual({ x: 1176, y: 706, width: 96, height: 36 })
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
  })

  it('moves up one card height, stays while the original region is occupied, and returns on exit', () => {
    const win = openHud()
    desktop.cursor = { x: 1177, y: 710 }
    vi.advanceTimersByTime(400)
    expect(win.getBounds().y).toBe(706)
    desktop.cursor = { x: 1200, y: 720 }
    vi.advanceTimersByTime(400)
    expect(win.getBounds()).toEqual({ x: 1176, y: 680, width: 96, height: 36 })
    vi.advanceTimersByTime(1000)
    expect(win.getBounds().y).toBe(680)
    desktop.cursor = { x: 1200, y: 690 }
    vi.advanceTimersByTime(400)
    expect(win.getBounds()).toMatchObject({ x: 1176, y: 706 })
  })

  it('reverses the slide when the cursor leaves before it completes', () => {
    const win = openHud()
    desktop.cursor = { x: 1200, y: 720 }
    vi.advanceTimersByTime(150)
    expect(win.getBounds().y).toBeLessThan(706)
    desktop.cursor = { x: 1000, y: 500 }
    vi.advanceTimersByTime(400)
    expect(win.getBounds()).toMatchObject({ x: 1176, y: 706 })
  })

  it('follows changes to the primary display work area', () => {
    const win = openHud()
    desktop.area = { x: -1280, y: 0, width: 1280, height: 710 }
    vi.advanceTimersByTime(400)
    expect(win.getBounds()).toMatchObject({ x: -104, y: 666 })
  })
})

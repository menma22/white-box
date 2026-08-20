/**
 * ウィンドウ生成。1 つのレンダラを hash ルート（#start 等）で使い分ける。
 *
 * 最前面 UI は screen-saver レベルで出す（通常の alwaysOnTop では全画面アプリの下に隠れる）。
 */
import { BrowserWindow, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WindowKind } from '../shared/types.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.join(HERE, '..', '..')
const PRELOAD = path.join(APP_ROOT, 'electron', 'preload.cjs')
const ICON = path.join(APP_ROOT, 'assets', 'icon.png')
const DEV_URL = process.env['VITE_DEV_SERVER_URL']

const windows = new Map<WindowKind, BrowserWindow>()

const BG = '#F6F2EA'

interface Spec {
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  frame: boolean
  alwaysOnTop: boolean
  resizable: boolean
  skipTaskbar: boolean
  titleBarOverlay?: boolean
}

const SPECS: Record<WindowKind, Spec> = {
  main: {
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    frame: true,
    alwaysOnTop: false,
    resizable: true,
    skipTaskbar: false,
    titleBarOverlay: true,
  },
  start: { width: 660, height: 500, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true },
  hud: { width: 328, height: 132, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true },
  expire: { width: 480, height: 424, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true },
  review: { width: 900, height: 720, minWidth: 720, minHeight: 560, frame: false, alwaysOnTop: false, resizable: true, skipTaskbar: false },
  current: { width: 760, height: 660, minWidth: 620, minHeight: 480, frame: false, alwaysOnTop: true, resizable: true, skipTaskbar: true },
}

function place(kind: WindowKind, win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const [w, h] = win.getSize() as [number, number]
  if (kind === 'hud') {
    win.setPosition(area.x + area.width - w - 24, area.y + area.height - h - 24)
    return
  }
  if (kind === 'start' || kind === 'expire') {
    win.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + (area.height - h) / 2.6))
    return
  }
  win.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + (area.height - h) / 2))
}

export function getWindow(kind: WindowKind): BrowserWindow | null {
  const win = windows.get(kind)
  return win && !win.isDestroyed() ? win : null
}

export function openWindow(kind: WindowKind, focus = true): BrowserWindow {
  const existing = getWindow(kind)
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    if (focus) existing.show(), existing.focus()
    else existing.showInactive()
    return existing
  }

  const spec = SPECS[kind]
  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    frame: spec.frame,
    resizable: spec.resizable,
    skipTaskbar: spec.skipTaskbar,
    show: false,
    backgroundColor: BG,
    title: 'White Box',
    icon: ICON,
    autoHideMenuBar: true,
    ...(spec.titleBarOverlay
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#F6F2EA', symbolColor: '#6A5F56', height: 48 },
        }
      : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  if (spec.alwaysOnTop) win.setAlwaysOnTop(true, 'screen-saver')

  const hash = `#${kind}`
  if (DEV_URL) {
    void win.loadURL(`${DEV_URL}/${hash}`)
  } else {
    void win.loadFile(path.join(APP_ROOT, 'dist', 'index.html'), { hash: kind })
  }

  win.once('ready-to-show', () => {
    place(kind, win)
    if (focus) win.show()
    else win.showInactive()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => windows.delete(kind))
  windows.set(kind, win)
  return win
}

export function closeWindow(kind: WindowKind): void {
  getWindow(kind)?.close()
}

export function toggleWindow(kind: WindowKind): void {
  const win = getWindow(kind)
  if (win && win.isVisible() && win.isFocused()) win.close()
  else openWindow(kind)
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function allWindows(): BrowserWindow[] {
  return [...windows.values()].filter((w) => !w.isDestroyed())
}

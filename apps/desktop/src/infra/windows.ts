/**
 * ウィンドウ生成。1 つのレンダラを hash ルート（#start 等）で使い分ける。
 *
 * 最前面 UI は screen-saver レベルで出す（通常の alwaysOnTop では全画面アプリの下に隠れる）。
 */
import { BrowserWindow, screen, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WindowKind } from '@white-box/core/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.join(HERE, '..', '..')
const PRELOAD = path.join(APP_ROOT, 'apps', 'desktop', 'src', 'presentation', 'preload.cjs')
const ICON = path.join(APP_ROOT, 'assets', 'icon.png')
const DEV_URL = process.env['VITE_DEV_SERVER_URL']

const windows = new Map<WindowKind, BrowserWindow>()

const BG = '#F6F2EA'
/** 透過窓の地。不透明な色を渡すと窓ごと塗り潰されて裏が見えない */
const TRANSPARENT_BG = '#00000000'
// insertCSS はユーザ由来のスタイルとして入るので、!important が無いと本体の CSS に負けて効かない
const TRANSPARENT_PAGE_CSS =
  'html,body,.boot{background:transparent!important}body::before{content:none!important}'

const HUD_MARGIN = 8
const HUD_FLEE_GAP = 24
const HUD_FLEE_POLL_MS = 90
const HUD_FLEE_MS = 220
const HUD_FLEE_FRAME_MS = 16

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
  transparent?: boolean
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
  hud: {
    width: 248,
    height: 88,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
  },
  expire: { width: 500, height: 458, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true },
  review: { width: 900, height: 720, minWidth: 720, minHeight: 560, frame: false, alwaysOnTop: false, resizable: true, skipTaskbar: false },
  current: { width: 760, height: 660, minWidth: 620, minHeight: 480, frame: false, alwaysOnTop: true, resizable: true, skipTaskbar: true },
}

function place(kind: WindowKind, win: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = display.workArea
  const [w, h] = win.getSize() as [number, number]
  if (kind === 'hud') {
    const [x, y] = hudCorners(win, area)[0]!
    win.setPosition(x, y)
    return
  }
  if (kind === 'start' || kind === 'expire') {
    win.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + (area.height - h) / 2.6))
    return
  }
  win.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + (area.height - h) / 2))
}

/** カードが座れる四隅。先頭が定位置（右下）で、以降は逃げ先の候補 */
function hudCorners(win: BrowserWindow, area: Electron.Rectangle): Array<[number, number]> {
  const [w, h] = win.getSize() as [number, number]
  const left = area.x + HUD_MARGIN
  const right = area.x + area.width - w - HUD_MARGIN
  const top = area.y + HUD_MARGIN
  const bottom = area.y + area.height - h - HUD_MARGIN
  return [
    [right, bottom],
    [left, bottom],
    [right, top],
    [left, top],
  ]
}

// クリックを受け取らない窓なので、カーソルとの近さはメインプロセスで測るしかない
function fleeFromCursor(win: BrowserWindow): void {
  let sliding: NodeJS.Timeout | null = null

  const slideTo = (toX: number, toY: number): void => {
    const from = win.getBounds()
    const startedAt = Date.now()
    sliding = setInterval(() => {
      if (win.isDestroyed()) {
        if (sliding) clearInterval(sliding)
        sliding = null
        return
      }
      const p = Math.min(1, (Date.now() - startedAt) / HUD_FLEE_MS)
      const eased = 1 - Math.pow(1 - p, 3)
      win.setPosition(Math.round(from.x + (toX - from.x) * eased), Math.round(from.y + (toY - from.y) * eased))
      if (p < 1) return
      if (sliding) clearInterval(sliding)
      sliding = null
    }, HUD_FLEE_FRAME_MS)
  }

  const watch = setInterval(() => {
    if (win.isDestroyed() || sliding || !win.isVisible()) return
    const cursor = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const near =
      cursor.x >= b.x - HUD_FLEE_GAP &&
      cursor.x <= b.x + b.width + HUD_FLEE_GAP &&
      cursor.y >= b.y - HUD_FLEE_GAP &&
      cursor.y <= b.y + b.height + HUD_FLEE_GAP
    if (!near) return
    const corners = hudCorners(win, screen.getDisplayMatching(b).workArea)
    const far = corners.reduce((best, c) =>
      Math.hypot(c[0] - cursor.x, c[1] - cursor.y) > Math.hypot(best[0] - cursor.x, best[1] - cursor.y) ? c : best,
    )
    slideTo(far[0], far[1])
  }, HUD_FLEE_POLL_MS)

  win.on('closed', () => {
    clearInterval(watch)
    if (sliding) clearInterval(sliding)
  })
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
    transparent: spec.transparent ?? false,
    backgroundColor: spec.transparent ? TRANSPARENT_BG : BG,
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
  if (kind === 'hud') {
    // カードは見せるだけ。クリックを受けると下の作業を邪魔する（消すのは設定からだけ）
    win.setIgnoreMouseEvents(true)
    fleeFromCursor(win)
    // base.css の地が不透明なので、消さないとカードを描いていない間クリーム色の四角が最前面に残る
    win.webContents.on('dom-ready', () => void win.webContents.insertCSS(TRANSPARENT_PAGE_CSS))
  }

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

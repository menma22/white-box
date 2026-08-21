/**
 * トレイ常駐。表示の材料（実行中セッション・タスク名）は app/state から読む。
 */
import { Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import { activeTaskId, focusMs, formatDuration, isPaused } from '@white-box/core/engine'
import type { Database } from '@white-box/core/types'
import { liveSession, taskTitle } from '../app/state.js'
import { APP_ROOT, openWindow } from './windows.js'

export interface TrayDeps {
  getDb(): Database
  onCommand(name: 'session:pause' | 'session:resume' | 'session:end'): void
  onQuit(): void
}

export function createTray(deps: TrayDeps): { update(): void } {
  const icon = nativeImage.createFromPath(path.join(APP_ROOT, 'assets', 'tray.png'))
  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.on('click', () => openWindow('main'))

  function menu(): Menu {
    const s = liveSession(deps.getDb())
    return Menu.buildFromTemplate([
      { label: 'White Box を開く', click: () => openWindow('main') },
      { label: '現在の仕事', click: () => openWindow('current') },
      { type: 'separator' },
      s
        ? isPaused(s)
          ? { label: '再開', click: () => deps.onCommand('session:resume') }
          : { label: '一時停止', click: () => deps.onCommand('session:pause') }
        : { label: 'セッションを開始', click: () => openWindow('start') },
      ...(s ? [{ label: 'セッションを終了', click: () => deps.onCommand('session:end') }] : []),
      { type: 'separator' },
      { label: '終了', click: () => deps.onQuit() },
    ])
  }

  function update(): void {
    const db = deps.getDb()
    const s = liveSession(db)
    if (!s) {
      tray.setToolTip('White Box — 停止中')
    } else {
      const state = isPaused(s) ? '一時停止' : '実行中'
      tray.setToolTip(
        `White Box — ${state} ${formatDuration(focusMs(s, Date.now()), 'hms')} / ${taskTitle(db, activeTaskId(s) ?? '')}`,
      )
    }
    tray.setContextMenu(menu())
  }

  update()
  return { update }
}

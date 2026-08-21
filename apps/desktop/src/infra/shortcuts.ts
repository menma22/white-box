/**
 * グローバルショートカット。どのアプリを使っていても効く。
 */
import { globalShortcut } from 'electron'
import type { Settings } from '@white-box/core/types'
import { openWindow, toggleWindow } from './windows.js'

export function applyShortcuts(shortcuts: Settings['shortcuts'], onStartPause: () => void): void {
  globalShortcut.unregisterAll()
  const bind = (accel: string, fn: () => void) => {
    if (!accel) return
    try {
      globalShortcut.register(accel, fn)
    } catch (err) {
      console.error('[white-box] ショートカットを登録できません:', accel, err)
    }
  }
  bind(shortcuts.startPause, onStartPause)
  bind(shortcuts.currentWork, () => toggleWindow('current'))
  bind(shortcuts.dashboard, () => openWindow('main'))
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}

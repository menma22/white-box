/**
 * グローバルショートカット。どのアプリを使っていても効く。
 *
 * 空文字（未割り当て）は登録しない。既定は空で、割り当てるのは初回オンボーディングか設定画面。
 */
import { globalShortcut } from 'electron'
import type { Settings } from '@white-box/core/types'
import { openWindow, toggleWindow } from './windows.js'

export function applyShortcuts(shortcuts: Settings['shortcuts'], onStartPause: () => void): void {
  globalShortcut.unregisterAll()
  const bind = (accel: string, fn: () => void) => {
    if (!accel) return
    try {
      // register の戻り値を捨てると、他アプリと衝突して効かないときに何も残らない（例外は出ない）
      if (!globalShortcut.register(accel, fn)) {
        console.error('[white-box] ショートカットを登録できません（ほかのアプリが使っている）:', accel)
      }
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

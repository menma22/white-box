/**
 * データの書き出し・読み込み・保存先を開く。ダイアログとファイル操作の実装詳細。
 */
import { dialog, shell } from 'electron'
import fs from 'node:fs'
import type { Database } from '@white-box/core/types'
import type { DataIOPort } from '../app/ports.js'
import type { Store } from './store.js'

export function createDataIO(store: Store): DataIOPort {
  return {
    async exportData() {
      const res = await dialog.showSaveDialog({
        title: 'データを書き出す',
        defaultPath: `white-box-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (res.canceled || !res.filePath) return null
      fs.writeFileSync(res.filePath, JSON.stringify(store.data, null, 2), 'utf-8')
      return res.filePath
    },

    async importData() {
      const res = await dialog.showOpenDialog({
        title: 'データを読み込む（現在のデータは置き換わります）',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (res.canceled || !res.filePaths[0]) return null
      const confirm = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['読み込む', 'やめる'],
        defaultId: 1,
        cancelId: 1,
        message: '現在のデータを、選んだファイルの内容で置き換えます。',
        detail: '直前のデータは backups フォルダに残ります。',
      })
      if (confirm.response !== 0) return null
      const parsed = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8')) as Database
      store.replace(parsed)
      return res.filePaths[0]
    },

    revealDataDir() {
      void shell.openPath(store.dir)
    },
  }
}

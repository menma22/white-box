/**
 * データの書き出し・読み込み・保存先を開く。ダイアログとファイル操作の実装詳細。
 */
import { dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DataIOPort } from '../app/ports.js'
import type { Store } from './store.js'

export function createDataIO(store: Store, isReady: () => boolean = () => true): DataIOPort {
  return {
    async exportData() {
      const res = await dialog.showSaveDialog({
        title: 'データを書き出す',
        defaultPath: `white-box-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (res.canceled || !res.filePath) return null
      if (!isReady()) throw new Error('アプリを終了中です')
      const resolved = (file: string) => {
        const parent = path.dirname(file)
        const canonical = fs.existsSync(file) ? fs.realpathSync(file) : fs.existsSync(parent) ? path.join(fs.realpathSync(parent), path.basename(file)) : path.resolve(file)
        return process.platform === 'win32' ? canonical.toLowerCase() : canonical
      }
      const destination = resolved(res.filePath)
      const withinBackups = path.relative(resolved(path.join(store.dir, 'backups')), destination)
      const backup = withinBackups === '' || withinBackups !== '..' && !withinBackups.startsWith(`..${path.sep}`) && !path.isAbsolute(withinBackups)
      const quarantine = path.dirname(destination) === resolved(store.dir) && /^data\.corrupt--?\d+\.json$/.test(path.basename(destination))
      if (backup || quarantine || [store.dbPath, store.runtimePath, `${store.dbPath}.tmp`, `${store.runtimePath}.tmp`, path.join(store.dir, 'agent-connection.json')].some((file) => resolved(file) === destination)) {
        throw new Error('アプリの保存ファイルへ書き出すことはできません。別の場所を選んでください。')
      }
      const temporary = `${res.filePath}.whitebox-${randomUUID()}.tmp`
      let created = false
      try {
        const descriptor = fs.openSync(temporary, 'wx')
        created = true
        try {
          fs.writeFileSync(descriptor, JSON.stringify(store.data, null, 2), 'utf-8')
          fs.fsyncSync(descriptor)
        } finally { fs.closeSync(descriptor) }
        fs.renameSync(temporary, res.filePath)
      } finally {
        if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary)
      }
      return res.filePath
    },

    async importData() {
      const res = await dialog.showOpenDialog({
        title: 'データを読み込む（現在のデータは置き換わります）',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (res.canceled || !res.filePaths[0]) return null
      if (!isReady()) throw new Error('アプリを終了中です')
      const confirm = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['読み込む', 'やめる'],
        defaultId: 1,
        cancelId: 1,
        message: '現在のデータを、選んだファイルの内容で置き換えます。',
        detail: '直前のデータは backups フォルダに残ります。',
      })
      if (confirm.response !== 0) return null
      if (!isReady()) throw new Error('アプリを終了中です')
      const parsed: unknown = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8'))
      store.replace(parsed)
      return res.filePaths[0]
    },

    revealDataDir() {
      void shell.openPath(store.dir)
    },
  }
}

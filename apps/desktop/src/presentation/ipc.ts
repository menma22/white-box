/**
 * IPC の受け口。契約（zod）で検証してからユースケースへ渡すだけ。ここに処理を書かない。
 */
import { ipcMain } from 'electron'
import { isCommand, parseArgs } from '@white-box/contracts'
import { dispatch, type Handlers } from '../app/handlers.js'

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle('whitebox:cmd', async (_e, payload: { name?: unknown; args?: unknown }) => {
    const name = typeof payload?.name === 'string' ? payload.name : ''
    try {
      if (!isCommand(name)) throw new Error(`未知のコマンド: ${name}`)
      // 壊れた引数はここで {ok:false} になり、状態に一切触れない
      return { ok: true, data: await dispatch(handlers, name, parseArgs(name, payload.args)) }
    } catch (err) {
      console.error('[white-box] コマンド失敗:', name, err)
      return { ok: false, error: String(err) }
    }
  })
}

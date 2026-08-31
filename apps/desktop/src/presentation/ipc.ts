/**
 * ここに検証や処理を書くと、app 層の receive() と二重実装になり静かにずれる。
 */
import { ipcMain } from 'electron'
import { receive } from '../app/receive.js'
import type { Handlers } from '../app/handlers.js'

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle('whitebox:cmd', async (_e, payload: { name?: unknown; args?: unknown }) => {
    return await receive(handlers, payload?.name, payload?.args)
  })
}

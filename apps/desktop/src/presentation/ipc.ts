/**
 * IPC の受け口。electron の窓口を app 層の receive() に繋ぐだけ。ここに処理を書かない。
 */
import { ipcMain } from 'electron'
import { receive } from '../app/receive.js'
import type { Handlers } from '../app/handlers.js'

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle('whitebox:cmd', async (_e, payload: { name?: unknown; args?: unknown }) => {
    return await receive(handlers, payload?.name, payload?.args)
  })
}

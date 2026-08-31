/**
 * 受け口の中身。契約（zod）で検証してユースケースへ渡し、失敗を {ok:false} にするところまで。
 * electron を import しないこと（ここが破れると受け口の拒否をテストで確かめられなくなる）。
 */
import { isCommand, parseArgs } from '@white-box/contracts'
import { dispatch, type Handlers } from './handlers.js'

export type Reply = { ok: true; data: unknown } | { ok: false; error: string }

export async function receive(handlers: Handlers, name: unknown, args: unknown): Promise<Reply> {
  const cmd = typeof name === 'string' ? name : ''
  try {
    if (!isCommand(cmd)) throw new Error(`未知のコマンド: ${cmd}`)
    // 壊れた引数・通らない申告はここで {ok:false} になり、状態に一切触れない
    return { ok: true, data: await dispatch(handlers, cmd, parseArgs(cmd, args)) }
  } catch (err) {
    console.error('[white-box] コマンド失敗:', cmd, err)
    return { ok: false, error: String(err) }
  }
}

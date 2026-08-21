/**
 * 起動時の復旧と、毎秒の満了判定。どちらも業務ルールなので app 層に置く（electron を知らない）。
 */
import { isPaused, remainingMs } from '@white-box/core/engine'
import * as ops from '../domain/session-ops.js'
import type { Ctx } from './ports.js'
import { liveSession, replaceSession } from './state.js'

/**
 * 異常終了で開いたままのセッションの扱いを決める。
 * 記録の空白が crashGapMs より長ければ「PC が落ちていた」とみなし、最後に生きていた時刻で
 * 一時停止して人間に聞く（recovery）。短ければそのまま計測を続ける。
 */
export function restoreOpenSession(ctx: Ctx, crashGapMs: number): void {
  const s = liveSession(ctx.store.data)
  if (!s) return
  const lastAlive = ctx.store.readLastAlive()
  const gap = lastAlive ? ctx.now() - lastAlive : Infinity
  if (lastAlive && gap > crashGapMs) {
    if (!isPaused(s)) replaceSession(ctx.store.data, ops.pauseSession(s, lastAlive, 'suspend'))
    ctx.runtime.recovery = { sessionId: s.id, lastKnownAt: lastAlive }
    ctx.store.save()
    return
  }
  ctx.ticker.start()
}

/** 予定時間に到達していたら満了の印を付け、満了ポップアップを出す。 */
export function checkExpire(ctx: Ctx): void {
  const s = liveSession(ctx.store.data)
  if (!s) return
  const now = ctx.now()
  if (!isPaused(s) && s.expiredNotifiedAt === null && remainingMs(s, now) <= 0) {
    replaceSession(ctx.store.data, ops.markExpired(s, now))
    ctx.publish()
    ctx.windows.open('expire')
  }
}

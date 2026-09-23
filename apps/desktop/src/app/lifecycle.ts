/**
 * 起動時の復旧と、毎秒の満了判定。どちらも業務ルールなので app 層に置く（electron を知らない）。
 */
import { isPaused, remainingMs } from '@white-box/core/engine'
import * as ops from '../domain/session-ops.js'
import type { Ctx } from './ports.js'
import { buildBreakTimer, liveSession, replaceSession } from './state.js'

/**
 * 異常終了で開いたままのセッションの扱いを決める。
 * 休憩中は復旧確認を出さず、満了監視を再開する。
 * それ以外は、最後の生存記録と最新の操作記録のうち新しい時刻からの空白が
 * crashGapMs より長ければ「PC が落ちていた」とみなし、
 * その時刻で一時停止して人間に聞く（recovery）。短ければそのまま計測を続ける。
 */
export function restoreOpenSession(ctx: Ctx, crashGapMs: number): void {
  const s = liveSession(ctx.store.data)
  if (!s) return
  if (buildBreakTimer(ctx.store.data)) {
    ctx.ticker.start()
    return
  }
  const lastAlive = ctx.store.readLastAlive()
  const lastRecordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
  const lastKnownAt = lastAlive ? Math.max(lastAlive, lastRecordedAt) : null
  const gap = lastKnownAt ? ctx.now() - lastKnownAt : Infinity
  if (lastKnownAt && gap > crashGapMs) {
    if (!isPaused(s)) replaceSession(ctx.store.data, ops.pauseSession(s, lastKnownAt, 'suspend'))
    ctx.runtime.recovery = { sessionId: s.id, lastKnownAt }
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
  const breakTimer = buildBreakTimer(ctx.store.data)
  if (breakTimer && breakTimer.notifiedAt === null && now >= breakTimer.endsAt) {
    replaceSession(ctx.store.data, ops.markBreakExpired(s, now))
    ctx.publish()
    ctx.windows.open('expire')
    return
  }
  if (!isPaused(s) && s.expiredNotifiedAt === null && remainingMs(s, now) <= 0) {
    replaceSession(ctx.store.data, ops.markExpired(s, now))
    ctx.publish()
    ctx.windows.open('expire')
  }
}

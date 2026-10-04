/**
 * 起動時の復旧と、毎秒の満了判定。どちらも業務ルールなので app 層に置く（electron を知らない）。
 */
import { isPaused } from '@white-box/core/engine'
import * as ops from '../domain/session-ops.js'
import type { Ctx } from './ports.js'
import { buildBreakTimer, liveSession, replaceSession } from './state.js'

/**
 * 異常終了で開いたままのセッションの扱いを決める。
 * 整理中は最後の生存・操作記録（現在時刻が上限）で整理区間を閉じる。
 * 他の停止は維持し、無ければその時刻で停止して復旧を聞く。
 * 自動再開しない休憩中は復旧確認を出さず、満了監視を再開する。
 * 自動再開する休憩に長い空白があれば、作業を再開する前に復旧を聞く。
 * それ以外は、最後の生存記録と最新の操作記録のうち新しい時刻からの空白が
 * crashGapMs より長ければ「PC が落ちていた」とみなし、
 * その時刻で一時停止して人間に聞く（recovery）。短ければそのまま計測を続ける。
 */
export function restoreOpenSession(ctx: Ctx, crashGapMs: number): void {
  const s = liveSession(ctx.store.data)
  if (!s) return
  if (s.pauses.some((p) => p.endedAt === null && p.reason === 'task-management')) {
    const recordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
    const lastKnownAt = Math.min(ctx.now(), Math.max(ctx.store.readLastAlive() ?? recordedAt, recordedAt))
    const closed = ops.finishTaskManagement(s, lastKnownAt)
    const restored = ops.pauseSession(closed, lastKnownAt, 'suspend')
    replaceSession(ctx.store.data, restored)
    if (!isPaused(closed)) ctx.runtime.recovery = { sessionId: s.id, lastKnownAt }
    ctx.store.save()
    ctx.ticker.start()
    return
  }
  const lastRecordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
  const lastKnownAt = Math.min(ctx.now(), Math.max(ctx.store.readLastAlive() ?? lastRecordedAt, lastRecordedAt))
  const gap = ctx.now() - lastKnownAt
  if (buildBreakTimer(ctx.store.data) && !(s.mode === 'pomodoro' && s.pomodoroAutoResume && gap > crashGapMs)) {
    ctx.ticker.start()
    return
  }
  if (gap > crashGapMs) {
    if (!isPaused(s)) replaceSession(ctx.store.data, ops.pauseSession(s, lastKnownAt, 'suspend'))
    ctx.runtime.recovery = { sessionId: s.id, lastKnownAt }
    ctx.store.save()
    return
  }
  ctx.ticker.start()
}

/**
 * タイマー満了では作業を止めて確認窓を出し、ポモドーロ満了では休憩に切り替える。
 * 休憩満了は、自動再開が有効なポモドーロで整理・復旧・他の停止がなければ次周期へ進む。
 * それ以外は停止を維持して確認窓を出す。ストップウォッチには作業満了がない。
 */
export function checkExpire(ctx: Ctx): void {
  let s = liveSession(ctx.store.data)
  if (!s) return
  const now = ctx.now()
  const expired = ops.markExpired(s, now)
  if (expired !== s) {
    replaceSession(ctx.store.data, expired)
    s = expired
    ctx.publish()
    if (s.mode !== 'pomodoro') ctx.windows.open('expire')
  }
  const breakTimer = buildBreakTimer(ctx.store.data)
  if (breakTimer && now >= breakTimer.endsAt) {
    const automatic = s.mode === 'pomodoro' && s.pomodoroAutoResume && !ctx.runtime.currentWorkOpen && !ctx.runtime.recovery && !s.pauses.some((p) => p.endedAt === null && p.reason !== 'break')
    if (!automatic && breakTimer.notifiedAt !== null) return
    replaceSession(ctx.store.data, automatic ? ops.resumeSession(s, now) : ops.markBreakExpired(s, now))
    ctx.publish()
    if (!automatic) ctx.windows.open('expire')
    return
  }
}

export function setCurrentWorkOpen(ctx: Ctx, open: boolean): void {
  if (ctx.runtime.quitting || ctx.runtime.currentWorkOpen === open) return
  if (open) checkExpire(ctx)
  ctx.runtime.currentWorkOpen = open
  const session = liveSession(ctx.store.data)
  if (!session) return
  replaceSession(ctx.store.data, open
    ? ops.pauseSession(session, ctx.now(), 'task-management')
    : ops.finishTaskManagement(session, ctx.now()))
  ctx.publish()
  if (!open) checkExpire(ctx)
}

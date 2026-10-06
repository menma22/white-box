/**
 * 起動・取込時の復旧と、毎秒の満了判定。どちらも業務ルールなので app 層に置く（electron を知らない）。
 */
import { activeTaskId, isPaused } from '@white-box/core/engine'
import { taskExecutionProblem } from '@white-box/core/task-control'
import * as ops from '../domain/session-ops.js'
import type { Ctx } from './ports.js'
import { buildBreakTimer, liveSession, replaceSession } from './state.js'
import { commitChanges } from './commit.js'
import type { Session } from '@white-box/core/types'

/** これより長く記録が途切れていたら、PC が落ちていたとみなす。 */
const CRASH_GAP_MS = 90_000

/**
 * 読み込んだデータに開いたままのセッションがあるときの扱いを決める。
 * 実行不能な現在タスクの計測中セッションは、空白の長さによらず最後の記録時刻で停止して復旧を聞く。
 * この保存済みデータの停止は、復旧保存が失敗してもメモリと表示で維持する。
 * 整理中は最後の生存・操作記録（現在時刻が上限）で整理区間を閉じる。
 * 他の停止は維持し、無ければその時刻で停止して復旧を聞く。
 * 自動再開しない休憩中は復旧確認を出さず、満了監視を再開する。
 * 自動再開する休憩に長い空白があれば、作業を再開する前に復旧を聞く。
 * それ以外は、最後の生存記録と最新の操作記録のうち新しい時刻からの空白が
 * crashGapMs より長ければ「PC が落ちていた」とみなし、
 * その時刻で一時停止して人間に聞く（recovery）。短ければそのまま計測を続ける。
 * 取り込みでは useHeartbeat=false とし、置換前データの生存記録を使わない。
 */
export function restoreOpenSession(ctx: Ctx, crashGapMs = CRASH_GAP_MS, options: { useHeartbeat?: boolean } = {}): void {
  if (ctx.runtime.quitting || ctx.runtime.preparingQuit) return
  const s = liveSession(ctx.store.data)
  if (!s) return
  const lastAliveAt = options.useHeartbeat === false ? null : ctx.store.readLastAlive()
  if (taskExecutionProblem(ctx.store.data, activeTaskId(s)) && !isPaused(s)) {
    const recordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
    const lastKnownAt = Math.min(ctx.now(), Math.max(lastAliveAt ?? recordedAt, recordedAt))
    const next = ops.pauseSession(s, lastKnownAt, 'manual')
    const sessions = ctx.store.data.sessions.map((item) => item.id === s.id ? next : item)
    ctx.runtime.recovery = { sessionId: s.id, lastKnownAt }
    commitSafetyStop(ctx, sessions)
    ctx.ticker.start()
    return
  }
  if (s.pauses.some((p) => p.endedAt === null && p.reason === 'task-management')) {
    const recordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
    const lastKnownAt = Math.min(ctx.now(), Math.max(lastAliveAt ?? recordedAt, recordedAt))
    const closed = ops.finishTaskManagement(s, lastKnownAt)
    const restored = ops.pauseSession(closed, lastKnownAt, 'suspend')
    replaceSession(ctx.store.data, restored)
    if (!isPaused(closed)) ctx.runtime.recovery = { sessionId: s.id, lastKnownAt }
    ctx.store.save()
    ctx.ticker.start()
    return
  }
  const lastRecordedAt = s.events.reduce((latest, event) => Math.max(latest, event.at), s.startedAt)
  const lastKnownAt = Math.min(ctx.now(), Math.max(lastAliveAt ?? lastRecordedAt, lastRecordedAt))
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

export function restoreCurrentWorkPause(ctx: Ctx): boolean {
  const session = liveSession(ctx.store.data)
  if (!ctx.runtime.currentWorkOpen || !session) return false
  const next = ops.pauseSession(session, ctx.now(), 'task-management')
  if (next === session) return false
  commitSafetyStop(ctx, ctx.store.data.sessions.map((item) => item.id === session.id ? next : item))
  return true
}

function commitSafetyStop(ctx: Ctx, sessions: Session[]): void {
  try {
    commitChanges(ctx, { sessions })
  } catch (cause) {
    ctx.store.data.sessions = sessions
    ctx.ticker.stop()
    ctx.publish(false)
    throw cause
  }
}

/**
 * タイマー満了では作業を止めて確認窓を出し、ポモドーロ満了では休憩に切り替える。
 * 休憩満了は、自動再開が有効なポモドーロで現在タスクが実行可能かつ整理・復旧・他の停止がなければ次周期へ進む。
 * それ以外は停止を維持して確認窓を出す。ストップウォッチには作業満了がない。
 */
export function checkExpire(ctx: Ctx): void {
  if (ctx.runtime.quitting || ctx.runtime.preparingQuit) return
  let s = liveSession(ctx.store.data)
  if (!s) return
  const now = ctx.now()
  const expired = ops.markExpired(s, now)
  if (expired !== s) {
    commitChanges(ctx, { sessions: ctx.store.data.sessions.map((session) => session.id === expired.id ? expired : session) })
    s = expired
    if (s.mode !== 'pomodoro') ctx.windows.open('expire')
  }
  const breakTimer = buildBreakTimer(ctx.store.data)
  if (breakTimer && now >= breakTimer.endsAt) {
    const automatic = s.mode === 'pomodoro' && s.pomodoroAutoResume && !ctx.runtime.currentWorkOpen && !ctx.runtime.recovery && !taskExecutionProblem(ctx.store.data, activeTaskId(s)) && !s.pauses.some((p) => p.endedAt === null && p.reason !== 'break')
    if (!automatic && breakTimer.notifiedAt !== null) return
    const next = automatic ? ops.resumeSession(s, now) : ops.markBreakExpired(s, now)
    commitChanges(ctx, { sessions: ctx.store.data.sessions.map((session) => session.id === next.id ? next : session) })
    if (!automatic) ctx.windows.open('expire')
    return
  }
}

export function prepareQuit(ctx: Ctx): void {
  ctx.runtime.quitting = true
  try {
    ctx.store.markAlive({ requireSuccess: true })
    ctx.store.save()
  } catch (cause) {
    ctx.runtime.quitting = false
    throw cause
  }
  ctx.ticker.stop()
}

export function setCurrentWorkOpen(ctx: Ctx, open: boolean): void {
  if (ctx.runtime.quitting || ctx.runtime.currentWorkOpen === open) return
  if (open) checkExpire(ctx)
  const wasOpen = ctx.runtime.currentWorkOpen
  ctx.runtime.currentWorkOpen = open
  const session = liveSession(ctx.store.data)
  if (!session) return
  let next = open
    ? ops.pauseSession(session, ctx.now(), 'task-management')
    : ops.finishTaskManagement(session, ctx.now())
  if (!open && taskExecutionProblem(ctx.store.data, activeTaskId(next)) && !isPaused(next)) next = ops.pauseSession(next, ctx.now(), 'manual')
  try {
    commitChanges(ctx, { sessions: ctx.store.data.sessions.map((item) => item.id === session.id ? next : item) })
  } catch (cause) {
    ctx.runtime.currentWorkOpen = wasOpen
    throw cause
  }
  if (!open) checkExpire(ctx)
}

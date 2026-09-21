import type { AppState, LiveTick } from '@shared/types'

export function liveTimerPresentation(tick: LiveTick, breakTimer: AppState['breakTimer'], now: number) {
  if (breakTimer) {
    const plannedMs = breakTimer.endsAt - breakTimer.startedAt
    const remainingMs = Math.max(0, breakTimer.endsAt - now)
    return {
      elapsedMs: Math.min(plannedMs, Math.max(0, now - breakTimer.startedAt)),
      plannedMs,
      remainingMs,
      label: breakTimer.notifiedAt === null ? '休憩' : '休憩終了',
      status: breakTimer.notifiedAt === null ? '休憩中' : '休憩終了',
      isBreak: true,
      isPaused: false,
      isOver: false,
    }
  }

  const isPaused = tick.state === 'paused'
  const isOver = tick.remainingMs < 0
  return {
    elapsedMs: tick.elapsedMs,
    plannedMs: tick.plannedMs,
    remainingMs: tick.remainingMs,
    label: isPaused ? '停止中' : isOver ? '超過' : '残り',
    status: isPaused ? '一時停止' : '実行中',
    isBreak: false,
    isPaused,
    isOver,
  }
}

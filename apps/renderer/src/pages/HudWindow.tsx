import { useApp, useData } from '@/stores/app'
import { formatDuration } from '@white-box/core/engine'
import { liveTimerPresentation } from '@/lib/liveTimer'

// 窓がクリックを素通りさせるので、ここに押せるものを置いても反応しない
export function HudWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const now = useApp((s) => s.now)

  if (!tick || !state.settings.showSessionCard) return null

  const timer = liveTimerPresentation(tick, state.breakTimer, now)
  const remainingRatio = timer.plannedMs > 0 ? Math.max(0, Math.min(1, timer.remainingMs / timer.plannedMs)) : 0
  const outline = 'M44 1.5 H79 A7.5 7.5 0 0 1 86.5 9 V17 A7.5 7.5 0 0 1 79 24.5 H9 A7.5 7.5 0 0 1 1.5 17 V9 A7.5 7.5 0 0 1 9 1.5 Z'

  return (
    <div className="hud">
      <div className={`hud-card ${timer.isPaused ? 'is-paused' : ''} ${timer.isOver ? 'is-over' : ''}`}>
        <svg className="hud-gauge" viewBox="0 0 88 26" aria-hidden="true">
          <path className="hud-gauge-track" d={outline} />
          <path className="hud-gauge-fill" d={outline} pathLength={1} strokeDasharray={`${remainingRatio} 1`} strokeDashoffset={remainingRatio - 1} />
        </svg>
        <span className="hud-slot-value num">{formatDuration(timer.elapsedMs, 'hms')}</span>
      </div>
    </div>
  )
}

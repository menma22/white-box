import { useApp, useData } from '@/stores/app'
import { formatDuration } from '@white-box/core/engine'
import { remainingLabel } from '@/lib/format'
import { liveTimerPresentation } from '@/lib/liveTimer'

// 窓がクリックを素通りさせるので、ここに押せるものを置いても反応しない
export function HudWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const now = useApp((s) => s.now)

  if (!tick || !state.settings.showSessionCard) return null

  const timer = liveTimerPresentation(tick, state.breakTimer, now)

  return (
    <div className="hud">
      <div className={`hud-card ${timer.isPaused ? 'is-paused' : ''} ${timer.isOver ? 'is-over' : ''}`}>
        <span className="hud-dot" />
        <span className="hud-slot">
          <span className="hud-slot-label label">経過</span>
          <span className="hud-slot-value num">{formatDuration(timer.elapsedMs, 'compact')}</span>
        </span>
        <span className="hud-sep" />
        <span className="hud-slot">
          <span className="hud-slot-label label">{timer.label}</span>
          <span className="hud-slot-value num is-remaining">{remainingLabel(timer.remainingMs)}</span>
        </span>
      </div>
    </div>
  )
}

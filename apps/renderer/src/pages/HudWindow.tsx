import { useApp, useData } from '@/stores/app'
import { formatDuration } from '@white-box/core/engine'
import { remainingLabel } from '@/lib/format'

// 窓がクリックを素通りさせるので、ここに押せるものを置いても反応しない
export function HudWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)

  if (!tick || !state.settings.showSessionCard) return null

  const paused = tick.state === 'paused'
  const over = tick.remainingMs < 0

  return (
    <div className="hud">
      <div className={`hud-card ${paused ? 'is-paused' : ''} ${over ? 'is-over' : ''}`}>
        <span className="hud-dot" />
        <span className="hud-slot">
          <span className="hud-slot-label label">経過</span>
          <span className="hud-slot-value num">{formatDuration(tick.elapsedMs, 'compact')}</span>
        </span>
        <span className="hud-sep" />
        <span className="hud-slot">
          <span className="hud-slot-label label">{paused ? '停止中' : over ? '超過' : '残り'}</span>
          <span className="hud-slot-value num is-remaining">{remainingLabel(tick.remainingMs)}</span>
        </span>
      </div>
    </div>
  )
}

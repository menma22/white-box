import { invoke, cmd } from '../bridge'
import { useApp, useData } from '../store'
import { projectById, projectColor, taskById } from '../lib/selectors'
import { Ring } from '../ui/primitives'
import { formatDuration } from '@white-box/core/engine'

export function HudWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)

  if (!tick) {
    return (
      <div className="win hud drag">
        <div className="hud-idle">
          <span className="label">停止中</span>
          <button type="button" className="btn btn-primary btn-sm no-drag" onClick={() => void cmd.openWindow('start')}>
            セッションを開始
          </button>
        </div>
        <CloseButton />
      </div>
    )
  }

  const task = taskById(state, tick.activeTaskId)
  const project = projectById(state, task?.projectId ?? null)
  const paused = tick.state === 'paused'
  const over = tick.remainingMs < 0

  return (
    <div className="win hud drag">
      <CloseButton />
      <Ring elapsedMs={tick.elapsedMs} plannedMs={tick.plannedMs} size={82} thickness={5} paused={paused}>
        <span className={`hud-time num ${over ? 'is-over' : ''} ${paused ? 'is-paused' : ''}`}>
          {over ? `+${formatDuration(-tick.remainingMs, 'hms')}` : formatDuration(tick.remainingMs, 'hms')}
        </span>
        <span className="hud-time-label label">{paused ? '停止中' : over ? '超過' : '残り'}</span>
      </Ring>

      <div className="hud-body">
        <div className="hud-task" title={task?.title ?? ''}>
          {task?.title ?? '（削除されたタスク）'}
        </div>
        <div className="hud-meta">
          {project && (
            <span className="hud-project disp">
              <i style={{ background: projectColor(project) }} />
              {project.name}
            </span>
          )}
          <span className="num hud-elapsed">{formatDuration(tick.elapsedMs, 'compact')} 実作業</span>
        </div>
        <div className="hud-actions no-drag">
          <button
            type="button"
            className="hud-btn disp is-primary"
            onClick={() => void invoke(paused ? 'session:resume' : 'session:pause')}
          >
            {paused ? '再開' : '一時停止'}
          </button>
          <button type="button" className="hud-btn disp" onClick={() => void invoke('session:end')}>
            終了
          </button>
          <button
            type="button"
            className="hud-btn disp hud-btn-icon"
            title="現在の仕事"
            onClick={() => void cmd.openWindow('current')}
          >
            ⋯
          </button>
        </div>
      </div>
    </div>
  )
}

function CloseButton() {
  return (
    <button type="button" className="hud-close no-drag" title="閉じる（計測は続く）" onClick={() => void cmd.closeSelf()}>
      <svg width="9" height="9" viewBox="0 0 11 11" aria-hidden>
        <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.4" fill="none" />
      </svg>
    </button>
  )
}

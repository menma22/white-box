import { useEffect, useState } from 'react'
import { invoke } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { projectById, projectColor, taskById, taskTitle } from '@/lib/selectors'
import { Ring } from '@/components/ui'
import { formatDuration, MINUTE } from '@white-box/core/engine'

export function ExpireWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const now = useApp((s) => s.now)
  const [extendMinutes, setExtendMinutes] = useState(state.settings.defaultExtendMinutes)
  const [breakMinutes, setBreakMinutes] = useState(5)

  useEffect(() => {
    if (state.settings.soundOnExpire) chime()
  }, [state.settings.soundOnExpire])

  if (!tick) return <div className="win expire" />

  const breakTimer = state.breakTimer
  if (breakTimer) {
    const breakElapsedMs = Math.max(0, now - breakTimer.startedAt)
    const breakPlannedMs = breakTimer.endsAt - breakTimer.startedAt
    const finished = breakTimer.notifiedAt !== null
    return (
      <div className="win expire drag">
        <div className="expire-ring">
          <Ring elapsedMs={breakElapsedMs} plannedMs={breakPlannedMs} size={126} thickness={6}>
            <span className="num expire-elapsed">{formatDuration(Math.max(0, breakTimer.endsAt - now), 'compact')}</span>
            <span className="label">休憩</span>
          </Ring>
        </div>
        <h2 className="expire-title">{finished ? '休憩が終わった' : '休憩中'}</h2>
        <p className="expire-task">再開するまで実作業時間には入らない</p>
        {finished && (
          <div className="expire-actions no-drag">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void invoke('session:resume')} autoFocus>
              再開する
            </button>
            <button type="button" className="btn btn-solid btn-lg" onClick={() => void invoke('session:end')}>
              終了する
            </button>
          </div>
        )}
      </div>
    )
  }

  const task = taskById(state, tick.activeTaskId)
  const project = projectById(state, task?.projectId ?? null)
  const overMs = Math.max(0, -tick.remainingMs)

  return (
    <div className="win expire drag">
      <div className="expire-ring">
        <Ring elapsedMs={tick.elapsedMs} plannedMs={tick.plannedMs} size={126} thickness={6}>
          <span className="num expire-elapsed">{formatDuration(tick.elapsedMs, 'compact')}</span>
          <span className="label">実作業</span>
        </Ring>
      </div>

      <h2 className="expire-title">予定の{Math.round(tick.plannedMs / MINUTE)}分が経った</h2>
      <p className="expire-task">
        {project && <i className="expire-dot" style={{ background: projectColor(project) }} />}
        {taskTitle(state, tick.activeTaskId)}
      </p>
      {overMs > 0 && <p className="expire-over num">超過 +{formatDuration(overMs, 'compact')}</p>}

      <div className="expire-actions no-drag">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void invoke('session:end')} autoFocus>
          終了する
        </button>
        <button
          type="button"
          className="btn btn-solid btn-lg"
          onClick={() => void invoke('session:extend', { minutes: extendMinutes })}
        >
          +{extendMinutes}分 続ける
        </button>
        <button
          type="button"
          className="btn btn-solid btn-lg"
          onClick={() => void invoke('session:break', { minutes: breakMinutes })}
        >
          {breakMinutes}分 休憩
        </button>
      </div>

      <div className="expire-extends no-drag">
        <span className="expire-control-label">続行</span>
        {state.settings.extendOptions.map((m) => (
          <button
            key={m}
            type="button"
            className={`expire-ext disp ${m === extendMinutes ? 'is-active' : ''}`}
            onClick={() => setExtendMinutes(m)}
          >
            +{m}
          </button>
        ))}
      </div>
      <div className="expire-break-controls no-drag">
        <label className="expire-control-label" htmlFor="break-minutes">休憩</label>
        <input
          id="break-minutes"
          className="expire-break-input num"
          type="number"
          min={1}
          max={120}
          value={breakMinutes}
          onChange={(event) => setBreakMinutes(Math.max(1, Math.min(120, Number(event.target.value) || 1)))}
        />
        <span className="expire-control-label">分</span>
        <span className="expire-sep" />
        <button type="button" className="expire-next disp" onClick={() => void invoke('session:end', { thenStart: true })}>
          次のタスクへ →
        </button>
      </div>
    </div>
  )
}

/** 満了の合図。素材を持たずに済むよう、その場で 2 音だけ鳴らす。 */
function chime() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const at = now + i * 0.16
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.07, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.6)
    }
    setTimeout(() => void ctx.close(), 1400)
  } catch {
    /* 音が出せない環境でも通知そのものは成立する */
  }
}

import { useEffect, useState } from 'react'
import { invoke } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import { projectById, projectColor, taskById, taskTitle } from '@/lib/selectors'
import { Ring } from '@/components/ui'
import { formatDuration, MINUTE } from '@white-box/core/engine'

export function ExpireWindow() {
  const state = useData()
  const tick = useApp((s) => s.tick)
  const [extendMinutes, setExtendMinutes] = useState(state.settings.defaultExtendMinutes)

  useEffect(() => {
    if (state.settings.soundOnExpire) chime()
  }, [state.settings.soundOnExpire])

  if (!tick) return <div className="win expire" />

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
      </div>

      <div className="expire-extends no-drag">
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

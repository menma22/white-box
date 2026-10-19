import { useEffect, useRef, useState } from 'react'
import { useDraftParticipant } from '@/lib/useEditorFlush'
import { OptionalDurationDraft } from './optional-duration-draft'

export function OptionalDurationField({ label, value, onSave }: {
  label: string; value: number | null | undefined; onSave: (minutes: number | null) => Promise<unknown>
}) {
  const save = useRef(onSave)
  save.current = onSave
  const [controller] = useState(() => new OptionalDurationDraft(value, (minutes) => save.current(minutes)))
  const [state, setState] = useState(() => controller.snapshot())
  useEffect(() => controller.subscribe(setState), [controller])
  useEffect(() => controller.receive(value), [controller, value])
  useDraftParticipant(() => controller.flush())

  return (
    <label className="detail-field">
      <span className="label">{label}</span>
      <span className="task-duration-input">
        <input className="input num" type="number" min={0} step="any" aria-label={label} placeholder="未入力" value={state.draft} disabled={state.flushing}
          onFocus={() => controller.focus(true)} onChange={(event) => controller.update(event.target.value, event.target.validity.badInput)} onBlur={() => { controller.focus(false); void controller.save() }} />
        <select className="input" aria-label={`${label}の単位`} value={state.unit} disabled={state.flushing} onChange={(event) => controller.changeUnit(Number(event.target.value))}>
          <option value={1}>分</option><option value={60}>時間</option>
        </select>
      </span>
      {state.error && <span className="task-control-error" role="alert">保存できなかった。{state.error} 入力は残っている。</span>}
    </label>
  )
}

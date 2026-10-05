import { useEffect, useRef, useState } from 'react'

export function OptionalDurationField({ label, value, onSave }: {
  label: string; value: number | null | undefined; onSave: (minutes: number | null) => Promise<unknown>
}) {
  const [unit, setUnit] = useState(1)
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [error, setError] = useState('')
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(value == null ? '' : String(value / unit)) }, [value, unit])

  async function save(badInput: boolean) {
    editing.current = false
    const minutes = draft.trim() === '' ? null : Number(draft) * unit
    if (badInput || minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
      setError('0 以上の数値か、空欄にする')
      return
    }
    try {
      if (minutes !== (value ?? null)) await onSave(minutes)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存できなかった')
    }
  }
  return (
    <label className="detail-field">
      <span className="label">{label}</span>
      <span className="task-duration-input">
        <input className="input num" type="number" min={0} step="any" aria-label={label} placeholder="未入力" value={draft}
          onFocus={() => { editing.current = true }} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => void save(event.target.validity.badInput)} />
        <select className="input" aria-label={`${label}の単位`} value={unit} onChange={(event) => setUnit(Number(event.target.value))}>
          <option value={1}>分</option><option value={60}>時間</option>
        </select>
      </span>
      {error && <span className="task-control-error" role="alert">{error}</span>}
    </label>
  )
}

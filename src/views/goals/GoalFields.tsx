import { useEffect, useRef, useState } from 'react'

export type GoalRun = (command: string, args: Record<string, unknown>) => Promise<boolean>

export function GoalText({ value, label, multiline = false, onSave }: {
  value: string; label: string; multiline?: boolean; onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(value) }, [value])
  const props = {
    className: 'input gm-text', 'aria-label': label, value: draft,
    onFocus: () => { focused.current = true },
    onBlur: () => { focused.current = false },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value)
      onSave(event.target.value)
    },
  }
  return multiline ? <textarea {...props} rows={2} /> : <input {...props} />
}

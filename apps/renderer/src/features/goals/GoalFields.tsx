import { useEffect, useRef, useState } from 'react'
import type { ArgsOf, CommandName } from '@white-box/contracts'

export type GoalRun = <N extends CommandName>(command: N, args: ArgsOf<N>) => Promise<boolean>

export function GoalText({ value, label, multiline = false, required = false, onSave }: {
  value: string; label: string; multiline?: boolean; required?: boolean; onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(value) }, [value])
  const props = {
    className: 'input gm-text', 'aria-label': label, value: draft,
    onFocus: () => { focused.current = true },
    onBlur: () => {
      focused.current = false
      if (required) {
        const text = draft.trim()
        setDraft(text || value)
        if (text && text !== value) onSave(text)
      }
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value)
      if (!required || event.target.value.trim()) onSave(event.target.value)
    },
  }
  return multiline ? <textarea {...props} rows={2} /> : <input {...props} />
}

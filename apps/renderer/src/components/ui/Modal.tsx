import type { ReactNode } from 'react'
import { useEscape } from './useEscape'

export function Modal({
  open,
  onClose,
  children,
  width = 460,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
  labelledBy?: string
}) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  )
}

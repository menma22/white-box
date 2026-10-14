import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ open, onClose, children, width = 460, labelledBy }: {
  open: boolean; onClose: () => void; children: ReactNode; width?: number; labelledBy?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open || !panel.current) return
    const dialog = panel.current
    const previous = document.activeElement as HTMLElement | null
    const top = () => [...document.querySelectorAll<HTMLElement>('.modal[role="dialog"]')].at(-1)
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')].filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
    const input = controls().find((element) => element.matches('input, textarea, select'))
    if (top() === dialog) (input ?? controls()[0] ?? dialog).focus()
    const onKey = (event: KeyboardEvent) => {
      if (top() !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0] ?? dialog
      const last = items.at(-1) ?? dialog
      if (!dialog.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first).focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const current = top()
      if (previous?.isConnected && (!current || current.contains(previous))) previous.focus()
    }
  }, [open])
  if (!open) return null
  return <div className="modal-scrim" onMouseDown={onClose}>
    <div ref={panel} className="modal" style={{ width }} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>{children}</div>
  </div>
}

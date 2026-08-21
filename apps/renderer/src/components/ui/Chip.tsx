import type { ReactNode } from 'react'

export function Chip({ color, children, title }: { color?: string; children: ReactNode; title?: string }) {
  return (
    <span className="chip disp" title={title}>
      {color && <i className="chip-dot" style={{ background: color }} />}
      {children}
    </span>
  )
}

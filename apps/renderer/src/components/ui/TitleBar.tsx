import type { ReactNode } from 'react'

export function TitleBar({
  title,
  onClose,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  onClose?: () => void
  actions?: ReactNode
}) {
  return (
    <header className="titlebar drag">
      <div className="titlebar-text">
        <span className="disp titlebar-title">{title}</span>
        {subtitle && <span className="titlebar-sub">{subtitle}</span>}
      </div>
      <div className="titlebar-actions no-drag">
        {actions}
        {onClose && (
          <button className="titlebar-close no-drag" onClick={onClose} title="閉じる (Esc)" type="button">
            <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
              <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.3" fill="none" />
            </svg>
          </button>
        )}
      </div>
    </header>
  )
}

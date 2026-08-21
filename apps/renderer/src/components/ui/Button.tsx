import type { CSSProperties, ReactNode } from 'react'

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled,
  title,
  style,
  autoFocus,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'solid' | 'ghost' | 'quiet' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  style?: CSSProperties
  autoFocus?: boolean
}) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} no-drag`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={style}
      autoFocus={autoFocus}
      type="button"
    >
      {children}
    </button>
  )
}

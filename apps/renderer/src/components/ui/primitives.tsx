import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef } from 'react'

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

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd disp">{children}</kbd>
}

/** 円で経過を見せる。超過ぶんは内側にもう一本の弧で描く。 */
export function Ring({
  elapsedMs,
  plannedMs,
  size = 132,
  thickness = 7,
  paused = false,
  children,
}: {
  elapsedMs: number
  plannedMs: number
  size?: number
  thickness?: number
  paused?: boolean
  children?: ReactNode
}) {
  const r = (size - thickness) / 2 - 1
  const circumference = 2 * Math.PI * r
  const ratio = plannedMs > 0 ? Math.min(1, elapsedMs / plannedMs) : 0
  const over = plannedMs > 0 ? Math.min(1, Math.max(0, (elapsedMs - plannedMs) / plannedMs)) : 0
  const cx = size / 2

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} className="ring-track" strokeWidth={thickness} />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          className={`ring-arc ${paused ? 'is-paused' : ''}`}
          strokeWidth={thickness}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
        {over > 0 && (
          <circle
            cx={cx}
            cy={cx}
            r={r - thickness - 2}
            className="ring-over"
            strokeWidth={2}
            strokeDasharray={`${2 * Math.PI * (r - thickness - 2) * over} ${2 * Math.PI * (r - thickness - 2)}`}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        )}
      </svg>
      <div className="ring-body">{children}</div>
    </div>
  )
}

/** 台帳らしく見せるため、目盛り付きの細い棒で進捗を出す。 */
export function ProgressBar({ value, tone = 'work', height = 4 }: { value: number; tone?: 'work' | 'done' | 'dim'; height?: number }) {
  return (
    <div className="pbar" style={{ height }}>
      <div className={`pbar-fill pbar-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Chip({ color, children, title }: { color?: string; children: ReactNode; title?: string }) {
  return (
    <span className="chip disp" title={title}>
      {color && <i className="chip-dot" style={{ background: color }} />}
      {children}
    </span>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

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

export function useEscape(active: boolean, fn: () => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ref.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-mark" />
      <p className="empty-title">{title}</p>
      {hint && <p className="empty-hint">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented no-drag">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`segmented-item disp ${o.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 大きく見せる時間。単位を小さく添えて、時刻と読み違えないようにする。 */
export function BigDuration({ ms, size = 46 }: { ms: number; size?: number }) {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return (
    <span className="bigdur num" style={{ fontSize: size }}>
      {h > 0 && (
        <>
          <b>{h}</b>
          <i>h</i>
        </>
      )}
      <b>{h > 0 ? String(m).padStart(2, '0') : m}</b>
      <i>m</i>
    </span>
  )
}

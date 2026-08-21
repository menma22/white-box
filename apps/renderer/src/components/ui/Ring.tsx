import type { ReactNode } from 'react'

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

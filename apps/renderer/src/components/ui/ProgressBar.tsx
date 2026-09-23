/** 台帳らしく見せるため、目盛り付きの細い棒で進捗を出す。 */
export function ProgressBar({ value, tone = 'work', height = 4 }: { value: number; tone?: 'work' | 'done' | 'dim'; height?: number }) {
  return (
    <div className="pbar" style={{ height }}>
      <div className={`pbar-fill pbar-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

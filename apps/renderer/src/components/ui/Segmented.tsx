export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  unstyled = false,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  ariaLabel?: string
  unstyled?: boolean
}) {
  return (
    <div className={[!unstyled && 'segmented', 'no-drag', className].filter(Boolean).join(' ')} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`${unstyled ? '' : 'segmented-item disp'} ${o.value === value ? 'is-active' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

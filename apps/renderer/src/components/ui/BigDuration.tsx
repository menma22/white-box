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

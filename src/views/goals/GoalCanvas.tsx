import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GoalMap } from '@shared/types'
import { isGoalHidden, layoutGoals, NODE_HEIGHT, NODE_WIDTH } from '@shared/goal-map'
import { Button, Empty } from '../../ui/primitives'

export function GoalCanvas({ map, selected, focusRequest, onSelect, onAdd }: {
  map: GoalMap; selected: string | null; focusRequest: number; onSelect: (id: string | null) => void; onAdd: (id: string) => void
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState({ x: 36, y: 60, scale: 1 })
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null)
  const positions = useMemo(() => layoutGoals(map, map.activeHeadId, map.ui.showHidden), [map])
  const positionsRef = useRef(positions)
  positionsRef.current = positions

  const fit = useCallback(() => {
    const rect = canvas.current?.getBoundingClientRect()
    const points = Object.values(positionsRef.current)
    if (!rect || !points.length) return
    const minX = Math.min(...points.map((point) => point.x)), minY = Math.min(...points.map((point) => point.y))
    const width = Math.max(...points.map((point) => point.x)) + NODE_WIDTH - minX
    const height = Math.max(...points.map((point) => point.y)) + NODE_HEIGHT - minY
    const scale = Math.max(0.08, Math.min(1, (rect.width - 64) / width, (rect.height - 100) / height))
    setCamera({ x: (rect.width - width * scale) / 2 - minX * scale, y: (rect.height - height * scale) / 2 - minY * scale, scale })
  }, [])

  useLayoutEffect(() => { fit(); setTip(null) }, [map.activeHeadId, fit])
  useEffect(() => {
    if (!selected) return
    const position = positionsRef.current[selected], rect = canvas.current?.getBoundingClientRect()
    if (position && rect) setCamera((current) => ({ ...current, x: rect.width / 2 - (position.x + NODE_WIDTH / 2) * current.scale, y: rect.height / 2 - (position.y + NODE_HEIGHT / 2) * current.scale }))
  }, [focusRequest, selected])

  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const id = selectedRef.current, position = id ? positionsRef.current[id] : null
      if (!position) { fit(); return }
      const rect = element.getBoundingClientRect()
      setCamera((current) => ({ ...current, x: rect.width / 2 - (position.x + NODE_WIDTH / 2) * current.scale, y: rect.height / 2 - (position.y + NODE_HEIGHT / 2) * current.scale }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('.gm-tooltip')) return
      event.preventDefault()
      setTip(null)
      const rect = element.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top
      setCamera((current) => {
        const scale = Math.max(0.08, Math.min(2.5, current.scale * Math.exp(-event.deltaY * 0.0015)))
        return { scale, x: x - (x - current.x) * scale / current.scale, y: y - (y - current.y) * scale / current.scale }
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  useEffect(() => () => { if (tipTimer.current) clearTimeout(tipTimer.current) }, [])

  function showTip(id: string, element: HTMLElement) {
    if (tipTimer.current) clearTimeout(tipTimer.current)
    const rect = element.getBoundingClientRect()
    tipTimer.current = setTimeout(() => setTip({ id, x: Math.max(12, Math.min(window.innerWidth - 352, rect.left)), y: Math.max(12, Math.min(window.innerHeight - Math.min(420, window.innerHeight * .7) - 12, rect.bottom + 10)) }), 180)
  }

  function hideTip() {
    if (tipTimer.current) clearTimeout(tipTimer.current)
    tipTimer.current = setTimeout(() => setTip(null), 150)
  }

  function zoom(factor: number) {
    const rect = canvas.current?.getBoundingClientRect()
    if (!rect) return
    setTip(null)
    setCamera((current) => {
      const scale = Math.max(0.08, Math.min(2.5, current.scale * factor))
      return { scale, x: rect.width / 2 - (rect.width / 2 - current.x) * scale / current.scale, y: rect.height / 2 - (rect.height / 2 - current.y) * scale / current.scale }
    })
  }

  const node = tip ? map.nodes[tip.id] : null
  let depth = 1, ancestor = node?.parentId
  while (ancestor && map.nodes[ancestor]) { depth++; ancestor = map.nodes[ancestor]!.parentId }
  let descendants = 0
  const pending = [...(node?.children ?? [])]
  while (pending.length) { const child = map.nodes[pending.pop()!]; if (child) { descendants++; pending.push(...child.children) } }
  return <div className="gm-canvas" ref={canvas} aria-label="目標マップ" tabIndex={0}
    onPointerDown={(event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, .gm-tooltip')) return
      drag.current = { x: event.clientX, y: event.clientY, originX: camera.x, originY: camera.y, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      setTip(null)
    }}
    onPointerMove={(event) => {
      const current = drag.current
      if (!current) return
      const dx = event.clientX - current.x, dy = event.clientY - current.y
      if (Math.abs(dx) + Math.abs(dy) > 4) current.moved = true
      setCamera((value) => ({ ...value, x: current.originX + dx, y: current.originY + dy }))
    }}
    onPointerUp={(event) => {
      if (!drag.current) return
      if (!drag.current.moved) onSelect(null)
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={() => { drag.current = null }}>
    {!Object.keys(positions).length && <Empty title="最上位の目標から、次の一歩へ。" hint="目標を作り、子目標に分けて道筋をつなごう。" />}
    <div className="gm-scene" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
      <svg className="gm-edges" aria-hidden>
        {Object.entries(positions).map(([id, position]) => {
          const parent = map.nodes[id]?.parentId, from = parent ? positions[parent] : null
          if (!from) return null
          const x = from.x + NODE_WIDTH, y = from.y + NODE_HEIGHT / 2, targetY = position.y + NODE_HEIGHT / 2
          const mid = (x + position.x) / 2
          return <path key={id} className={isGoalHidden(map, id) ? 'gm-edge-hidden' : ''} d={`M ${x} ${y} C ${mid} ${y}, ${mid} ${targetY}, ${position.x} ${targetY}`} />
        })}
      </svg>
      {Object.entries(positions).map(([id, position]) => {
        const goal = map.nodes[id]!, hidden = isGoalHidden(map, id)
        return <div key={id} className={`gm-node ${selected === id ? 'gm-node-selected' : ''} ${hidden ? 'gm-node-hidden' : ''} ${!goal.parentId ? 'gm-node-head' : ''}`}
          data-node-id={id} style={{ left: position.x, top: position.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>
          <button type="button" className="gm-node-body" aria-label={`目標：${goal.goal || '未入力の目標'}`} aria-pressed={selected === id}
            onClick={() => { if (tipTimer.current) clearTimeout(tipTimer.current); onSelect(id); setTip(null) }} onMouseEnter={(event) => showTip(id, event.currentTarget)} onMouseLeave={hideTip}
            onFocus={(event) => showTip(id, event.currentTarget)} onBlur={hideTip}>
            <span className="gm-node-meta">{!goal.parentId ? '最上位の目標' : '目標'}{hidden ? ' · 非表示' : ''}</span>
            <strong>{goal.goal || '未入力の目標'}</strong><span className="gm-node-reason">{goal.reason || '理由を添える'}</span>
          </button>
          {!hidden && <button type="button" className="gm-node-add" aria-label={`${goal.goal}に子目標を追加`} onClick={() => onAdd(id)}>＋</button>}
        </div>
      })}
    </div>
    <div className="gm-zoom" onPointerDown={(event) => event.stopPropagation()}>
      <Button size="sm" title="全体を表示" onClick={fit}>全体を表示</Button>
      <Button size="sm" title="縮小" onClick={() => zoom(1 / 1.2)}>−</Button>
      <Button size="sm" title="100%に戻す" onClick={() => {
        const rect = canvas.current?.getBoundingClientRect()
        setCamera((current) => ({ scale: 1, x: rect ? rect.width / 2 - (rect.width / 2 - current.x) / current.scale : current.x, y: rect ? rect.height / 2 - (rect.height / 2 - current.y) / current.scale : current.y }))
      }}>{Math.round(camera.scale * 100)}%</Button>
      <Button size="sm" title="拡大" onClick={() => zoom(1.2)}>＋</Button>
      <span className="gm-muted">ドラッグで移動 · ホイールで拡大</span>
    </div>
    {node && tip && <div className="gm-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}
      onMouseEnter={() => { if (tipTimer.current) clearTimeout(tipTimer.current) }} onMouseLeave={hideTip}><strong>{node.goal || '未入力の目標'}</strong>
      {node.reason && <p>{node.reason}</p>}<span className="gm-muted">第{depth}層 · 子 {node.children.length} · 配下 {descendants}{isGoalHidden(map, node.id) ? ' · 非表示の枝' : ''}</span></div>}
  </div>
}

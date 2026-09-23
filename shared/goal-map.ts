import type { GoalHistory, GoalIssue, GoalMap, ID } from './types.js'

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 88
export const COL_GAP = 120
export const ROW_GAP = 26

export function emptyGoalMap(): GoalMap {
  return {
    nodes: {}, heads: [], activeHeadId: null, issues: [], history: [],
    ui: { view: 'map', headsOpen: true, doneOpen: false, resolvedOpen: false, showHidden: false },
  }
}

export function isGoalHidden(map: GoalMap, id: ID): boolean {
  const seen = new Set<ID>()
  let node = map.nodes[id]
  while (node && !seen.has(node.id)) {
    if (node.hidden) return true
    seen.add(node.id)
    node = node.parentId === null ? undefined : map.nodes[node.parentId]
  }
  return false
}

export function goalHead(map: GoalMap, id: ID): ID | null {
  const seen = new Set<ID>()
  let node = map.nodes[id]
  while (node && !seen.has(node.id)) {
    if (node.parentId === null) return node.id
    seen.add(node.id)
    node = map.nodes[node.parentId]
  }
  return null
}

export function layoutGoals(map: GoalMap, headId: ID | null, showHidden = map.ui.showHidden): Record<ID, { x: number; y: number }> {
  const positions: Record<ID, { x: number; y: number }> = {}
  if (headId === null || !Object.hasOwn(map.nodes, headId) || (!showHidden && isGoalHidden(map, headId))) return positions
  const visited = new Set<ID>()
  let leaf = 0
  function walk(id: ID, depth: number): void {
    const node = map.nodes[id]
    if (!node || visited.has(id)) return
    visited.add(id)
    const children = node.children.filter((child) => Object.hasOwn(map.nodes, child) && !visited.has(child) && (showHidden || !map.nodes[child]!.hidden))
    for (const child of children) walk(child, depth + 1)
    const first = positions[children[0] ?? '']
    const last = positions[children.at(-1) ?? '']
    positions[id] = { x: depth * (NODE_WIDTH + COL_GAP), y: first && last ? (first.y + last.y) / 2 : leaf++ * (NODE_HEIGHT + ROW_GAP) }
  }
  walk(headId, 0)
  return positions
}

export function goalRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('道標のデータ形式が不正です')
  return value as Record<string, unknown>
}

export function goalString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('道標の文字列が不正です')
  return value
}

export function goalId(value: unknown): ID {
  const id = goalString(value)
  if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('道標の ID が不正です')
  return id
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('道標の配列が不正です')
  return value
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('道標の真偽値が不正です')
  return value
}

export function goalTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('道標の日時が不正です')
  return value
}

export function validGoalDue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('締切は有効な日付で指定してください')
  }
  return value
}

export function parseGoalUi(value: unknown): GoalMap['ui'] {
  const raw = goalRecord(value)
  const ui = emptyGoalMap().ui
  if (raw.view !== undefined) {
    if (!['map', 'tasks', 'issues', 'history'].includes(goalString(raw.view))) throw new Error('道標のビューが不正です')
    ui.view = raw.view as GoalMap['ui']['view']
  }
  for (const key of ['headsOpen', 'doneOpen', 'resolvedOpen', 'showHidden'] as const) {
    if (raw[key] !== undefined) ui[key] = bool(raw[key])
  }
  return ui
}

export function parseGoalMap(value: unknown): GoalMap {
  const raw = goalRecord(value)
  const map = emptyGoalMap()
  for (const [key, value] of Object.entries(goalRecord(raw.nodes))) {
    const node = goalRecord(value)
    const id = goalId(node.id)
    if (goalId(key) !== id) throw new Error('ノードの ID が一致しません')
    map.nodes[id] = {
      id, goal: goalString(node.goal), reason: goalString(node.reason ?? ''),
      parentId: node.parentId == null ? null : goalId(node.parentId),
      children: list(node.children).map(goalId),
      hidden: node.hidden === undefined ? false : bool(node.hidden),
      hiddenAt: node.hiddenAt == null ? null : goalTime(node.hiddenAt),
      hideReason: goalString(node.hideReason ?? ''),
    }
  }
  map.heads = list(raw.heads).map(goalId)
  if (new Set(map.heads).size !== map.heads.length) throw new Error('ヘッドが重複しています')
  const roots = new Set(map.heads)
  for (const node of Object.values(map.nodes)) {
    if (new Set(node.children).size !== node.children.length) throw new Error('子目標が重複しています')
    if ((node.parentId === null) !== roots.has(node.id)) throw new Error('ヘッドと親子関係が一致しません')
    if (node.parentId !== null && !map.nodes[node.parentId]?.children.includes(node.id)) throw new Error('親目標が存在しないか親子関係が不正です')
    for (const child of node.children) {
      if (map.nodes[child]?.parentId !== node.id) throw new Error('子目標が存在しないか親子関係が不正です')
    }
  }
  for (const id of map.heads) if (!Object.hasOwn(map.nodes, id)) throw new Error('ヘッドが存在しません')
  const visited = new Set<ID>()
  const pending = [...map.heads]
  while (pending.length) {
    const id = pending.pop()!
    if (visited.has(id)) throw new Error('目標に循環があります')
    visited.add(id)
    pending.push(...map.nodes[id]!.children)
  }
  if (visited.size !== Object.keys(map.nodes).length) throw new Error('目標に循環があります')
  const ref = (value: unknown): ID => {
    const id = goalId(value)
    if (!Object.hasOwn(map.nodes, id)) throw new Error('参照する目標が存在しません')
    return id
  }
  map.activeHeadId = raw.activeHeadId == null ? null : ref(raw.activeHeadId)
  if (map.activeHeadId !== null && !roots.has(map.activeHeadId)) throw new Error('選択中のヘッドが不正です')
  const issueIds = new Set<ID>()
  map.issues = list(raw.issues ?? []).map((value) => {
    const issue = goalRecord(value)
    const id = goalId(issue.id)
    if (issueIds.has(id)) throw new Error('問題の ID が重複しています')
    issueIds.add(id)
    if (!['problem', 'question', 'idea'].includes(goalString(issue.kind))) throw new Error('問題の種別が不正です')
    return { id, text: goalString(issue.text), kind: issue.kind as GoalIssue['kind'], nodeId: issue.nodeId == null ? null : ref(issue.nodeId), resolved: bool(issue.resolved), createdAt: goalTime(issue.createdAt) }
  })
  const historyIds = new Set<ID>()
  map.history = list(raw.history ?? []).map((value) => {
    const event = goalRecord(value)
    const id = goalId(event.id)
    if (historyIds.has(id)) throw new Error('履歴の ID が重複しています')
    historyIds.add(id)
    if (!['create-head', 'create-child', 'hide', 'unhide', 'merge', 'promote'].includes(goalString(event.type))) throw new Error('履歴の種類が不正です')
    return { id, at: goalTime(event.at), type: event.type as GoalHistory['type'], nodeId: ref(event.nodeId), parentId: event.parentId == null ? null : ref(event.parentId), note: goalString(event.note ?? ''), withIds: list(event.withIds ?? []).map(ref) }
  })
  map.ui = parseGoalUi(raw.ui ?? {})
  return map
}

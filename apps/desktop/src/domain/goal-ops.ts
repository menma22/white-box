/** 受け取った Database を書き換えない: 検証で投げたとき、途中までの変更が保存データに残る */
import { createHash } from 'node:crypto'
import type { Database, GoalHistory, GoalIssue, GoalMap, GoalNode, ID, OutcomeRecord, Priority, Task } from '@white-box/core/types'
import { goalHead, goalId, goalRecord, goalString, goalTime, isGoalHidden, parseGoalMap, parseGoalUi, validGoalDue } from '@white-box/core/goal-map'
import { changeOutcome, emptyOutcome } from '@white-box/core/outcome'
import { newId } from './session-ops.js'

export function requireGoal(db: Pick<Database, 'goalMap'>, id: ID): GoalNode {
  goalId(id)
  if (!Object.hasOwn(db.goalMap.nodes, id)) throw new Error('目標が見つかりません')
  return db.goalMap.nodes[id]!
}

function history(map: GoalMap, type: GoalHistory['type'], nodeId: ID, extra: Partial<Pick<GoalHistory, 'parentId' | 'note' | 'withIds'>> = {}): void {
  map.history.push({ id: newId('gh'), at: Date.now(), type, nodeId, parentId: null, note: '', withIds: [], ...extra })
}

function node(goal: string, reason: string, parentId: ID | null): GoalNode {
  return { id: newId('goal'), goal: goalString(goal), reason: goalString(reason), parentId, children: [], hidden: false, hiddenAt: null, hideReason: '', outcome: emptyOutcome() }
}

export function createGoal(db: Database, input: { goal: string; reason?: string; parentId?: ID | null }): { goalMap: GoalMap; goal: GoalNode } {
  const map = structuredClone(db.goalMap)
  const parent = input.parentId == null ? null : requireGoal({ goalMap: map }, input.parentId)
  if (parent && isGoalHidden(map, parent.id)) throw new Error('隠した枝に子目標は追加できません。先に表示へ戻してください')
  const created = node(input.goal, input.reason ?? '', parent?.id ?? null)
  map.nodes[created.id] = created
  if (parent) parent.children.push(created.id)
  else {
    map.heads.push(created.id)
    map.activeHeadId = created.id
  }
  history(map, parent ? 'create-child' : 'create-head', created.id, { parentId: parent?.id ?? null })
  return { goalMap: map, goal: created }
}

export function updateGoal(db: Database, id: ID, patch: { goal?: string; reason?: string; outcome?: Partial<OutcomeRecord> }): GoalMap {
  const map = structuredClone(db.goalMap)
  const target = requireGoal({ goalMap: map }, id)
  if (patch.goal !== undefined) target.goal = goalString(patch.goal)
  if (patch.reason !== undefined) target.reason = goalString(patch.reason)
  if (patch.outcome !== undefined) target.outcome = changeOutcome(target.outcome, patch.outcome, Date.now())
  return map
}

export function mergeGoals(db: Database, input: { ids: ID[]; goal: string; reason?: string }): { goalMap: GoalMap; goal: GoalNode } {
  const map = structuredClone(db.goalMap)
  if (!Array.isArray(input.ids) || !input.ids.length || new Set(input.ids).size !== input.ids.length) throw new Error('異なるヘッドを選択してください')
  const selected = input.ids.map((id) => requireGoal({ goalMap: map }, id))
  if (selected.some((item) => item.parentId !== null || item.hidden || !map.heads.includes(item.id))) throw new Error('表示中のヘッドだけを統合できます')
  const created = node(input.goal, input.reason ?? '', null)
  created.children = [...input.ids]
  const insertAt = Math.min(...input.ids.map((id) => map.heads.indexOf(id)))
  const heads = map.heads.filter((id) => !input.ids.includes(id))
  heads.splice(insertAt, 0, created.id)
  for (const child of selected) child.parentId = created.id
  map.nodes[created.id] = created
  map.heads = heads
  map.activeHeadId = created.id
  history(map, selected.length === 1 ? 'promote' : 'merge', created.id, { withIds: [...input.ids] })
  return { goalMap: map, goal: created }
}

export function hideGoal(db: Database, id: ID, reason: string): GoalMap {
  const map = structuredClone(db.goalMap)
  const target = requireGoal({ goalMap: map }, id)
  const note = goalString(reason).trim()
  if (target.hidden) return db.goalMap
  target.hidden = true
  target.hiddenAt = Date.now()
  target.hideReason = note
  history(map, 'hide', id, { parentId: target.parentId, note })
  if (!map.ui.showHidden && target.id === map.activeHeadId) {
    map.activeHeadId = map.heads.find((head) => !map.nodes[head]!.hidden) ?? null
  }
  return map
}

export function restoreGoal(db: Database, id: ID): GoalMap {
  const map = structuredClone(db.goalMap)
  let target: GoalNode | undefined = requireGoal({ goalMap: map }, id)
  let changed = false
  while (target) {
    if (target.hidden) {
      target.hidden = false
      target.hiddenAt = null
      target.hideReason = ''
      changed = true
    }
    target = target.parentId === null ? undefined : map.nodes[target.parentId]
  }
  if (!changed) return db.goalMap
  map.activeHeadId = goalHead(map, id)
  history(map, 'unhide', id)
  return map
}

export function updateGoalUi(db: Database, input: { patch?: Partial<GoalMap['ui']>; activeHeadId?: ID | null }): GoalMap {
  const map = structuredClone(db.goalMap)
  const ui = parseGoalUi({ ...map.ui, ...goalRecord(input.patch ?? {}) })
  let active = input.activeHeadId === undefined ? map.activeHeadId : input.activeHeadId
  if (active !== null && !map.heads.includes(goalId(active))) throw new Error('ヘッドが見つかりません')
  if (!ui.showHidden && active !== null && isGoalHidden(map, active)) active = null
  if (active === null) active = map.heads.find((id) => ui.showHidden || !isGoalHidden(map, id)) ?? null
  map.ui = ui
  map.activeHeadId = active
  return map
}

type IssuePatch = Partial<Pick<GoalIssue, 'text' | 'kind' | 'resolved' | 'nodeId'>>

function issuePatch(map: GoalMap, patch: IssuePatch): Partial<GoalIssue> {
  const out: Partial<GoalIssue> = {}
  if (patch.text !== undefined) {
    out.text = goalString(patch.text)
    if (!out.text.trim()) throw new Error('問題の内容を入力してください')
  }
  if (patch.kind !== undefined) {
    if (!['problem', 'question', 'idea'].includes(patch.kind)) throw new Error('問題の種別が不正です')
    out.kind = patch.kind
  }
  if (patch.resolved !== undefined) {
    if (typeof patch.resolved !== 'boolean') throw new Error('解決状態が不正です')
    out.resolved = patch.resolved
  }
  if (patch.nodeId !== undefined) out.nodeId = patch.nodeId === null ? null : requireGoal({ goalMap: map }, patch.nodeId).id
  return out
}

export function createIssue(db: Database, input: { kind: GoalIssue['kind']; text: string; nodeId?: ID | null }): { goalMap: GoalMap; issue: GoalIssue } {
  const map = structuredClone(db.goalMap)
  const text = goalString(input.text).trim()
  if (!text) throw new Error('問題の内容を入力してください')
  const patch = issuePatch(map, input)
  const issue: GoalIssue = { id: newId('issue'), kind: 'problem', nodeId: null, resolved: false, createdAt: Date.now(), ...patch, text }
  map.issues.unshift(issue)
  return { goalMap: map, issue }
}

export function updateIssue(db: Database, id: ID, patch: IssuePatch): GoalMap {
  const map = structuredClone(db.goalMap)
  const issue = map.issues.find((item) => item.id === id)
  if (!issue) throw new Error('問題が見つかりません')
  Object.assign(issue, issuePatch(map, patch))
  return map
}

export function deleteIssue(db: Database, id: ID): GoalMap {
  return { ...db.goalMap, issues: db.goalMap.issues.filter((issue) => issue.id !== id) }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value)
}

export interface GoalImportResult {
  goalMap: GoalMap
  tasks: Task[]
  goalMapImports: string[]
  counts: { nodes: number; tasks: number; issues: number; history: number }
}

export function importGoals(db: Database, data: unknown): GoalImportResult {
  const raw = goalRecord(data)
  if (raw.version !== 1) throw new Error('michishirube.v1 の JSON を選択してください')
  const imported = parseGoalMap(raw)
  if (raw.tasks !== undefined && !Array.isArray(raw.tasks)) throw new Error('タスクの形式が不正です')
  const taskIds = new Set<ID>()
  const tasks = ((raw.tasks ?? []) as unknown[]).map((value, order): Task => {
    const task = goalRecord(value)
    const id = goalId(task.id)
    if (taskIds.has(id)) throw new Error('タスクの ID が重複しています')
    taskIds.add(id)
    if (!['high', 'mid', 'low'].includes(goalString(task.priority))) throw new Error('優先度が不正です')
    if (typeof task.done !== 'boolean') throw new Error('完了状態が不正です')
    const createdAt = goalTime(task.createdAt)
    return {
      id, title: goalString(task.title), projectId: null, parentId: null, notes: '',
      status: task.done ? 'done' : 'todo', progress: task.done ? 100 : 0,
      priority: task.priority === 'mid' ? 'normal' : task.priority as Priority,
      order, createdAt, updatedAt: createdAt, doneAt: null, createdInSessionId: null,
      due: validGoalDue(task.due === '' ? null : task.due), goalNodeId: null,
    }
  })
  // outcome は取込後に足した項目。指紋に含めると、以前の取込記録と照合できなくなる
  const legacyNodes = Object.fromEntries(Object.entries(imported.nodes).map(([id, { outcome: _outcome, ...rest }]) => [id, rest]))
  const fingerprint = createHash('sha256').update(canonical({ ...imported, nodes: legacyNodes, tasks })).digest('hex')
  if (db.goalMapImports?.includes(fingerprint)) throw new Error('この道標データは取り込み済みです。同じ JSON を再度取り込む必要はありません')
  const remap = new Map(Object.keys(imported.nodes).map((id) => [id, newId('goal')]))
  const ref = (id: ID): ID => remap.get(id)!
  const nodes = Object.fromEntries(Object.values(imported.nodes).map((item) => [ref(item.id), { ...item, id: ref(item.id), parentId: item.parentId === null ? null : ref(item.parentId), children: item.children.map(ref) }]))
  const issues = imported.issues.map((issue) => ({ ...issue, id: newId('issue'), nodeId: issue.nodeId === null ? null : ref(issue.nodeId) }))
  const events = imported.history.map((event) => ({ ...event, id: newId('gh'), nodeId: ref(event.nodeId), parentId: event.parentId === null ? null : ref(event.parentId), withIds: event.withIds.map(ref) }))
  const order = db.tasks.reduce((max, task) => Math.max(max, task.order + 1), 0)
  const newTasks = tasks.map((task, index) => ({ ...task, id: newId('tsk'), order: order + index }))
  return {
    goalMap: {
      nodes: { ...db.goalMap.nodes, ...nodes }, heads: [...db.goalMap.heads, ...imported.heads.map(ref)],
      activeHeadId: imported.activeHeadId === null ? db.goalMap.activeHeadId : ref(imported.activeHeadId),
      issues: [...db.goalMap.issues, ...issues], history: [...db.goalMap.history, ...events], ui: imported.ui,
    },
    tasks: [...db.tasks, ...newTasks],
    goalMapImports: [...(db.goalMapImports ?? []), fingerprint],
    counts: { nodes: remap.size, tasks: tasks.length, issues: issues.length, history: events.length },
  }
}

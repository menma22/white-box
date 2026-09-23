/**
 * Project / Task / 道標の変更。Database を直接書き換え、保存は呼び出し側が行う。
 *
 * タスクを消してもセッションの記録は消さない（過去を書き換えないため）。
 */
import type { Database, GoalHistory, GoalIssue, GoalMap, GoalNode, ID, Priority, Project, Task, TaskStatus } from '../shared/types.js'
import { newId } from '../shared/session-ops.js'
import { createHash } from 'node:crypto'
import { goalHead, goalId, goalRecord, goalString, goalTime, isGoalHidden, parseGoalMap, parseGoalUi, validGoalDue } from '../shared/goal-map.js'

export function createProject(db: Database, input: { name: string; hue?: number }): Project {
  const now = Date.now()
  const used = db.projects.map((p) => p.hue)
  const palette = [18, 200, 150, 265, 42, 330, 96, 228]
  const hue = input.hue ?? (palette.find((h) => !used.includes(h)) ?? Math.floor(Math.random() * 360))
  const project: Project = {
    id: newId('prj'),
    name: input.name.trim() || '無題のプロジェクト',
    hue,
    archived: false,
    order: db.projects.length,
    createdAt: now,
    updatedAt: now,
  }
  db.projects.push(project)
  return project
}

export function updateProject(db: Database, id: ID, patch: Partial<Project>): void {
  const p = db.projects.find((x) => x.id === id)
  if (!p) return
  Object.assign(p, patch, { id: p.id, updatedAt: Date.now() })
}

export function deleteProject(db: Database, id: ID): void {
  db.projects = db.projects.filter((p) => p.id !== id)
  for (const t of db.tasks) {
    if (t.projectId === id) t.projectId = null
  }
}

export function createTask(
  db: Database,
  input: {
    title: string
    projectId?: ID | null
    parentId?: ID | null
    status?: TaskStatus
    priority?: Priority
    notes?: string
    sessionId?: ID | null
    due?: string | null
    goalNodeId?: ID | null
  },
): Task {
  const due = validGoalDue(input.due)
  const goalNodeId = input.goalNodeId == null ? null : requireGoal(db, input.goalNodeId).id
  const now = Date.now()
  const status = input.status ?? 'inbox'
  const siblings = db.tasks.filter((t) => t.status === status)
  const task: Task = {
    id: newId('tsk'),
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    title: input.title.trim() || '無題のタスク',
    notes: input.notes ?? '',
    status,
    progress: 0,
    priority: input.priority ?? 'normal',
    order: siblings.length ? Math.max(...siblings.map((t) => t.order)) + 1 : 0,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    createdInSessionId: input.sessionId ?? null,
    due,
    goalNodeId,
  }
  db.tasks.push(task)
  return task
}

export function updateTask(db: Database, id: ID, patch: Partial<Task>): void {
  const t = db.tasks.find((x) => x.id === id)
  if (!t) return
  if (patch.due !== undefined) validGoalDue(patch.due)
  if (patch.goalNodeId != null) requireGoal(db, patch.goalNodeId)
  const nextStatus = patch.status ?? t.status
  Object.assign(t, patch, { id: t.id, updatedAt: Date.now() })
  if (nextStatus === 'done' && t.doneAt === null) {
    t.doneAt = Date.now()
    if (patch.progress === undefined) t.progress = 100
  }
  if (nextStatus !== 'done') t.doneAt = null
  t.progress = Math.max(0, Math.min(100, Math.round(t.progress)))
}

/** 列をまたぐ移動と並び替え。移動先の列だけ order を振り直す。 */
export function moveTask(db: Database, id: ID, status: TaskStatus, index: number): void {
  const task = db.tasks.find((t) => t.id === id)
  if (!task) return
  const from = task.status
  updateTask(db, id, { status })
  const column = db.tasks
    .filter((t) => t.status === status && t.id !== id)
    .sort((a, b) => a.order - b.order)
  const clamped = Math.max(0, Math.min(index, column.length))
  column.splice(clamped, 0, task)
  column.forEach((t, i) => {
    t.order = i
  })
  if (from !== status) {
    db.tasks
      .filter((t) => t.status === from)
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => {
        t.order = i
      })
  }
}

export function descendantIds(db: Database, id: ID): ID[] {
  const out: ID[] = []
  const walk = (parentId: ID) => {
    for (const t of db.tasks) {
      if (t.parentId === parentId) {
        out.push(t.id)
        walk(t.id)
      }
    }
  }
  walk(id)
  return out
}

export function deleteTask(db: Database, id: ID): void {
  const ids = new Set([id, ...descendantIds(db, id)])
  db.tasks = db.tasks.filter((t) => !ids.has(t.id))
}

/** タスクが実績時間を持つか（削除確認の材料）。 */
export function hasRecordedTime(db: Database, id: ID): boolean {
  return db.sessions.some((s) => s.segments.some((seg) => seg.taskId === id))
}

function requireGoal(db: Database, id: ID): GoalNode {
  goalId(id)
  if (!Object.hasOwn(db.goalMap.nodes, id)) throw new Error('目標が見つかりません')
  return db.goalMap.nodes[id]!
}

function history(db: Database, type: GoalHistory['type'], nodeId: ID, extra: Partial<Pick<GoalHistory, 'parentId' | 'note' | 'withIds'>> = {}): void {
  db.goalMap.history.push({ id: newId('gh'), at: Date.now(), type, nodeId, parentId: null, note: '', withIds: [], ...extra })
}

function node(goal: string, reason: string, parentId: ID | null): GoalNode {
  return { id: newId('goal'), goal: goalString(goal), reason: goalString(reason), parentId, children: [], hidden: false, hiddenAt: null, hideReason: '' }
}

export function createGoal(db: Database, input: { goal: string; reason?: string; parentId?: ID | null }): GoalNode {
  const parent = input.parentId == null ? null : requireGoal(db, input.parentId)
  if (parent && isGoalHidden(db.goalMap, parent.id)) throw new Error('隠した枝に子目標は追加できません。先に表示へ戻してください')
  const created = node(input.goal, input.reason ?? '', parent?.id ?? null)
  db.goalMap.nodes[created.id] = created
  if (parent) parent.children.push(created.id)
  else {
    db.goalMap.heads.push(created.id)
    db.goalMap.activeHeadId = created.id
  }
  history(db, parent ? 'create-child' : 'create-head', created.id, { parentId: parent?.id ?? null })
  return created
}

export function updateGoal(db: Database, id: ID, patch: { goal?: string; reason?: string }): void {
  const target = requireGoal(db, id)
  if (patch.goal !== undefined) goalString(patch.goal)
  if (patch.reason !== undefined) goalString(patch.reason)
  if (patch.goal !== undefined) target.goal = patch.goal
  if (patch.reason !== undefined) target.reason = patch.reason
}

export function mergeGoals(db: Database, input: { ids: ID[]; goal: string; reason?: string }): GoalNode {
  if (!Array.isArray(input.ids) || !input.ids.length || new Set(input.ids).size !== input.ids.length) throw new Error('異なるヘッドを選択してください')
  const selected = input.ids.map((id) => requireGoal(db, id))
  if (selected.some((node) => node.parentId !== null || node.hidden || !db.goalMap.heads.includes(node.id))) throw new Error('表示中のヘッドだけを統合できます')
  const created = node(input.goal, input.reason ?? '', null)
  created.children = [...input.ids]
  const insertAt = Math.min(...input.ids.map((id) => db.goalMap.heads.indexOf(id)))
  const heads = db.goalMap.heads.filter((id) => !input.ids.includes(id))
  heads.splice(insertAt, 0, created.id)
  for (const child of selected) child.parentId = created.id
  db.goalMap.nodes[created.id] = created
  db.goalMap.heads = heads
  db.goalMap.activeHeadId = created.id
  history(db, selected.length === 1 ? 'promote' : 'merge', created.id, { withIds: [...input.ids] })
  return created
}

export function hideGoal(db: Database, id: ID, reason: string): void {
  const target = requireGoal(db, id)
  const note = goalString(reason).trim()
  if (target.hidden) return
  target.hidden = true
  target.hiddenAt = Date.now()
  target.hideReason = note
  history(db, 'hide', id, { parentId: target.parentId, note })
  if (!db.goalMap.ui.showHidden && target.id === db.goalMap.activeHeadId) {
    db.goalMap.activeHeadId = db.goalMap.heads.find((id) => !db.goalMap.nodes[id]!.hidden) ?? null
  }
}

export function restoreGoal(db: Database, id: ID): void {
  let target: GoalNode | undefined = requireGoal(db, id)
  let changed = false
  while (target) {
    if (target.hidden) {
      target.hidden = false
      target.hiddenAt = null
      target.hideReason = ''
      changed = true
    }
    target = target.parentId === null ? undefined : db.goalMap.nodes[target.parentId]
  }
  if (!changed) return
  db.goalMap.activeHeadId = goalHead(db.goalMap, id)
  history(db, 'unhide', id)
}

export function updateGoalUi(db: Database, input: { patch?: Partial<GoalMap['ui']>; activeHeadId?: ID | null }): void {
  const ui = parseGoalUi({ ...db.goalMap.ui, ...goalRecord(input.patch ?? {}) })
  let active = input.activeHeadId === undefined ? db.goalMap.activeHeadId : input.activeHeadId
  if (active !== null && !db.goalMap.heads.includes(goalId(active))) throw new Error('ヘッドが見つかりません')
  if (!ui.showHidden && active !== null && isGoalHidden(db.goalMap, active)) active = null
  if (active === null) active = db.goalMap.heads.find((id) => ui.showHidden || !isGoalHidden(db.goalMap, id)) ?? null
  db.goalMap.ui = ui
  db.goalMap.activeHeadId = active
}

function issuePatch(db: Database, patch: Partial<Pick<GoalIssue, 'text' | 'kind' | 'resolved' | 'nodeId'>>): Partial<GoalIssue> {
  const out: Partial<GoalIssue> = {}
  if (patch.text !== undefined) out.text = goalString(patch.text)
  if (patch.kind !== undefined) {
    if (!['problem', 'question', 'idea'].includes(patch.kind)) throw new Error('問題の種別が不正です')
    out.kind = patch.kind
  }
  if (patch.resolved !== undefined) {
    if (typeof patch.resolved !== 'boolean') throw new Error('解決状態が不正です')
    out.resolved = patch.resolved
  }
  if (patch.nodeId !== undefined) out.nodeId = patch.nodeId === null ? null : requireGoal(db, patch.nodeId).id
  return out
}

export function createIssue(db: Database, input: { kind: GoalIssue['kind']; text: string; nodeId?: ID | null }): GoalIssue {
  const text = goalString(input.text).trim()
  if (!text) throw new Error('問題の内容を入力してください')
  const patch = issuePatch(db, input)
  const issue: GoalIssue = { id: newId('issue'), kind: 'problem', nodeId: null, resolved: false, createdAt: Date.now(), ...patch, text }
  db.goalMap.issues.unshift(issue)
  return issue
}

export function updateIssue(db: Database, id: ID, patch: Partial<Pick<GoalIssue, 'text' | 'kind' | 'resolved' | 'nodeId'>>): void {
  const issue = db.goalMap.issues.find((item) => item.id === id)
  if (!issue) throw new Error('問題が見つかりません')
  Object.assign(issue, issuePatch(db, patch))
}

export function deleteIssue(db: Database, id: ID): void {
  db.goalMap.issues = db.goalMap.issues.filter((issue) => issue.id !== id)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value)
}

export function importGoals(db: Database, data: unknown): { nodes: number; tasks: number; issues: number; history: number } {
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
  const fingerprint = createHash('sha256').update(canonical({ ...imported, tasks })).digest('hex')
  if (db.goalMapImports?.includes(fingerprint)) throw new Error('この道標データは取り込み済みです。同じ JSON を再度取り込む必要はありません')
  const remap = new Map(Object.keys(imported.nodes).map((id) => [id, newId('goal')]))
  const ref = (id: ID): ID => remap.get(id)!
  const nodes = Object.fromEntries(Object.values(imported.nodes).map((node) => [ref(node.id), { ...node, id: ref(node.id), parentId: node.parentId === null ? null : ref(node.parentId), children: node.children.map(ref) }]))
  const issues = imported.issues.map((issue) => ({ ...issue, id: newId('issue'), nodeId: issue.nodeId === null ? null : ref(issue.nodeId) }))
  const history = imported.history.map((event) => ({ ...event, id: newId('gh'), nodeId: ref(event.nodeId), parentId: event.parentId === null ? null : ref(event.parentId), withIds: event.withIds.map(ref) }))
  const order = db.tasks.reduce((max, task) => Math.max(max, task.order + 1), 0)
  const newTasks = tasks.map((task, index) => ({ ...task, id: newId('tsk'), order: order + index }))
  db.goalMap = {
    nodes: { ...db.goalMap.nodes, ...nodes }, heads: [...db.goalMap.heads, ...imported.heads.map(ref)],
    activeHeadId: imported.activeHeadId === null ? db.goalMap.activeHeadId : ref(imported.activeHeadId),
    issues: [...db.goalMap.issues, ...issues], history: [...db.goalMap.history, ...history], ui: imported.ui,
  }
  db.tasks.push(...newTasks)
  db.goalMapImports = [...(db.goalMapImports ?? []), fingerprint]
  return { nodes: remap.size, tasks: tasks.length, issues: issues.length, history: history.length }
}

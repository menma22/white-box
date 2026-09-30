import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database, GoalMap, Task } from '@white-box/core/types'
import { emptyGoalMap, goalHead, isGoalHidden, layoutGoals, parseGoalMap } from '@white-box/core/goal-map'
import {
  createGoal,
  createIssue,
  hideGoal,
  importGoals,
  mergeGoals,
  restoreGoal,
  updateGoal,
  updateGoalUi,
  updateIssue,
} from '../src/domain/goal-ops.js'
import { createTask, updateTask } from '../src/domain/task-ops.js'
import { normalizeDatabase, Store } from '../src/infra/store.js'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

const temporaryDirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function legacy() {
  return {
    version: 1, seq: 4, taskSeq: 3, issueSeq: 2, historySeq: 3,
    nodes: {
      n1: { id: 'n1', goal: '上位', reason: '大事', parentId: null, children: ['n2'], hidden: false, hiddenAt: null, hideReason: '' },
      n2: { id: 'n2', goal: '分岐', reason: '試す', parentId: 'n1', children: [], hidden: true, hiddenAt: 200, hideReason: '別の道を選ぶ' },
    },
    heads: ['n1'], activeHeadId: 'n1',
    tasks: [
      { id: 't1', title: '未完了', priority: 'mid', due: '2026-10-03', done: false, createdAt: 100 },
      { id: 't2', title: '完了', priority: 'high', due: '', done: true, createdAt: 200 },
    ],
    issues: [{ id: 'i1', text: '難点', kind: 'problem', nodeId: 'n2', resolved: false, createdAt: 120 }],
    history: [
      { id: 'h1', at: 100, type: 'create-child', nodeId: 'n2', parentId: 'n1', note: '', withIds: [] },
      { id: 'h2', at: 200, type: 'hide', nodeId: 'n2', parentId: 'n1', note: '別の道を選ぶ', withIds: [] },
    ],
    ui: { view: 'issues', headsOpen: false, doneOpen: true, resolvedOpen: true, showHidden: true },
  }
}

function goal(db: Database, input: Parameters<typeof createGoal>[1]) {
  const r = createGoal(db, input)
  db.goalMap = r.goalMap
  return r.goal
}

function merge(db: Database, input: Parameters<typeof mergeGoals>[1]) {
  const r = mergeGoals(db, input)
  db.goalMap = r.goalMap
  return r.goal
}

function issue(db: Database, input: Parameters<typeof createIssue>[1]) {
  const r = createIssue(db, input)
  db.goalMap = r.goalMap
  return r.issue
}

function task(db: Database, input: Parameters<typeof createTask>[1]): Task {
  const r = createTask(db, input)
  db.tasks = r.tasks
  return r.task
}

function importInto(db: Database, data: unknown) {
  const r = importGoals(db, data)
  db.goalMap = r.goalMap
  db.tasks = r.tasks
  db.goalMapImports = r.goalMapImports
  return r.counts
}

describe('目標の操作', () => {
  it('受け取った Database を書き換えず、新しい道標を返す', () => {
    const db = normalizeDatabase({})
    const head = goal(db, { goal: '上位' })
    const before = JSON.stringify(db)
    createGoal(db, { goal: '子', parentId: head.id })
    updateGoal(db, head.id, { goal: '変更', outcome: { result: '結果' } })
    hideGoal(db, head.id, '休止')
    createIssue(db, { kind: 'idea', text: '改善', nodeId: head.id })
    updateGoalUi(db, { patch: { view: 'history' } })
    importGoals(db, legacy())
    expect(JSON.stringify(db)).toBe(before)
  })

  it('子タスクのない目標も成果を記録して達成・非達成を判定できる', () => {
    const db = normalizeDatabase({})
    const created = goal(db, { goal: '研究テーマを決める' })
    const node = () => db.goalMap.nodes[created.id]!
    expect(created.outcome).toMatchObject({ status: 'pending', deliverable: '', result: '', assessedAt: null })
    expect(() => updateGoal(db, created.id, { outcome: { status: 'achieved' } })).toThrow('成果物または達成結果')
    db.goalMap = updateGoal(db, created.id, { outcome: { result: '研究テーマを決定した' } })
    db.goalMap = updateGoal(db, created.id, { outcome: { status: 'achieved' } })
    expect(node().outcome).toMatchObject({ status: 'achieved', result: '研究テーマを決定した' })
    expect(node().outcome?.assessedAt).toEqual(expect.any(Number))
    expect(db.tasks).toHaveLength(0)
    db.goalMap = updateGoal(db, created.id, { outcome: { status: 'not-achieved', result: '再検討が必要' } })
    expect(node().outcome).toMatchObject({ status: 'not-achieved', result: '再検討が必要' })
    db.goalMap = updateGoal(db, created.id, { outcome: { status: 'pending' } })
    expect(node().outcome?.assessedAt).toBe(null)
  })

  it('作成と統合は親子構造を保持し、文章の編集は構造履歴を増やさない', () => {
    const db = normalizeDatabase({})
    const a = goal(db, { goal: 'A', reason: '理由' })
    const child = goal(db, { goal: '', parentId: a.id })
    const b = goal(db, { goal: 'B' })
    db.goalMap = updateGoal(db, a.id, { goal: 'A 改', reason: '新理由' })
    expect(db.goalMap.history.map((item) => item.type)).toEqual(['create-head', 'create-child', 'create-head'])
    const combined = merge(db, { ids: [b.id, a.id], goal: '統合' })
    expect(combined.children).toEqual([b.id, a.id])
    expect(db.goalMap.nodes[a.id]!.children).toEqual([child.id])
    expect(db.goalMap.heads).toEqual([combined.id])
    expect(goalHead(db.goalMap, child.id)).toBe(combined.id)
    const promoted = merge(db, { ids: [combined.id], goal: '上位' })
    expect(db.goalMap.history.at(-1)).toMatchObject({ type: 'promote', nodeId: promoted.id, withIds: [combined.id] })
    expect(parseGoalMap(db.goalMap)).toEqual(db.goalMap)
  })

  it('祖先を隠した枝は不可視になり、復元は祖先も戻し元の構造と履歴を残す', () => {
    const db = normalizeDatabase({})
    const head = goal(db, { goal: '上位' })
    const child = goal(db, { goal: '子', parentId: head.id })
    const leaf = goal(db, { goal: '孫', parentId: child.id })
    const sibling = goal(db, { goal: '別の子', parentId: head.id })
    db.goalMap = hideGoal(db, child.id, ' 試行終了 ')
    db.goalMap = hideGoal(db, sibling.id, '独立した理由')
    db.goalMap = hideGoal(db, head.id, '一旦休止')
    expect(isGoalHidden(db.goalMap, leaf.id)).toBe(true)
    expect(layoutGoals(db.goalMap, head.id, false)).toEqual({})
    expect(db.goalMap.activeHeadId).toBe(null)
    expect(() => createGoal(db, { goal: '追加', parentId: leaf.id })).toThrow('隠した枝')
    db.goalMap = restoreGoal(db, leaf.id)
    expect(isGoalHidden(db.goalMap, leaf.id)).toBe(false)
    expect(isGoalHidden(db.goalMap, sibling.id)).toBe(true)
    expect(db.goalMap.nodes[child.id]).toMatchObject({ hidden: false, hiddenAt: null, hideReason: '' })
    expect(db.goalMap.activeHeadId).toBe(head.id)
    expect(db.goalMap.nodes[head.id]!.children).toEqual([child.id, sibling.id])
    expect(db.goalMap.history.find((item) => item.nodeId === child.id && item.type === 'hide')).toMatchObject({ note: '試行終了', parentId: head.id })
    expect(db.goalMap.history.at(-1)).toMatchObject({ type: 'unhide', nodeId: leaf.id })
    const count = db.goalMap.history.length
    db.goalMap = restoreGoal(db, leaf.id)
    expect(db.goalMap.history).toHaveLength(count)
  })

  it('重複・子・非表示ヘッドの統合や不正な関連付けを拒否する', () => {
    const db = normalizeDatabase({})
    const a = goal(db, { goal: 'A' })
    const child = goal(db, { goal: '子', parentId: a.id })
    const hidden = goal(db, { goal: '隠す' })
    db.goalMap = hideGoal(db, hidden.id, '')
    for (const ids of [[], [a.id, a.id], [child.id], [hidden.id], ['missing']]) {
      expect(() => mergeGoals(db, { ids, goal: '拒否' })).toThrow()
    }
    expect(() => createTask(db, { title: 'x', goalNodeId: 'missing' })).toThrow()
    expect(() => createIssue(db, { text: 'x', kind: 'idea', nodeId: 'missing' })).toThrow()
    expect(() => createIssue(db, { text: 'x', kind: 'idea', nodeId: 'toString' })).toThrow()
    expect(() => createTask(db, { title: 'x', goalNodeId: 'valueOf' })).toThrow()
    expect(() => updateGoalUi(db, { activeHeadId: child.id })).toThrow()
  })

  it('通常タスクの更新・完了と道標の関連付けは同じTaskを更新する', () => {
    const db = normalizeDatabase({})
    const target = goal(db, { goal: '目標' })
    const created = task(db, { title: '一歩', goalNodeId: target.id, due: '2026-10-03' })
    db.tasks = updateTask(db, created.id, { title: '同じ一歩', status: 'done', priority: 'high' })
    expect(db.tasks).toHaveLength(1)
    expect(db.tasks[0]).toMatchObject({ id: created.id, title: '同じ一歩', goalNodeId: target.id, due: '2026-10-03', status: 'done', progress: 100 })
    db.tasks = updateTask(db, created.id, { status: 'todo', due: null })
    expect(db.tasks[0]!.doneAt).toBe(null)
    expect(db.tasks[0]!.due).toBe(null)
    expect(() => updateTask(db, created.id, { title: '壊さない', due: '2026-02-30' })).toThrow()
    expect(() => updateTask(db, created.id, { title: '  ' })).toThrow('タスク名を入力してください')
    const added = issue(db, { kind: 'idea', text: '  改善  ', nodeId: target.id })
    expect(added.text).toBe('改善')
    db.goalMap = updateIssue(db, added.id, { text: '共通の編集', resolved: true })
    expect(db.goalMap.issues).toHaveLength(1)
    expect(db.goalMap.issues[0]).toMatchObject({ id: added.id, text: '共通の編集', resolved: true, nodeId: target.id })
    expect(() => updateIssue(db, added.id, { text: '  ' })).toThrow('問題の内容を入力してください')
  })

  it('葉は114px間隔・列は360px間隔で親は子の中点に置く', () => {
    const db = normalizeDatabase({})
    const head = goal(db, { goal: 'head' })
    const a = goal(db, { goal: 'a', parentId: head.id })
    const b = goal(db, { goal: 'b', parentId: head.id })
    const leaf = goal(db, { goal: 'leaf', parentId: b.id })
    expect(layoutGoals(db.goalMap, head.id)).toEqual({
      [a.id]: { x: 360, y: 0 }, [leaf.id]: { x: 720, y: 114 },
      [b.id]: { x: 360, y: 114 }, [head.id]: { x: 0, y: 57 },
    })
    db.goalMap = hideGoal(db, a.id, '')
    expect(layoutGoals(db.goalMap, head.id)[head.id]).toEqual({ x: 0, y: 0 })
    expect(layoutGoals(db.goalMap, head.id, true)[head.id]).toEqual({ x: 0, y: 57 })
  })
})

describe('道標JSONの追加取り込み', () => {
  it('旧版で記録した取込指紋を維持し、同じデータの再取込を防ぐ', () => {
    const db = normalizeDatabase({})
    const source = { version: 1, nodes: { n1: { id: 'n1', goal: '研究テーマを決める', reason: '', parentId: null, children: [] } }, heads: ['n1'], activeHeadId: 'n1' }
    db.goalMapImports = ['56c9340f461846e4fcd53b8cc3692c47ed4b162d3048be27637f27a7e7181bce']
    expect(() => importGoals(db, source)).toThrow('取り込み済み')
  })

  it('全IDと参照を振り直し、既存データ・本文・順序・UIを保持する', () => {
    const db = normalizeDatabase({})
    const existing = goal(db, { goal: '既存' })
    task(db, { title: '既存タスク' })
    const before = structuredClone(db)
    const source = legacy()
    expect(importInto(db, source)).toEqual({ nodes: 2, tasks: 2, issues: 1, history: 2 })
    expect(db.goalMap.nodes[existing.id]).toEqual(before.goalMap.nodes[existing.id])
    expect(db.tasks[0]).toEqual(before.tasks[0])
    expect(db.goalMap.ui).toEqual(source.ui)
    const headId = db.goalMap.heads[1]!
    const childId = db.goalMap.nodes[headId]!.children[0]!
    expect(headId).not.toBe('n1')
    expect(childId).not.toBe('n2')
    expect(db.goalMap.nodes[childId]).toMatchObject({ parentId: headId, goal: '分岐', hidden: true, hiddenAt: 200, hideReason: '別の道を選ぶ' })
    expect(db.goalMap.issues[0]).toMatchObject({ nodeId: childId, text: '難点' })
    expect(db.goalMap.history.at(-1)).toMatchObject({ nodeId: childId, parentId: headId, note: '別の道を選ぶ' })
    expect(db.tasks.slice(1)).toMatchObject([{ priority: 'normal', due: '2026-10-03', status: 'todo' }, { priority: 'high', due: null, status: 'done', progress: 100, doneAt: null, createdAt: 200 }])
    for (const id of [...db.tasks.slice(1), ...db.goalMap.issues, ...db.goalMap.history.slice(1)].map((item) => item.id)) expect(['t1', 't2', 'i1', 'h1', 'h2']).not.toContain(id)
    expect(parseGoalMap(db.goalMap)).toEqual(db.goalMap)
    expect(() => importGoals(db, { ...source, seq: 999 })).toThrow('取り込み済み')
  })

  it('初期v1の追加フィールド欠落だけを既定値で補う', () => {
    const db = normalizeDatabase({})
    importInto(db, { version: 1, nodes: { n1: { id: 'n1', goal: '初期', reason: '', parentId: null, children: [] } }, heads: ['n1'], activeHeadId: 'n1' })
    expect(db.goalMap.nodes[db.goalMap.heads[0]!]).toMatchObject({ hidden: false, hiddenAt: null, hideReason: '' })
    expect(db.goalMap.ui).toEqual(emptyGoalMap().ui)
  })

  it.each([
    ['循環', (data: ReturnType<typeof legacy>) => { data.nodes.n1.parentId = 'n2' as never; data.nodes.n2.children = ['n1'] as never; data.heads = []; data.activeHeadId = null as never }],
    ['参照先不在', (data: ReturnType<typeof legacy>) => { data.nodes.n1.children.push('missing') }],
    ['親子不一致', (data: ReturnType<typeof legacy>) => { data.nodes.n2.parentId = 'missing' }],
    ['問題の参照先不在', (data: ReturnType<typeof legacy>) => { data.issues[0]!.nodeId = 'missing' }],
    ['継承プロパティを指す問題', (data: ReturnType<typeof legacy>) => { data.issues[0]!.nodeId = 'toString' }],
    ['継承プロパティを指す履歴', (data: ReturnType<typeof legacy>) => { data.history[0]!.nodeId = 'valueOf' }],
    ['履歴の参照先不在', (data: ReturnType<typeof legacy>) => { data.history[0]!.withIds = ['missing'] as never }],
    ['重複ヘッド', (data: ReturnType<typeof legacy>) => { data.heads.push('n1') }],
    ['不正な締切', (data: ReturnType<typeof legacy>) => { data.tasks[0]!.due = '2026-02-30' }],
    ['重複タスク', (data: ReturnType<typeof legacy>) => { data.tasks.push(data.tasks[0]!) }],
    ['不正なUI', (data: ReturnType<typeof legacy>) => { data.ui.view = 'unknown' }],
  ])('%sは拒否する', (_name, corrupt) => {
    const db = normalizeDatabase({})
    goal(db, { goal: '保持' })
    task(db, { title: '保持' })
    const data = legacy()
    corrupt(data)
    expect(() => importGoals(db, data)).toThrow()
  })
})

describe('保存と旧White Boxの移行', () => {
  it('旧DBの既存項目を変えず空の道標を補い、取り込み後も再読込と置換で保持する', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-goals-'))
    temporaryDirs.push(dir)
    const old = { version: 1, projects: [], tasks: [], sessions: [], dayNotes: { '2026-09-24': '残す' } }
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(old))
    const store = new Store(dir)
    expect(store.data.goalMap).toEqual(emptyGoalMap())
    expect(store.data.dayNotes).toEqual(old.dayNotes)
    importInto(store.data, legacy())
    store.save()
    const saved = structuredClone(store.data)
    const reopened = new Store(dir)
    const expected = { ...saved, settings: { ...saved.settings, onboardedAt: expect.any(Number) } }
    expect(reopened.data).toEqual(expected)
    expect(() => importGoals(reopened.data, legacy())).toThrow('取り込み済み')
    reopened.replace(JSON.parse(JSON.stringify(reopened.data)))
    expect(new Store(dir).data).toEqual(expected)
    expect(fs.readdirSync(path.join(dir, 'backups')).some((file) => file.startsWith('before-import-'))).toBe(true)
  })

  it('道標を持つ data.json を読んで保存し直しても道標が消えない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-goals-'))
    temporaryDirs.push(dir)
    const store = new Store(dir)
    goal(store.data, { goal: '保持' })
    store.save()
    const reopened = new Store(dir)
    reopened.save()
    expect(Object.values(JSON.parse(fs.readFileSync(reopened.dbPath, 'utf8')).goalMap.nodes)).toMatchObject([{ goal: '保持' }])
  })

  it('不正な道標を含む置換は保存済みDBを上書きしない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitebox-goals-'))
    temporaryDirs.push(dir)
    const store = new Store(dir)
    goal(store.data, { goal: '保持' })
    store.save()
    const before = fs.readFileSync(store.dbPath, 'utf8')
    expect(() => store.replace({ ...store.data, goalMap: { ...emptyGoalMap(), heads: ['missing'] } as GoalMap })).toThrow()
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(before)
  })
})

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'

function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
  const transformed = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(transformed, { exports, require: (name) => { if (!(name in imports)) throw new Error(`Missing probe import: ${name}`); return imports[name] }, console, setTimeout, clearTimeout,
    window: { addEventListener() {}, removeEventListener() {} }, crypto: globalThis.crypto }, { filename: relative })
  return exports
}
function hooks() {
  let slots = [], cursor = 0, pendingEffects = []
  const react = {
    forwardRef: (render) => render,
    useRef: (initial) => { const index = cursor++; return slots[index] ??= { current: initial } },
    useState: (initial) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useEffect: (effect, deps) => { const index = cursor++; const old = slots[index]; if (!old || !deps || deps.some((value, key) => value !== old[key])) pendingEffects.push(effect); slots[index] = deps },
    useImperativeHandle: (ref, create) => { ref.current = create() },
  }
  return { react, render: (component, props, ref) => { cursor = 0; pendingEffects = []; const tree = component(props, ref); pendingEffects.forEach((effect) => effect()); return tree } }
}
const goalHooks = hooks(), titleHooks = hooks(), windowHooks = hooks()
let activeHooks = goalHooks
const react = Object.fromEntries(Object.keys(goalHooks.react).map((key) => [key, (...args) => activeHooks.react[key](...args)]))
const unused = () => null
const original = { id: 'done', title: 'Original done task', status: 'done', createdAt: 1, priority: 'normal', due: null }
const data = { tasks: [original], projects: [], goalMap: { nodes: {}, ui: { doneOpen: true } } }
let rejectTitle
const savingTitle = new Promise((_resolve, reject) => { rejectTitle = reject })
let collapseWrites = 0
const editorFlush = load('apps/renderer/src/lib/editor-flush.ts')
const flushHooks = load('apps/renderer/src/lib/useEditorFlush.ts', {
  react, './bridge': { onFlushRequested: () => () => {} }, './editor-flush': editorFlush,
})
activeHooks = windowHooks
const windowFlush = windowHooks.render(() => flushHooks.useEditorFlush(async () => true), {}, {})
const { GoalTasks } = load('apps/renderer/src/features/goals/GoalTasks.tsx', {
  react,
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  '@white-box/core/engine': { dayKey: () => '2026-10-06' },
  '@/lib/bridge': { invoke: async (name) => {
    if (name === 'task:update') return savingTitle
    if (name === 'goal:ui') { collapseWrites++; data.goalMap.ui.doneOpen = false; return null }
    throw new Error(`Unexpected command ${name}`)
  } },
  '@/stores/app': { useData: () => data, useApp: (selector) => selector({ now: 1000 }) },
  '@/components/ui': { Modal: unused },
  '@/features/board/TaskDetail': { TaskDetail: unused },
  '@/lib/useEditorFlush': flushHooks,
  '@/features/task-control/task-title-draft': load('apps/renderer/src/features/task-control/task-title-draft.ts'),
})
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((item) => nodes(item, predicate))
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)]
}
const goalRef = {}
function renderGoal() { activeHooks = goalHooks; return goalHooks.render(GoalTasks, { onJump: unused }, goalRef) }
let goalTree = renderGoal()
const titleNode = nodes(goalTree, (node) => typeof node.type === 'function' && node.type.name === 'TaskTitle')[0]
function renderTitle() { activeHooks = titleHooks; return titleHooks.render(titleNode.type, titleNode.props, {}) }
let titleTree = renderTitle()
nodes(titleTree, (node) => node.type === 'input')[0].props.onChange({ target: { value: 'New unsaved done title' } })
renderTitle()
nodes(goalTree, (node) => node.type === 'button' && node.props.className === 'btn btn-quiet btn-md gm-task-done')[0].props.onClick()
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
goalTree = renderGoal()
assert.equal(collapseWrites, 0)
assert.equal(windowFlush.isFrozen(), true)
assert.equal(nodes(goalTree, (node) => typeof node.type === 'function' && node.type.name === 'TaskTitle').length, 1)
rejectTitle(new Error('Title cannot be saved'))
await new Promise((resolve) => setImmediate(resolve))
titleTree = renderTitle()
assert.equal(nodes(titleTree, (node) => node.props?.role === 'alert').length > 0, true)
assert.equal(original.title, 'Original done task')
assert.equal(collapseWrites, 0)
assert.equal(windowFlush.isFrozen(), false)
goalTree = renderGoal()
assert.equal(nodes(goalTree, (node) => typeof node.type === 'function' && node.type.name === 'TaskTitle').length, 1)
console.log('PASS GoalTasks completed-row collapse: actual runEditorAction freezes window, waits for actual title participant, and failed title save leaves completed row/editor mounted with error.')

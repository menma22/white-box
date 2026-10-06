import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'

const root = process.cwd()
function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const transformed = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(transformed, {
    exports,
    require: (name) => { if (!(name in imports)) throw new Error(`Missing probe import: ${name}`); return imports[name] },
    setTimeout, clearTimeout, console,
  }, { filename: relative })
  return exports
}
function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const { OptionalDurationDraft } = load('apps/renderer/src/features/task-control/optional-duration-draft.ts')
const effects = []
const { useDraftParticipant, flushDraftParticipants } = load('apps/renderer/src/lib/useEditorFlush.ts', {
  react: { useRef: (current) => ({ current }), useEffect: (effect) => effects.push(effect), useState: () => {} },
  './bridge': {}, './editor-flush': {},
})
const writes = []
const first = new OptionalDurationDraft(30, async (minutes) => { writes.push(minutes) })
const blocked = deferred()
useDraftParticipant(() => first.flush())
useDraftParticipant(() => blocked.promise)
effects.forEach((effect) => effect())
first.update('90')
const leaving = flushDraftParticipants()
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
assert.equal(first.snapshot().flushing, false)
first.focus(true)
first.update('120')
blocked.resolve(true)
assert.equal(await leaving, true)
assert.deepEqual(writes, [90])
assert.equal(first.snapshot().draft, '120')
console.log('BASELINE sequential helper: first participant unlocks while later participant is pending; production callers need whole-surface protection.')

const { EditorFlush } = load('apps/renderer/src/lib/editor-flush.ts')
const nextBlocked = deferred()
const localAction = new EditorFlush(() => nextBlocked.promise, () => {})
let actionCalled = false
const guardedNavigation = localAction.run('local-navigation', () => {
  assert.equal(localAction.snapshot().frozen, true)
  actionCalled = true
})
assert.equal(localAction.snapshot().frozen, true)
assert.equal(await localAction.run('second-navigation', () => {}), false)
nextBlocked.resolve(true)
assert.equal(await guardedNavigation, true)
assert.equal(actionCalled, true)
assert.equal(localAction.snapshot().frozen, false)
console.log('PASS whole-surface local navigation signal stays frozen through pending saves and navigation action, rejects a concurrent navigation, then releases.')

function hookHarness() {
  let slots = [], cursor = 0, pendingEffects = []
  const react = {
    forwardRef: (render) => render,
    useRef: (initial) => { const index = cursor++; return slots[index] ??= { current: initial } },
    useState: (initial) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
    useEffect: (effect, deps) => {
      const index = cursor++
      const old = slots[index]
      if (!old || !deps || deps.some((value, key) => value !== old[key])) pendingEffects.push(effect)
      slots[index] = deps
    },
    useImperativeHandle: (ref, create) => { ref.current = create() },
  }
  return { react, render: (component, props, ref) => {
    cursor = 0
    pendingEffects = []
    const result = component(props, ref)
    pendingEffects.forEach((effect) => effect())
    return result
  } }
}
const harness = hookHarness()
const pending = deferred()
const invocations = []
let databaseNotes = 'original'
const context = load('apps/renderer/src/features/board/context-draft.ts')
const { TaskContextEditor } = load('apps/renderer/src/features/board/TaskContextEditor.tsx', {
  react: harness.react,
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  '@/lib/bridge': { invoke: async (_name, args) => {
    invocations.push(args)
    if (invocations.length === 1) { databaseNotes = args.patch.notes; return pending.promise }
    if (args.expectedContext.notes !== databaseNotes) throw new Error('same-field guard rejected stale expectedContext')
    databaseNotes = args.patch.notes
  } },
  './TaskLinkedNotes': { TaskLinkedNotes: () => null },
  '@/lib/useEditorFlush': { useDraftParticipant: () => {} },
  './context-draft': context,
})
let task = { id: 't', notes: 'original', problems: '', decisions: '', nextContext: '' }
const ref = {}
function render() { return harness.render(TaskContextEditor, { task }, ref) }
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((item) => nodes(item, predicate))
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)]
}
let tree = render()
nodes(tree, (node) => node.type === 'button' && node.props.children === '編集')[0].props.onClick()
tree = render()
nodes(tree, (node) => node.type === 'textarea')[0].props.onChange({ target: { value: 'own saved' } })
tree = render()
const ownSaving = ref.current.flush()
render()
task = { ...task, notes: 'own saved' }
render(); render()
databaseNotes = 'new remote saved'
task = { ...task, notes: databaseNotes }
render(); render()
pending.resolve(null)
assert.equal(await ownSaving, true)
tree = render()
assert.equal(nodes(tree, (node) => node.type === 'textarea')[0].props.value, 'new remote saved')
nodes(tree, (node) => node.type === 'textarea')[0].props.onChange({ target: { value: 'newer local draft' } })
render()
assert.equal(await ref.current.flush(), true)
assert.equal(invocations[1].expectedContext.notes, 'new remote saved')
assert.equal(databaseNotes, 'newer local draft')
assert.equal(await ref.current.flush(), true)
assert.equal(invocations.length, 2)
console.log('PASS TaskContext response race: own save response preserves newer remote baseline; next edit uses current expected value, saves, and can flush cleanly.')

const titleHarness = hookHarness()
const titlePending = deferred()
let detailClosed = false
let titleWriteSettled = false
const titleTask = { id: 't', title: 'Original title', projectId: null, notes: '', status: 'todo', progress: 0 }
const unused = () => null
const { TaskDetail } = load('apps/renderer/src/features/board/TaskDetail.tsx', {
  react: titleHarness.react,
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  '@/lib/bridge': { invoke: async () => { try { return await titlePending.promise } finally { titleWriteSettled = true } } },
  '@/stores/app': { useData: () => ({ tasks: [titleTask], projects: [], sessions: [], settings: {}, goalMap: { nodes: {} } }), useApp: (selector) => selector({ now: 1000 }) },
  '@/lib/selectors': { taskById: () => titleTask, ancestorTitles: () => [], childrenOf: () => [], focusByTask: () => new Map(), lastTouchedAt: () => 0, STATUS_LABEL: {}, STATUS_ORDER: ['todo'] },
  '@/components/ui': { Modal: unused, ProgressBar: unused, Segmented: unused, useEscape: unused },
  '@white-box/core/engine': { formatDuration: () => '' },
  '@white-box/core/task-priority': { taskControl: () => ({}) },
  '@/features/task-control/OptionalDurationField': { OptionalDurationField: unused },
  '@/features/task-control/TaskRiskSummary': { TaskRiskSummary: unused },
  '@white-box/core/task-control': { taskExecutionProblem: () => null },
  './TaskControlEditor': { TaskControlEditor: unused },
  './TaskContextEditor': { TaskContextEditor: unused },
  './FixedWorkOverview': { FixedWorkOverview: unused },
  '@/lib/useEditorFlush': { flushDraftParticipants: async () => true },
  '@/features/task-control/task-title-draft': load('apps/renderer/src/features/task-control/task-title-draft.ts'),
})
const detailRef = {}
function renderDetail() { return titleHarness.render(TaskDetail, { taskId: 't', onClose: () => { detailClosed = true } }, detailRef) }
let detailTree = renderDetail()
nodes(detailTree, (node) => node.type === 'textarea' && node.props.className === 'detail-title')[0].props.onChange({ target: { value: 'User title draft' } })
detailTree = renderDetail()
nodes(detailTree, (node) => node.type === 'textarea' && node.props.className === 'detail-title')[0].props.onBlur()
nodes(detailTree, (node) => node.type === 'button' && node.props.className === 'detail-close')[0].props.onClick()
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
assert.equal(detailClosed, false)
assert.equal(titleWriteSettled, false)
titlePending.reject(new Error('Storage failure after detail closed'))
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
assert.equal(titleWriteSettled, true)
assert.equal(titleTask.title, 'Original title')
assert.equal(detailClosed, false)
detailTree = renderDetail()
assert.equal(nodes(detailTree, (node) => node.type === 'textarea' && node.props.className === 'detail-title')[0].props.value, 'User title draft')
assert.equal(nodes(detailTree, (node) => node.props?.role === 'alert').length > 0, true)
console.log('PASS TaskDetail title: close waits for pending blur save; failure blocks close and retains input with visible error.')

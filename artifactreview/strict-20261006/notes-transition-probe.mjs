import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'

function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
  const transformed = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(transformed, { exports, require: (name) => {
    if (!(name in imports)) throw new Error(`Missing probe import: ${name}`)
    return imports[name]
  }, setTimeout, clearTimeout, console }, { filename: relative })
  return exports
}
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
const original = { id: 'n', title: 'Original note', body: 'Saved body', projectId: null, taskId: null, pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 1, updatedAt: 1 }
const { NoteAutosave } = load('apps/renderer/src/features/notes/note-autosave.ts')
const oldEditor = new NoteAutosave(original, async () => { throw new Error('Storage failure for last input') }, 100_000)
let creationResolve
const creation = new Promise((resolve) => { creationResolve = resolve })
let creationOutcome = creation
let creatingStarted = false
const Button = () => null
const NoteEditor = () => null
const { NotesView } = load('apps/renderer/src/features/notes/NotesView.tsx', {
  react,
  'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  '@white-box/core/notes': { noteTitle: (note) => note.title, selectNotes: (notes) => notes },
  '@/components/ui': { Button },
  '@/lib/bridge': { invoke: async () => { creatingStarted = true; return creationOutcome } },
  './NoteEditor': { NoteEditor },
})
const data = { notes: [original], projects: [], tasks: [] }
const ref = {}
function render() {
  cursor = 0
  pendingEffects = []
  const result = NotesView({ data }, ref)
  pendingEffects.forEach((effect) => effect())
  return result
}
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((item) => nodes(item, predicate))
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)]
}
let tree = render()
const refs = slots.filter((slot) => slot && typeof slot === 'object' && Object.hasOwn(slot, 'current'))
refs[2].current = { flush: () => oldEditor.flush() }
nodes(tree, (node) => node.type === 'button' && node.props.className?.startsWith('note-list-item'))[0].props.onClick()
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
tree = render()
assert.equal(nodes(tree, (node) => node.type === NoteEditor)[0].props.note.id, 'n')
nodes(tree, (node) => node.type === Button && node.props.children === 'ノートを追加')[0].props.onClick()
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
assert.equal(creatingStarted, true)
tree = render()
const displayedOld = nodes(tree, (node) => node.type === NoteEditor)[0]
assert.equal(displayedOld.props.note.id, 'n')
assert.equal(tree.props.inert, true)
assert.equal(tree.props['aria-busy'], true)
creationResolve({ ...original, id: 'new', title: '' })
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
tree = render()
assert.equal(nodes(tree, (node) => node.type === NoteEditor)[0].props.note.id, 'new')
assert.equal(tree.props.inert, false)
assert.equal(await oldEditor.flush(), true)
assert.equal(original.body, 'Saved body')

let creationReject
creationOutcome = new Promise((_resolve, reject) => { creationReject = reject })
nodes(tree, (node) => node.type === Button && node.props.children === 'ノートを追加')[0].props.onClick()
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
tree = render()
assert.equal(tree.props.inert, true)
creationReject(new Error('New note cannot be saved'))
for (let turn = 0; turn < 10; turn++) await Promise.resolve()
tree = render()
assert.equal(tree.props.inert, false)
assert.equal(nodes(tree, (node) => node.type === NoteEditor)[0].props.note.id, 'new')
assert.equal(nodes(tree, (node) => node.props?.role === 'alert').length > 0, true)
console.log('PASS NotesView create: ancestor stays inert throughout awaited create, releases after success, and failure preserves selected editor with error.')

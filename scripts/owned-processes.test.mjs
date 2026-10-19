import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OwnedProcesses } from './owned-processes.mjs'

const process = (ProcessId, ParentProcessId, second, Name = 'electron.exe') => ({
  ProcessId, ParentProcessId, Name, CreationDate: `2026-10-06T00:00:${String(second).padStart(2, '0')}.0000000Z`,
})
const root = process(10, 1, 0)
const child = process(20, 10, 1)
const grandchild = process(30, 20, 2)
const tracker = () => { const owned = new OwnedProcesses(); owned.registerRoot(root); return owned }
const pids = (observation) => observation.remaining.map((process) => process.ProcessId).sort((a, b) => a - b)
const oldPidHeuristic = (inventory, ownedPids) => {
  let added
  do {
    added = false
    for (const item of inventory) if (ownedPids.has(item.ParentProcessId) && !ownedPids.has(item.ProcessId)) { ownedPids.add(item.ProcessId); added = true }
  } while (added)
  return inventory.filter((item) => ownedPids.has(item.ProcessId))
}

test('positive baseline detects root, child and grandchild independent of inventory order', () => {
  const owned = tracker()
  const inventory = [grandchild, child, root, process(99, 1, 0, 'unrelated.exe')]
  assert.deepEqual(pids(owned.observe(inventory)), [10, 20, 30])
  assert.deepEqual(oldPidHeuristic(inventory, new Set([10])).map((item) => item.ProcessId).sort(), [10, 20, 30])
  assert.equal(owned.owns(grandchild), true)
})

test('registered orphan descendants remain detectable after their parent exits', () => {
  const owned = tracker()
  owned.observe([root, child, grandchild])
  assert.deepEqual(pids(owned.observe([grandchild])), [30])
  assert.equal(owned.owns(grandchild), true)
  assert.deepEqual(pids(owned.observe([])), [])
})

test('a surviving owned child can register its new descendant after the root exits', () => {
  const owned = tracker()
  owned.observe([root, child])
  assert.deepEqual(pids(owned.observe([child, grandchild])), [20, 30])
})

for (const name of ['electron.exe', 'unrelated.exe']) {
  test(`root PID reuse by ${name} is excluded and does not own replacement descendants`, (t) => {
    const owned = tracker()
    owned.observe([root, child, grandchild])
    const replacement = process(10, 1, 10, name)
    const unrelatedChild = process(40, 10, 11, name)
    const observation = owned.observe([replacement, unrelatedChild])
    const oldRemaining = oldPidHeuristic([replacement, unrelatedChild], new Set([10, 20, 30]))
    assert.deepEqual(pids(observation), [])
    assert.equal(owned.owns(replacement), false)
    assert.equal(owned.owns(unrelatedChild), false)
    assert.deepEqual(observation.reused, [{ expected: root, current: replacement }])
    assert.throws(() => assert.deepEqual(oldRemaining, []), assert.AssertionError)
    t.diagnostic(JSON.stringify({ oldWronglyReports: oldRemaining, identityRemaining: observation.remaining, reused: observation.reused }))
  })

  test(`child PID reuse by ${name} cannot own replacement grandchildren`, () => {
    const owned = tracker()
    owned.observe([root, child, grandchild])
    const replacement = process(20, 99, 10, name)
    const unrelatedGrandchild = process(40, 20, 11, name)
    const observation = owned.observe([root, replacement, unrelatedGrandchild, grandchild])
    assert.deepEqual(pids(observation), [10, 30])
    assert.equal(owned.owns(replacement), false)
    assert.equal(owned.owns(unrelatedGrandchild), false)
    assert.deepEqual(observation.reused, [{ expected: child, current: replacement }])
  })
}

test('a genuinely new child of the same live root is registered even when its PID was reused', () => {
  const owned = tracker()
  owned.observe([root, child])
  const replacement = process(20, 10, 10)
  assert.deepEqual(pids(owned.observe([root, replacement])), [10, 20])
  assert.equal(owned.owns(replacement), true)
  assert.equal(owned.owns(child), false)
})

test('separate launches retain earlier orphan identities and track the new root and child', () => {
  const owned = tracker()
  owned.observe([root, child])
  owned.observe([child])
  const nextRoot = process(50, 1, 10)
  const nextChild = process(60, 50, 11)
  owned.registerRoot(nextRoot)
  assert.deepEqual(pids(owned.observe([nextChild, child, nextRoot])), [20, 50, 60])
})

test('explicitly registered second launch can reuse the root PID without claiming an older orphan', () => {
  const owned = tracker()
  owned.observe([root, child])
  const nextRoot = process(10, 1, 10)
  const unseenOldChild = process(40, 10, 2)
  const nextChild = process(50, 10, 11)
  owned.registerRoot(nextRoot)
  const observation = owned.observe([nextRoot, nextChild, unseenOldChild, child])
  assert.deepEqual(pids(observation), [10, 20, 50])
  assert.equal(owned.owns(unseenOldChild), false)
  assert.deepEqual(observation.reused, [{ expected: root, current: nextRoot }])
})

test('root registration checks launch parent, executable and lower creation-time bound', () => {
  const expected = { parentPid: 1, name: 'electron.exe', notBefore: Date.parse(root.CreationDate) }
  const owned = new OwnedProcesses()
  owned.registerRoot(root, expected)
  assert.throws(() => new OwnedProcesses().registerRoot(root, { ...expected, parentPid: 2 }))
  assert.throws(() => new OwnedProcesses().registerRoot(root, { ...expected, name: 'other.exe' }))
  assert.throws(() => new OwnedProcesses().registerRoot(root, { ...expected, notBefore: expected.notBefore + 1 }))
})

test('creation ordering retains sub-millisecond precision when excluding a stale parent PID', () => {
  const owned = new OwnedProcesses()
  const nextRoot = { ...root, CreationDate: '2026-10-06T00:00:00.0000002Z' }
  const staleChild = { ...child, CreationDate: '2026-10-06T00:00:00.0000001Z' }
  owned.registerRoot(nextRoot)
  assert.deepEqual(pids(owned.observe([nextRoot, staleChild])), [10])
})

test('missing owned creation times fail observation instead of reporting a false absence', () => {
  const owned = tracker()
  assert.throws(() => owned.observe([{ ...root, CreationDate: null }]), /Cannot verify creation time/)
  assert.throws(() => owned.observe([root, { ...child, CreationDate: null }]), /Cannot verify creation time/)
  assert.deepEqual(pids(owned.observe([root, { ...process(99, 1, 0), CreationDate: null }])), [10])
})

test('a repeated snapshot preserves reuse evidence after the stale identity was pruned', () => {
  const owned = tracker()
  const replacement = process(10, 1, 10)
  const first = owned.observe([replacement])
  const second = owned.observe([replacement])
  assert.deepEqual(second, first)
  assert.deepEqual(second.registered, [])
})

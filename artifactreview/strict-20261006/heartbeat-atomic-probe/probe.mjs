import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'

const OWNER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(OWNER, '../../..')
const RUN = fs.mkdtempSync(path.join(OWNER, 'run-'))
const MINUTE = 60_000
const startedAt = Date.UTC(2026, 9, 6, 0)
const goodAt = startedAt + 30 * MINUTE
const failedAt = goodAt + 1000
const nextAt = goodAt + 2000
const restartedAt = startedAt + 60 * MINUTE
const nativeWrite = fs.writeFileSync
const nativeRemove = fs.rmSync
const originalNow = Date.now
const sources = new Map()
const hashes = {}
const dataUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
const electronStub = dataUrl("export const app = { getPath() { throw new Error('Native user-data lookup is prohibited in this probe') } }")

async function sourceUrl(filename) {
  filename = path.resolve(filename)
  if (sources.has(filename)) return sources.get(filename)
  const source = fs.readFileSync(filename, 'utf8')
  hashes[path.relative(ROOT, filename).replaceAll(path.sep, '/')] = createHash('sha256').update(source).digest('hex')
  let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  const dependencies = new Map()
  for (const match of compiled.matchAll(/from\s+(['"])([^'"]+)\1/g)) {
    const specifier = match[2]
    if (dependencies.has(specifier)) continue
    const resolved = specifier === 'electron' ? electronStub
      : specifier.startsWith('.') ? await sourceUrl(path.resolve(path.dirname(filename), specifier.replace(/\.js$/, '.ts')))
      : specifier.startsWith('node:') ? specifier : import.meta.resolve(specifier)
    dependencies.set(specifier, resolved)
  }
  compiled = compiled.replace(/from\s+(['"])([^'"]+)\1/g, (_match, _quote, specifier) => 'from ' + JSON.stringify(dependencies.get(specifier)))
  const url = dataUrl(compiled)
  sources.set(filename, url)
  return url
}

const { Store } = await import(await sourceUrl(path.join(ROOT, 'apps/desktop/src/infra/store.ts')))
const { restoreOpenSession } = await import(await sourceUrl(path.join(ROOT, 'apps/desktop/src/app/lifecycle.ts')))
const { createSession, closeAtLastKnown } = await import(await sourceUrl(path.join(ROOT, 'apps/desktop/src/domain/session-ops.ts')))
const { fakeCtx, task } = await import(await sourceUrl(path.join(ROOT, 'apps/desktop/tests/helpers.ts')))
const { focusMs } = await import(import.meta.resolve('@white-box/core/engine'))

function recovery(sourceDirectory, name) {
  const directory = path.join(RUN, name)
  fs.mkdirSync(directory)
  for (const filename of ['data.json', 'runtime.json']) fs.copyFileSync(path.join(sourceDirectory, filename), path.join(directory, filename))
  const store = new Store(directory)
  const marker = store.readLastAlive()
  const ctx = fakeCtx(store.data)
  ctx.store = store
  ctx.now = () => restartedAt
  restoreOpenSession(ctx)
  const closed = closeAtLastKnown(store.data.sessions[0], ctx.runtime.recovery.lastKnownAt)
  return { directory: path.relative(ROOT, directory).replaceAll(path.sep, '/'), marker, recoveryAt: ctx.runtime.recovery.lastKnownAt, recoveredFocusMs: focusMs(closed, restartedAt) }
}

const result = { sourceMode: 'current TypeScript transpiled in memory; Electron native user-data lookup stubbed only', startedAt, goodAt, failedAt, nextAt, restartedAt, writesConfinedTo: path.relative(ROOT, RUN).replaceAll(path.sep, '/'), productFilesChanged: false, clockMode: 'Date.now replaced only inside this standalone process; system clock untouched' }
try {
  fs.rmSync = () => { throw new Error('Deletion is prohibited in the heartbeat probe') }
  Date.now = () => startedAt
  const directory = path.join(RUN, 'original')
  const store = new Store(directory)
  store.data.tasks = [task({ id: 'heartbeat-probe-task', status: 'doing', createdAt: startedAt, updatedAt: startedAt })]
  store.data.sessions = [createSession({ taskId: 'heartbeat-probe-task', taskTitle: 'Heartbeat probe', mode: 'stopwatch', plannedMs: 50 * MINUTE, now: startedAt })]
  store.save()
  Date.now = () => goodAt
  store.markAlive()
  const goodBytes = fs.readFileSync(store.runtimePath, 'utf8')
  assert.equal(store.readLastAlive(), goodAt)
  result.goodBytes = goodBytes
  result.control = recovery(directory, 'restart-good')
  assert.equal(result.control.recoveredFocusMs, 30 * MINUTE)

  Date.now = () => failedAt
  let injectedWrites = 0
  fs.writeFileSync = function (destination, ...args) {
    if (path.resolve(String(destination)) === store.runtimePath) {
      injectedWrites++
      nativeWrite(store.runtimePath, '{"lastTickAt":', 'utf8')
      throw Object.assign(new Error('Injected partial write followed by ENOSPC'), { code: 'ENOSPC' })
    }
    return nativeWrite(destination, ...args)
  }
  let markAliveThrew = false
  try { store.markAlive() } catch { markAliveThrew = true }
  finally { fs.writeFileSync = nativeWrite }
  const failedBytes = fs.readFileSync(store.runtimePath, 'utf8')
  assert.equal(injectedWrites, 1)
  assert.equal(markAliveThrew, false)
  assert.notEqual(failedBytes, goodBytes)
  assert.equal(store.readLastAlive(), null)
  result.failure = { code: 'ENOSPC', model: 'runtime.json truncated and partially written before the write throws', markAliveThrew, injectedWrites, previousGoodBytesPreserved: failedBytes === goodBytes, bytes: failedBytes }
  result.corruptRestart = recovery(directory, 'restart-corrupt')
  assert.equal(result.corruptRestart.marker, null)
  assert.equal(result.corruptRestart.recoveryAt, startedAt)
  assert.equal(result.corruptRestart.recoveredFocusMs, 0)
  result.recoveryLossMs = result.control.recoveredFocusMs - result.corruptRestart.recoveredFocusMs
  assert.equal(result.recoveryLossMs, 30 * MINUTE)

  Date.now = () => nextAt
  store.markAlive()
  assert.equal(store.readLastAlive(), nextAt)
  result.nextSuccessfulHeartbeat = recovery(directory, 'restart-healed')
  assert.equal(result.nextSuccessfulHeartbeat.recoveryAt, nextAt)
  assert.equal(result.nextSuccessfulHeartbeat.recoveredFocusMs, 30 * MINUTE + 2000)

  const mainBefore = fs.readFileSync(store.dbPath, 'utf8')
  store.data.dayNotes['2026-10-06'] = 'Synthetic unsaved change'
  fs.writeFileSync = function (destination, ...args) {
    if (path.resolve(String(destination)) === store.dbPath + '.tmp') {
      nativeWrite(destination, '{"version":', 'utf8')
      throw Object.assign(new Error('Injected partial temporary write followed by ENOSPC'), { code: 'ENOSPC' })
    }
    return nativeWrite(destination, ...args)
  }
  let saveThrew = false
  try { store.save() } catch (error) { saveThrew = error.code === 'ENOSPC' }
  finally { fs.writeFileSync = nativeWrite }
  const mainAfter = fs.readFileSync(store.dbPath, 'utf8')
  assert.equal(saveThrew, true)
  assert.equal(mainAfter, mainBefore)
  const reopened = new Store(directory)
  assert.equal(reopened.data.dayNotes['2026-10-06'], undefined)
  result.mainDatabaseControl = { saveThrew, previousBytesPreserved: mainBefore === mainAfter, reloadedUnsavedChange: reopened.data.dayNotes['2026-10-06'] ?? null }
  result.limits = ['Fault injection demonstrates exception safety of filesystem writes, not an actual power-loss experiment.', 'Temporary-file replacement would preserve the previous marker on partial-write failure; it does not establish OS/disk power-loss durability without additional flush guarantees.', 'Loss requires an app interruption before another successful heartbeat; a later successful heartbeat repairs the marker, as tested.']
  result.sourceSha256 = hashes
  result.passed = true
} finally {
  fs.writeFileSync = nativeWrite
  fs.rmSync = nativeRemove
  Date.now = originalNow
}
fs.writeFileSync(path.join(RUN, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ run: result.writesConfinedTo, controlFocusMinutes: result.control.recoveredFocusMs / MINUTE, corruptFocusMinutes: result.corruptRestart.recoveredFocusMs / MINUTE, recoveryLossMinutes: result.recoveryLossMs / MINUTE, mainDatabasePreviousBytesPreserved: result.mainDatabaseControl.previousBytesPreserved, passed: result.passed }))

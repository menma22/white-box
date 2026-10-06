import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Store } from '../../../apps/desktop/src/infra/store.js'
import { prepareQuit, restoreOpenSession } from '../../../apps/desktop/src/app/lifecycle.js'
import { createSession } from '../../../apps/desktop/src/domain/session-ops.js'
import { fakeCtx, task } from '../../../apps/desktop/tests/helpers.js'

vi.mock('electron', () => ({ app: { getPath: () => { throw new Error('Production data access prohibited') } } }))

const outputDir = path.resolve('artifactreview/strict-20261006/shutdown-heartbeat-check')
const runDir = fs.mkdtempSync(path.join(outputDir, 'run-'))
const results: unknown[] = []
const expectedCancellation = process.env['EXPECT_HEARTBEAT_FAILURE_CANCELED'] === '1'
const provenance = Object.fromEntries([
  'apps/desktop/src/infra/store.ts',
  'apps/desktop/src/app/lifecycle.ts',
  'apps/desktop/src/presentation/main.ts',
].map((filename) => [filename, createHash('sha256').update(fs.readFileSync(filename)).digest('hex')]))

afterEach(() => {
  vi.restoreAllMocks()
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify({ expectedCancellation, provenance, results }, null, 2))
})

it.each(['none', 'runtime-write', 'runtime-rename'] as const)('real Store shutdown boundary: %s', (fault) => {
  const fixtureDir = path.join(runDir, fault)
  const store = new Store(fixtureDir)
  const ctx = fakeCtx()
  ctx.store = store
  const startedAt = Date.UTC(2026, 9, 6, 0, 0)
  const lastGoodAliveAt = startedAt + 55 * 60_000
  const quitAt = startedAt + 60 * 60_000
  const restartedAt = quitAt + 10 * 60_000
  let now = startedAt
  ctx.now = () => now
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  store.data.tasks = [task({ id: 'synthetic-task' })]
  store.data.sessions = [createSession({ taskId: 'synthetic-task', taskTitle: 'Synthetic task', mode: 'stopwatch', plannedMs: 3_600_000, now: startedAt })]
  store.save()
  now = lastGoodAliveAt
  store.markAlive()
  expect(store.readLastAlive()).toBe(lastGoodAliveAt)
  const originalWrite = fs.writeFileSync.bind(fs)
  const originalRename = fs.renameSync.bind(fs)
  let injectedFaults = 0
  let databaseRenames = 0
  vi.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
    if (fault === 'runtime-write' && String(args[0]) === `${store.runtimePath}.tmp`) {
      injectedFaults++
      throw Object.assign(new Error('Synthetic runtime write EACCES'), { code: 'EACCES' })
    }
    return originalWrite(...args)
  })
  vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (fault === 'runtime-rename' && String(destination) === store.runtimePath) {
      injectedFaults++
      throw Object.assign(new Error('Synthetic runtime rename EACCES'), { code: 'EACCES' })
    }
    if (String(destination) === store.dbPath) databaseRenames++
    return originalRename(source, destination)
  })
  for (now = lastGoodAliveAt + 15_000; now < quitAt; now += 15_000) store.markAlive()
  const periodicInjectedFaults = injectedFaults
  injectedFaults = 0
  let tickerRunning = true
  ctx.ticker.stop = () => { tickerRunning = false; ctx.calls.push('ticker:stop') }
  store.data.dayNotes['2026-10-06'] = 'Synthetic marker present only in final DB save'
  now = quitAt
  let shutdownError: unknown = null
  try { prepareQuit(ctx) } catch (cause) { shutdownError = cause }
  const heartbeatAfterShutdown = store.readLastAlive()
  const onDiskAfterShutdown = JSON.parse(fs.readFileSync(store.dbPath, 'utf8'))
  const shutdown = {
    canceled: shutdownError !== null,
    error: shutdownError === null ? null : String(shutdownError),
    quitting: ctx.runtime.quitting,
    tickerRunning,
    databaseRenames,
    databaseFinalMarkerSaved: onDiskAfterShutdown.dayNotes['2026-10-06'] === store.data.dayNotes['2026-10-06'],
    heartbeatAfterShutdown,
    injectedFaults,
    periodicInjectedFaults,
  }
  expect(shutdown.canceled).toBe(fault !== 'none' && expectedCancellation)
  expect(shutdown.quitting).toBe(!shutdown.canceled)
  expect(shutdown.tickerRunning).toBe(shutdown.canceled)
  if (fault === 'runtime-write') expect(injectedFaults).toBe(1)
  if (fault === 'runtime-rename') expect(injectedFaults).toBe(4)
  if (!shutdown.canceled) {
    expect(databaseRenames).toBe(1)
    expect(shutdown.databaseFinalMarkerSaved).toBe(true)
  }
  if (shutdown.canceled) {
    const result = {
      fault,
      timestamps: { startedAt, lastGoodAliveAt, quitAt, restartedAt },
      shutdown,
      restartSkippedBecauseQuitCanceled: true,
      fixtureDir,
    }
    results.push(result)
    console.log('SHUTDOWN_HEARTBEAT_PROBE ' + JSON.stringify(result))
    return
  }
  now = restartedAt
  const reloaded = new Store(fixtureDir)
  const restarted = fakeCtx()
  restarted.store = reloaded
  restarted.now = () => now
  restoreOpenSession(restarted)
  const restored = reloaded.data.sessions[0]!
  const restoredPauseAt = restored.pauses.find((pause) => pause.endedAt === null)?.startedAt ?? null
  const activeRecordedMs = restoredPauseAt === null ? null : restoredPauseAt - startedAt
  const result = {
    fault,
    timestamps: { startedAt, lastGoodAliveAt, quitAt, restartedAt },
    shutdown,
    recovery: restarted.runtime.recovery,
    restoredPauseAt,
    activeRecordedMs,
    actualFocusBeforeQuitMs: quitAt - startedAt,
    unrecordedFocusMs: activeRecordedMs === null ? null : quitAt - startedAt - activeRecordedMs,
    fixtureDir,
  }
  results.push(result)
  console.log('SHUTDOWN_HEARTBEAT_PROBE ' + JSON.stringify(result))
  if (!shutdown.canceled) {
    expect(restoredPauseAt).toBe(fault === 'none' ? quitAt : lastGoodAliveAt)
    expect(result.unrecordedFocusMs).toBe(fault === 'none' ? 0 : 300_000)
  }
})

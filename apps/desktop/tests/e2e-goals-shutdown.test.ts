import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(path.resolve('scripts/e2e-goals.mjs'), 'utf8')
const stopSource = source.slice(source.indexOf('async function stop() {'), source.indexOf('\nasync function screenshot('))

function harness(mode: 'startup' | 'request' | 'missing-page' | 'timeout' | 'natural', killFails = false) {
  let alive = true
  let clock = 1000
  let observation: Record<string, unknown> = {}
  const failure = new Error(`${mode} failure`)
  const owned = Object.assign(new EventEmitter(), {
    pid: 1234, exitCode: null as number | null, signalCode: null as string | null,
    kill: vi.fn(() => {
      if (killFails) throw new Error('kill failed')
      alive = false
      owned.signalCode = 'SIGKILL'
      return true
    }),
  })
  const close = vi.fn()
  const requireNaturalExit = vi.fn()
  const context = vm.createContext({
    child: owned,
    page: mode === 'missing-page' ? undefined : {
      close,
      evaluate: vi.fn(async () => { if (mode === 'natural') { alive = false; owned.exitCode = 0 } }),
    },
    nativeExitObserver: async () => {
      if (mode === 'startup') throw failure
      return {
        ready: { pid: owned.pid },
        request: () => { if (mode === 'request') throw failure },
        result: () => mode === 'natural' ? { hasExited: true, exitCode: 0 } : null,
      }
    },
    requireNaturalExit,
    process: { kill: () => { if (!alive) throw Object.assign(new Error('absent'), { code: 'ESRCH' }) } },
    Date: { now: () => { clock += 100; return clock } },
    QUIT_TIMEOUT_MS: 500,
    wait: async () => {},
    assert: {
      ok: (value: unknown, message: string) => { if (!value) throw new Error(message) },
      equal: (actual: unknown, expected: unknown) => { if (actual !== expected) throw new Error('unequal') },
    },
    fs: { writeFileSync: (_file: string, text: string) => { observation = JSON.parse(text) } },
    path, RUN: '.', console: { log: () => {} },
  })
  const stop = vm.runInContext(`${stopSource}\nstop`, context) as () => Promise<void>
  return { stop, owned, close, failure, context, requireNaturalExit, observation: () => observation }
}

describe('goal E2E owned process cleanup', () => {
  it.each(['startup', 'request', 'missing-page', 'timeout'] as const)('cleans up after %s failure and still rejects', async (mode) => {
    const run = harness(mode)
    await expect(run.stop()).rejects.toThrow()
    expect(run.owned.kill).toHaveBeenCalledWith('SIGKILL')
    expect(run.observation()).toMatchObject({ forcedKill: true, killAccepted: true, pidAlive: false })
    expect(run.context.child).toBeUndefined()
    if (mode !== 'missing-page') expect(run.close).toHaveBeenCalledOnce()
  })

  it('preserves the original startup error if cleanup also fails', async () => {
    const run = harness('startup', true)
    await expect(run.stop()).rejects.toBe(run.failure)
    expect(run.observation()).toMatchObject({ forcedKill: true, pidAlive: true, cleanupError: 'kill failed' })
    expect(run.context.child).toBe(run.owned)
  })

  it('keeps a confirmed natural exit free of forced cleanup', async () => {
    const run = harness('natural')
    await run.stop()
    expect(run.requireNaturalExit).toHaveBeenCalledOnce()
    expect(run.owned.kill).not.toHaveBeenCalled()
    expect(run.observation()).toMatchObject({ forcedKill: false, pidAlive: false })
  })
})

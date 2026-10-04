import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outputRoot = path.join(root, '.e2e')
fs.mkdirSync(outputRoot, { recursive: true })
const output = fs.mkdtempSync(path.join(outputRoot, 'input-activity-run-'))
const checks = [], errors = []
const observation = { sampleCount: 0, numericOutput: true, exitCode: null, stopped: false }
const originalSpawn = childProcess.spawn
let helper, exited, stop
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); assert.ok(condition, name) }
const until = async (condition, label) => {
  const deadline = Date.now() + 15000
  while (!condition()) { if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`); await delay(50) }
}
let exitCode = 1
try {
  check('Runs on real Windows', process.platform === 'win32')
  const source = path.join(root, 'apps', 'desktop', 'src', 'infra', 'input-activity.ts')
  const compiled = path.join(root, 'dist-electron', 'infra', 'input-activity.js')
  check('Input watcher was compiled from current source', fs.statSync(compiled).mtimeMs >= fs.statSync(source).mtimeMs)
  childProcess.spawn = function (...args) {
    const child = originalSpawn.apply(this, args)
    if (args[0] === 'powershell.exe') {
      assert.equal(helper, undefined, 'Only one helper is started')
      helper = child
      exited = new Promise(resolve => child.once('exit', code => { observation.exitCode = code; observation.stopped = true; resolve() }))
      let partial = ''
      child.stdout.on('data', data => {
        partial += data.toString('utf8')
        const lines = partial.split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const line of lines) observation.numericOutput &&= /^\d+$/.test(line)
      })
    }
    return child
  }
  syncBuiltinESMExports()
  const { watchInputActivity } = await import(pathToFileURL(compiled).href)
  stop = watchInputActivity(count => { assert.ok(Number.isSafeInteger(count) && count >= 0); observation.sampleCount++ }, error => errors.push(error.message))
  await until(() => observation.sampleCount >= 3 || errors.length, 'three real count samples')
  check('Real GetAsyncKeyState helper emits only nonnegative counts', observation.sampleCount >= 3 && observation.numericOutput && errors.length === 0)
  check('Input helper is a running owned child process', Boolean(helper?.pid) && helper.exitCode === null)
  stop(); stop = undefined
  await Promise.race([exited, delay(3000).then(() => { throw new Error('Input helper did not exit after stop') })])
  await delay(200)
  check('stop terminates the real helper without an error callback', observation.stopped && errors.length === 0)
  exitCode = 0
} catch (error) { console.error(error); errors.push(error.stack ?? String(error)) }
finally {
  stop?.()
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ exitCode, checks, errors, input: observation,
    usedRealUserData: false, injectedKeyboardInput: false, persistedPressCounts: false }, null, 2) + '\n')
  console.log(`Input activity verification: ${path.join(output, 'result.json')}`)
  process.exitCode = exitCode
}

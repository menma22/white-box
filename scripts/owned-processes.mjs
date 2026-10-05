import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

function validate(process) {
  assert.ok(Number.isInteger(process.ProcessId) && process.ProcessId >= 0, 'Process inventory has a valid PID')
  assert.ok(Number.isInteger(process.ParentProcessId) && process.ParentProcessId >= 0, 'Process inventory has a valid parent PID')
  assert.equal(typeof process.Name, 'string', 'Process inventory has a name')
  if (process.CreationDate !== null) {
    assert.match(process.CreationDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,7}Z$/, 'Process creation time is UTC ISO')
    assert.ok(Number.isFinite(Date.parse(process.CreationDate)), 'Process creation time is valid')
  }
}

export function sameProcess(left, right) {
  return left.ProcessId === right.ProcessId && left.CreationDate === right.CreationDate
}

const creationTime = (process) => process.CreationDate.replace(/\.(\d+)Z$/, (_, fraction) => `.${fraction.padEnd(7, '0')}Z`)

export class OwnedProcesses {
  #registered = new Map()
  #reused = new Map()

  #reuse(expected, current) {
    this.#reused.set(`${expected.ProcessId}:${expected.CreationDate}:${current.CreationDate}`, { expected, current })
  }

  registerRoot(process, expected) {
    validate(process)
    assert.ok(process.CreationDate, 'Owned root has an observable creation time')
    if (expected) {
      assert.equal(process.ParentProcessId, expected.parentPid, 'Owned root was spawned by this harness')
      assert.equal(process.Name.toLowerCase(), expected.name.toLowerCase(), 'Owned root is the launched executable')
      assert.ok(Date.parse(process.CreationDate) >= expected.notBefore, 'Owned root was created after this launch began')
    }
    const previous = this.#registered.get(process.ProcessId)
    if (previous && !sameProcess(previous, process)) this.#reuse(previous, process)
    this.#registered.set(process.ProcessId, { ...process })
  }

  observe(inventory) {
    assert.ok(Array.isArray(inventory), 'Process inventory is an array')
    const current = new Map()
    for (const process of inventory) {
      validate(process)
      assert.ok(!current.has(process.ProcessId), 'Process inventory has no duplicate PID')
      current.set(process.ProcessId, process)
    }
    for (const [pid, expected] of this.#registered) {
      const process = current.get(pid)
      if (!process) continue
      assert.ok(process.CreationDate, `Cannot verify creation time of owned PID ${pid}`)
      if (!sameProcess(expected, process)) {
        this.#reuse(expected, process)
        this.#registered.delete(pid)
      }
    }
    let added
    do {
      added = false
      for (const process of inventory) {
        if (this.owns(process)) continue
        const parent = current.get(process.ParentProcessId)
        if (!parent || !this.owns(parent) || process.ProcessId === parent.ProcessId) continue
        assert.ok(process.CreationDate, `Cannot verify creation time of descendant PID ${process.ProcessId}`)
        if (creationTime(process) < creationTime(parent)) continue
        this.#registered.set(process.ProcessId, { ...process })
        added = true
      }
    } while (added)
    return {
      remaining: inventory.filter((process) => this.owns(process)),
      reused: [...this.#reused.values()],
      registered: [...this.#registered.values()],
    }
  }

  owns(process) {
    const expected = this.#registered.get(process.ProcessId)
    return Boolean(expected && sameProcess(expected, process))
  }
}

export function readWindowsProcesses() {
  const command = '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{Name="CreationDate";Expression={if ($null -ne $_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString("o") } else { $null }}} | ConvertTo-Json -Compress'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr || 'Cannot inspect owned processes')
  let inventory
  try { inventory = JSON.parse(result.stdout) } catch { throw new Error('Owned-process inventory did not return valid UTF-8 JSON') }
  return inventory === null ? [] : Array.isArray(inventory) ? inventory : [inventory]
}

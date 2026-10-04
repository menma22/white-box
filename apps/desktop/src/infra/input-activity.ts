import { spawn } from 'node:child_process'

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WhiteBoxActivity {
  [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
  private static bool[] down = new bool[91];
  public static int CountPresses() {
    int count = 0;
    for (int key = 48; key <= 90; key++) {
      bool pressed = (GetAsyncKeyState(key) & 0x8000) != 0;
      if (pressed && !down[key]) count++;
      down[key] = pressed;
    }
    return count;
  }
}
'@
$count = 0
$last = [DateTime]::UtcNow
while ($true) {
  $count += [WhiteBoxActivity]::CountPresses()
  if (([DateTime]::UtcNow - $last).TotalSeconds -ge 1) {
    [Console]::Out.WriteLine($count)
    $count = 0
    $last = [DateTime]::UtcNow
  }
  Start-Sleep -Milliseconds 25
}`

export function watchInputActivity(onCount: (count: number) => void, onError: (error: Error) => void) {
  if (process.platform !== 'win32') { onError(new Error('入力活動の検知はWindowsで利用できます')); return () => {} }
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let partial = ''
  let stopped = false
  let diagnostic = ''
  const fail = (error: Error) => { if (!stopped) { stopped = true; child.kill(); onError(error) } }
  child.stderr.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString('utf8')).slice(-2000) })
  child.stdout.on('data', (data: Buffer) => {
    if (stopped) return
    partial += data.toString('utf8')
    const lines = partial.split(/\r?\n/)
    partial = lines.pop() ?? ''
    for (const line of lines) {
      const count = Number(line)
      if (Number.isInteger(count) && count >= 0) onCount(count)
    }
  })
  child.on('error', fail)
  child.on('exit', (code) => fail(new Error(`入力活動の検知を停止しました (${code ?? 'signal'}) ${diagnostic.trim()}`)))
  return () => { stopped = true; child.kill() }
}

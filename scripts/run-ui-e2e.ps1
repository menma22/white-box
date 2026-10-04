param(
  [Parameter(Mandatory = $true)][string]$Worktree,
  [Parameter(Mandatory = $true)][string]$Scripts,
  [string]$Executable
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$resolvedWorktree = (Resolve-Path -LiteralPath $Worktree).Path
$scriptPaths = @($Scripts.Split(',') | ForEach-Object {
  if ($_ -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(mjs|cjs)$') { throw "Invalid E2E script name: $_" }
  (Resolve-Path -LiteralPath (Join-Path $resolvedWorktree "scripts/$_")).Path
})
$resolvedExecutable = if ($Executable) { (Resolve-Path -LiteralPath $Executable).Path } else { $null }
$previousExecutable = $env:WHITEBOX_EXE
$previousDirectory = Get-Location
$mutex = [System.Threading.Mutex]::new($false, 'Local\WhiteBoxElectronUiE2E')
$acquired = $false
$result = 0

function Get-WhiteBoxQaProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'White Box.exe'" | Where-Object {
    if (-not $_.CommandLine) { return $false }
    $profileMatch = [regex]::Match($_.CommandLine, '--user-data-dir=(?:"([^"]+)"|(\S+))', 'IgnoreCase')
    if (-not $profileMatch.Success) { return $false }
    $profilePath = if ($profileMatch.Groups[1].Success) { $profileMatch.Groups[1].Value } else { $profileMatch.Groups[2].Value }
    $qaPath = [regex]::Match($profilePath, '^(.*?)[\\/](?:\.e2e(?:[\\/.-])|shots-presence-(?:app|model)[\\/])', 'IgnoreCase')
    if (-not $qaPath.Success) { return $false }
    $packagePath = Join-Path $qaPath.Groups[1].Value 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath)) { return $false }
    (Get-Content -Raw -Encoding UTF8 -LiteralPath $packagePath | ConvertFrom-Json).name -eq 'white-box'
  }
}

try {
  Write-Output 'Waiting for the White Box UI E2E lock...'
  while (-not $acquired) {
    try { $acquired = $mutex.WaitOne(1000) }
    catch [System.Threading.AbandonedMutexException] { $acquired = $true }
  }
  Write-Output "UI E2E lock acquired: $resolvedWorktree"
  $previousQa = @(Get-WhiteBoxQaProcesses)
  if ($previousQa.Count -ne 0) { throw "Previous QA Electron processes remain: $($previousQa.ProcessId -join ', ')" }
  Set-Location -LiteralPath $resolvedWorktree
  $env:WHITEBOX_EXE = $resolvedExecutable
  foreach ($scriptPath in $scriptPaths) {
    $previousErrorAction = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & node $scriptPath
      $scriptResult = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
      $owned = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'White Box.exe'" | Where-Object {
        $_.CommandLine -and
        $_.CommandLine.IndexOf($resolvedWorktree, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $_.CommandLine -match '(?i)[\\/]\.e2e(?:[\\/.-])|[\\/]shots-presence-(?:app|model)[\\/]'
      })
      if ($owned.Count -eq 0) { break }
      if ([DateTime]::UtcNow -ge $deadline) { throw "QA Electron processes remain: $($owned.ProcessId -join ', ')" }
      Start-Sleep -Milliseconds 200
    } while ($true)
    if ($scriptResult -ne 0) { $result = $scriptResult; break }
  }
} finally {
  $env:WHITEBOX_EXE = $previousExecutable
  Set-Location -LiteralPath $previousDirectory.Path
  if ($acquired) { $mutex.ReleaseMutex(); Write-Output 'UI E2E lock released.' }
  $mutex.Dispose()
}
exit $result

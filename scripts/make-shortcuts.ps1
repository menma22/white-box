# ASCII-only on purpose (PS 5.1 mojibake guard). Japanese lives in README.
# Creates Desktop and Start Menu shortcuts for a built White Box.exe.
# The Start Menu entry is what lets you right-click -> Pin to taskbar.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Name = "White Box"
)

if (-not (Test-Path $Exe)) {
  Write-Output "NOT_FOUND: $Exe"
  exit 1
}
$Exe = (Resolve-Path $Exe).Path

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

foreach ($dir in $targets) {
  if (-not (Test-Path $dir)) { continue }
  $link = Join-Path $dir ($Name + '.lnk')
  $sc = $shell.CreateShortcut($link)
  $sc.TargetPath = $Exe
  $sc.WorkingDirectory = (Split-Path $Exe -Parent)
  $sc.IconLocation = "$Exe,0"
  $sc.Description = 'White Box - record what you actually did'
  $sc.Save()
  Write-Output "created: $link"
}

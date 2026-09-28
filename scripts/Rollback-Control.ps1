[CmdletBinding()]
param([Parameter(Mandatory)][string]$Record,[switch]$KeepSettings)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Rollback requires Windows' }
$state=Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
if ($state.rolledBack) {Write-Host 'Already rolled back';return}
if ($state.schema -ne 1) { throw 'Unsupported rollback record' }
$installRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'VTubeControl'))
$versionPath=[IO.Path]::GetFullPath($state.versionPath)
if (-not $versionPath.StartsWith((Join-Path $installRoot 'versions')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Rollback path is outside companion versions' }
if ([IO.Path]::GetFullPath($state.settingsPath) -ne [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'VTubeControl'))) {throw 'Unexpected settings path'}
$backupRoot=[IO.Path]::GetFullPath((Split-Path $Record))
if (-not $backupRoot.StartsWith((Join-Path $installRoot 'rollback')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unexpected rollback record path'}
$shell=New-Object -ComObject WScript.Shell
if (Get-Process -Name VTubeControl -ErrorAction SilentlyContinue) { throw 'Exit VTube Control from its tray first. Do not close VTube Studio, OBS or the tracking bridge.' }
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
# Validate ownership before changing anything; refuse to overwrite subsequent manual edits.
foreach ($entry in $state.shortcuts) {
 if ($entry.path -notin @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'VTube Control.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'VTube Control.lnk'))) {throw 'Unexpected shortcut path'}
 if ($entry.before -and -not [IO.Path]::GetFullPath($entry.before).StartsWith($backupRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unexpected backup path'}
 if ($entry.started -and -not $entry.installedHash -and (Test-Path -LiteralPath $entry.path) -and $shell.CreateShortcut($entry.path).TargetPath -ne $entry.installedTarget) {throw 'Shortcut ownership uncertain'}
 if ($entry.installedHash -and (Test-Path -LiteralPath $entry.path) -and (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -ne $entry.installedHash) { throw "Shortcut changed after install: $($entry.path). Preserve it before rollback." }
}
if ($state.startupChanged) {
 $current=(Get-ItemProperty -Path $runKey -Name VTubeControl -ErrorAction SilentlyContinue).VTubeControl
 if ($current -and $current -ne $state.startupExpected) { throw 'Startup entry changed after install; preserve it before rollback' }
}
if ($state.firewallName) {
 $rule=Get-NetFirewallRule -Name $state.firewallName -ErrorAction SilentlyContinue
 if ($rule) { Remove-NetFirewallRule -Name $state.firewallName }
}
foreach ($entry in $state.shortcuts) {
 if ($entry.started -and (Test-Path -LiteralPath $entry.path)) {Remove-Item -LiteralPath $entry.path}
 if ($entry.before) {Copy-Item -LiteralPath $entry.before -Destination $entry.path -Force}
}
if ($state.startupChanged) {
 if ($state.startupBefore) {New-ItemProperty -Path $runKey -Name VTubeControl -Value $state.startupBefore.value -PropertyType $state.startupBefore.kind -Force | Out-Null}
 else {Remove-ItemProperty -Path $runKey -Name VTubeControl -ErrorAction SilentlyContinue}
}
if (-not $KeepSettings) {
 foreach ($entry in $state.settings) {
  $path=Join-Path $state.settingsPath $entry.name
  if ($entry.before) {Copy-Item -LiteralPath $entry.before -Destination $path -Force}
  elseif (Test-Path -LiteralPath $path) {Remove-Item -LiteralPath $path}
 }
}
if (Test-Path -LiteralPath $versionPath) {Remove-Item -LiteralPath $versionPath -Recurse}
foreach ($pair in @(@($installRoot,$state.rootAclBefore),@($state.settingsPath,$state.settingsAclBefore))) {if ($pair[1]) {$acl=Get-Acl -LiteralPath $pair[0];$acl.SetSecurityDescriptorSddlForm($pair[1]);Set-Acl -LiteralPath $pair[0] -AclObject $acl}}
$state.rolledBack=$true;$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Record -Encoding UTF8
Write-Host 'Companion rollback complete. Older companion versions and all input-tracking files/tasks were preserved.'

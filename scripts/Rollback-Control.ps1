[CmdletBinding()]
param([Parameter(Mandatory)][string]$Record,[switch]$KeepSettings)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Control-RollbackCore.ps1')
if ($env:OS -ne 'Windows_NT') {throw 'Rollback requires Windows'}
$state=Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
if ($state.rolledBack) {Write-Host 'Already rolled back';return}
$installRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'VTubeControl'))
$settingsRoot=Join-Path $env:APPDATA 'VTubeControl'
$backupRoot=[IO.Path]::GetFullPath((Split-Path $Record))
if (-not $backupRoot.StartsWith((Join-Path $installRoot 'rollback')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Unexpected rollback record path'}
# 0.3 and later own the VTube Input Bridge shortcuts; 0.2 records name VTube Control.
$allowed=foreach ($name in @('VTube Input Bridge.lnk','VTube Control.lnk')) { foreach ($folder in @('Desktop','Programs')) { Join-Path ([Environment]::GetFolderPath($folder)) $name } }
Assert-RollbackBounds $state $installRoot $settingsRoot $backupRoot $allowed
$versionPath=[IO.Path]::GetFullPath($state.versionPath)
if ((Test-Path -LiteralPath $versionPath) -and ((Get-Item -LiteralPath $versionPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Version directory cannot be a junction or symbolic link'}
if (Get-Process -Name VTubeControl -ErrorAction SilentlyContinue) {throw 'Exit VTube Input Bridge from its tray first. Do not close VTube Studio or OBS.'}
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
foreach ($entry in $state.shortcuts) {
 if ((Get-RollbackFileState $entry) -eq 'foreign') {throw "Shortcut changed after install: $($entry.path). Preserve it before rollback."}
}
if ($state.startupChanged) {
 $current=(Get-ItemProperty -Path $runKey -Name VTubeControl -ErrorAction SilentlyContinue).VTubeControl
 if ($current -and $current -ne $state.startupExpected -and $current -ne $state.startupBefore.value) {throw 'Startup entry changed after install; preserve it before rollback'}
}
# All mutations are idempotent. Recognize original backups to resume after interruptions.
if ($state.firewallName) {if (Get-NetFirewallRule -Name $state.firewallName -ErrorAction SilentlyContinue) {Remove-NetFirewallRule -Name $state.firewallName}}
foreach ($entry in $state.shortcuts) {
 $kind=Get-RollbackFileState $entry
 if ($kind -eq 'installed') {Remove-Item -LiteralPath $entry.path}
 if ($entry.before -and $kind -ne 'untouched') {Copy-Item -LiteralPath $entry.before -Destination $entry.path -Force}
}
if ($state.startupChanged) {
 if ($state.startupBefore) {New-ItemProperty -Path $runKey -Name VTubeControl -Value $state.startupBefore.value -PropertyType $state.startupBefore.kind -Force | Out-Null}
 else {Remove-ItemProperty -Path $runKey -Name VTubeControl -ErrorAction SilentlyContinue}
}
if (-not $KeepSettings) {
 foreach ($entry in $state.settings) {
  $path=Join-Path $settingsRoot $entry.name
  if ($entry.before) {Copy-Item -LiteralPath $entry.before -Destination $path -Force}
  elseif (Test-Path -LiteralPath $path) {Remove-Item -LiteralPath $path}
 }
}
if (Test-Path -LiteralPath $versionPath) {Remove-Item -LiteralPath $versionPath -Recurse}
foreach ($pair in @(@($installRoot,$state.rootAclBefore),@($settingsRoot,$state.settingsAclBefore))) {
 if ($pair[1]) {$acl=Get-Acl -LiteralPath $pair[0];$acl.SetSecurityDescriptorSddlForm($pair[1]);Set-Acl -LiteralPath $pair[0] -AclObject $acl}
}
$state.rolledBack=$true
$temp=$Record+'.new';$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8;Move-Item -LiteralPath $temp -Destination $Record -Force
Write-Host 'Companion rollback complete. Older companion versions and all input-tracking files/tasks were preserved.'

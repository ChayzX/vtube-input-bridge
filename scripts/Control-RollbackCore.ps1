function Test-BackupPath([string]$Path,[string]$Root) {
 if (-not $Path) {return $true}
 return [IO.Path]::GetFullPath($Path).StartsWith([IO.Path]::GetFullPath($Root)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-RollbackBounds($State,[string]$InstallRoot,[string]$SettingsRoot,[string]$BackupRoot,$AllowedShortcuts) {
 if ($State.schema -ne 1) {throw 'Unsupported rollback record'}
 $version=[IO.Path]::GetFullPath($State.versionPath)
 if ((Split-Path $version -Parent) -ne (Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'versions') -or (Split-Path $version -Leaf) -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') {throw 'Unexpected version path'}
 if ([IO.Path]::GetFullPath($State.settingsPath) -ne [IO.Path]::GetFullPath($SettingsRoot)) {throw 'Unexpected settings path'}
 if ($State.firewallName -and $State.firewallName -notmatch '^VTubeControl-\d{8}-\d{6}-[a-f0-9]{32}$') {throw 'Unexpected firewall name'}
 foreach ($entry in $State.shortcuts) {
  if ($entry.path -notin $AllowedShortcuts -or -not (Test-BackupPath $entry.before $BackupRoot)) {throw 'Unexpected shortcut or backup path'}
  if ($entry.installedTarget -and [IO.Path]::GetFullPath($entry.installedTarget) -ne (Join-Path $version 'VTubeControl.exe')) {throw 'Unexpected shortcut target'}
 }
 foreach ($entry in $State.settings) {
  if ($entry.name -notin @('settings.enc','identity.enc','plugin-connection.json') -or -not (Test-BackupPath $entry.before $BackupRoot)) {throw 'Unexpected settings name or backup path'}
 }
}
function Get-RollbackFileState($Entry) {
 if (-not (Test-Path -LiteralPath $Entry.path)) {return 'absent'}
 $hash=(Get-FileHash -LiteralPath $Entry.path -Algorithm SHA256).Hash
 if ($Entry.before -and (Test-Path -LiteralPath $Entry.before) -and $hash -eq (Get-FileHash -LiteralPath $Entry.before -Algorithm SHA256).Hash) {return 'original'}
 if ($Entry.installedHash -and $hash -eq $Entry.installedHash) {return 'installed'}
 if (-not $Entry.started) {return 'untouched'}
 # A shortcut created just before an interrupted installer may lack its post-write hash.
 if (-not $Entry.installedHash -and $Entry.installedTarget -and $env:OS -eq 'Windows_NT') {
  $shell=New-Object -ComObject WScript.Shell
  if ($shell.CreateShortcut($Entry.path).TargetPath -eq $Entry.installedTarget) {return 'installed'}
 }
 return 'foreign'
}

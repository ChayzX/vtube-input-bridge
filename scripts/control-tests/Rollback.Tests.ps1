$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../Control-RollbackCore.ps1')
$root=Join-Path ([IO.Path]::GetTempPath()) ('vtube-rollback-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root 'rollback/id') -Force | Out-Null
try {
 $backup=Join-Path $root 'rollback/id';$settings=Join-Path $root 'settings';$shortcut=Join-Path $root 'desktop.lnk';$original=Join-Path $backup 'original.lnk'
 Set-Content $original 'original shortcut';Set-Content $shortcut 'installed shortcut'
 $entry=@{path=$shortcut;before=$original;installedHash=(Get-FileHash $shortcut).Hash;started=$true}
 if ((Get-RollbackFileState $entry) -ne 'installed') {throw 'Installed shortcut not recognized'}
 Copy-Item $original $shortcut -Force
 if ((Get-RollbackFileState $entry) -ne 'original') {throw 'Interrupted rollback cannot resume'}
 Set-Content $shortcut 'manual edit'
 if ((Get-RollbackFileState $entry) -ne 'foreign') {throw 'Manual edit would be overwritten'}
 $state=@{schema=1;versionPath=(Join-Path $root 'versions/0.2.0-preview.1');settingsPath=$settings;shortcuts=@($entry);settings=@(@{name='settings.enc';before=$null});firewallName='VTubeControl-20260928-120000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}
 Assert-RollbackBounds $state $root $settings $backup @($shortcut)
 foreach($mutate in @({param($s)$s.settings[0].name='../tracking/token.txt'},{param($s)$s.settings[0].before=Join-Path $root 'outside'},{param($s)$s.firewallName='VTubeInputRelay'},{param($s)$s.versionPath=Join-Path $root 'versions/anything/child'})) {
  $copy=$state | ConvertTo-Json -Depth 8 | ConvertFrom-Json -AsHashtable;& $mutate $copy;$rejected=$false
  try {Assert-RollbackBounds $copy $root $settings $backup @($shortcut)} catch {$rejected=$true}
  if(-not $rejected){throw 'Unsafe rollback record accepted'}
 }
 Write-Host 'Rollback ownership, interrupted resume and confinement: PASS'
} finally {Remove-Item -LiteralPath $root -Recurse -Force}

[CmdletBinding()]
param(
 [ValidateSet('pantry','canada')][string]$Role,
 [string]$PackagePath = $PSScriptRoot,
 [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'VTubeControl'),
 [switch]$EnableStartup,
 [switch]$EnableFirewall,
 [string]$PeerAddress,
 [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PackagePath 'bundle.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') { throw 'Invalid bundle version' }
if (-not $Role) { $Role = $manifest.role }
if ($Role -notin @('pantry','canada') -or $Role -ne $manifest.role) { throw 'Use the package for this PC role' }
$payload = [IO.Path]::GetFullPath((Join-Path $PackagePath 'app'))
foreach ($file in $manifest.files) {
 if ($file.path -match '(^[\\/]|(^|[\\/])\.\.([\\/]|$)|:)') { throw 'Unsafe bundle path' }
 $path = [IO.Path]::GetFullPath((Join-Path $payload $file.path))
 if (-not $path.StartsWith($payload + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe bundle path' }
 if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "Bundle checksum mismatch: $($file.path)" }
}
$versionPath = Join-Path $InstallRoot "versions\$($manifest.version)"
if ($PlanOnly) { [pscustomobject]@{Role=$Role;Version=$manifest.version;Destination=$versionPath;Startup=[bool]$EnableStartup;Firewall=[bool]$EnableFirewall;TrackingChanges=$false}; return }
if ([IO.Path]::GetFullPath($InstallRoot) -ne [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'VTubeControl'))) { throw 'InstallRoot overrides are supported only with PlanOnly' }
if ($env:OS -ne 'Windows_NT') { throw 'Installation requires Windows; PlanOnly supports offline checks' }
if (Test-Path -LiteralPath $versionPath) { throw 'This version already exists. Use its rollback record before reinstalling.' }
if (Get-Process -Name VTubeControl -ErrorAction SilentlyContinue) { throw 'Exit VTube Control from its tray before installing. Leave the tracking bridge running.' }
if ($EnableFirewall) {
 if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Firewall installation requires an elevated PowerShell' }
 $ip=$null; if (-not [Net.IPAddress]::TryParse($PeerAddress,[ref]$ip) -or $PeerAddress -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)') { throw 'A private peer IPv4 address is required' }
}
$rootAclBefore=if(Test-Path -LiteralPath $InstallRoot){(Get-Acl -LiteralPath $InstallRoot).Sddl}else{$null}
$settingsAclBefore=if(Test-Path -LiteralPath (Join-Path $env:APPDATA 'VTubeControl')){(Get-Acl -LiteralPath (Join-Path $env:APPDATA 'VTubeControl')).Sddl}else{$null}
$id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
$backup = Join-Path $InstallRoot "rollback\$id"
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'VTube Control.lnk'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'VTube Control.lnk'
$settings = Join-Path $env:APPDATA 'VTubeControl'
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$state=[ordered]@{schema=1;versionPath=$versionPath;role=$Role;shortcuts=@();startupChanged=$false;startupBefore=$null;startupExpected=$null;firewallName=$null;settingsPath=$settings;settings=@();complete=$false;rolledBack=$false;rootAclBefore=$rootAclBefore;settingsAclBefore=$settingsAclBefore}
function Save-State { $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backup 'rollback.json') -Encoding UTF8 }
foreach ($path in @($desktop,$startMenu)) {
 $entry=[ordered]@{path=$path;before=$null;installedHash=$null;started=$false;installedTarget=$null}
 if (Test-Path -LiteralPath $path) { $entry.before=Join-Path $backup ([guid]::NewGuid().ToString('N')+'.lnk'); Copy-Item -LiteralPath $path -Destination $entry.before }
 $state.shortcuts += $entry
}
foreach ($name in @('settings.enc','identity.enc','plugin-connection.json')) {
 $entry=[ordered]@{name=$name;before=$null};$path=Join-Path $settings $name
 if (Test-Path -LiteralPath $path) {$entry.before=Join-Path $backup ($name+'.backup');Copy-Item -LiteralPath $path -Destination $entry.before}
 $state.settings += $entry
}
if ($EnableStartup) {
 if (Test-Path $runKey) { $key=Get-Item $runKey; if ($key.GetValueNames() -contains 'VTubeControl') {$state.startupBefore=@{value=$key.GetValue('VTubeControl',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$key.GetValueKind('VTubeControl').ToString()}} }
}
Save-State
try {
 New-Item -ItemType Directory -Path (Split-Path $versionPath) -Force | Out-Null
 Copy-Item -LiteralPath $payload -Destination $versionPath -Recurse
 # The companion stores tokens/settings in the user's profile, outside this immutable version directory.
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & icacls $InstallRoot /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
 if ($LASTEXITCODE -ne 0) { throw 'Could not restrict companion directory permissions' }
 New-Item -ItemType Directory -Path $settings -Force | Out-Null
 & icacls $settings /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
 if ($LASTEXITCODE -ne 0) { throw 'Could not restrict credential directory permissions' }
 $exe=Join-Path $versionPath 'VTubeControl.exe'
 $shell=New-Object -ComObject WScript.Shell
 foreach ($entry in $state.shortcuts) {
  $entry.started=$true;$entry.installedTarget=$exe;Save-State
  $shortcut=$shell.CreateShortcut($entry.path);$shortcut.TargetPath=$exe;$shortcut.Arguments="--$Role";$shortcut.WorkingDirectory=$versionPath;$shortcut.IconLocation="$exe,0";$shortcut.Save()
  $entry.installedHash=(Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash;Save-State
 }
 if ($EnableStartup) {
  $state.startupExpected='"'+$exe+'" --'+$Role;$state.startupChanged=$true;Save-State
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name VTubeControl -Value $state.startupExpected -PropertyType String -Force | Out-Null
 }
 if ($EnableFirewall) {
  $state.firewallName="VTubeControl-$id";Save-State
  New-NetFirewallRule -Name $state.firewallName -DisplayName "VTube Control $Role $($manifest.version)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5056 -RemoteAddress $PeerAddress -Program $exe -Profile Private | Out-Null
 }
 $state.complete=$true;Save-State
 Write-Host "Installed without launching. Rollback record: $(Join-Path $backup 'rollback.json')"
} catch {
 Save-State
 Write-Warning "Partial installation recorded. Run Rollback-Control.ps1 -Record '$(Join-Path $backup 'rollback.json')' to undo it."
 throw
}

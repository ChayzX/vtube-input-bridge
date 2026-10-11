$ErrorActionPreference='Stop'
$scripts=Join-Path $PSScriptRoot '..'
# Load named functions from a script without running it (the one-click body and the uninstaller run on load).
function Get-FunctionText([string]$Path,[string[]]$Names) {
 $tokens=$null;$errors=$null
 $ast=[System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Path).ProviderPath,[ref]$tokens,[ref]$errors)
 if ($errors) {throw "$Path does not parse: $($errors[0].Message)"}
 $found=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Names -contains $n.Name},$true))
 if ($found.Count -ne $Names.Count) {throw "Expected functions $($Names -join ', ') in $Path"}
 ($found | ForEach-Object {$_.Extent.Text}) -join "`n"
}
function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) {throw $Message} }
$root=Join-Path ([IO.Path]::GetTempPath()) ('vtube-installer-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root 'app') -Force | Out-Null
try {
 # Install-Control.ps1: dry run, tamper and traversal rejection (older per-role package).
 $file=Join-Path $root 'app/VTubeControl.exe';Set-Content -LiteralPath $file -Value 'fixture-binary'
 $manifest=@{version='0.2.0-preview.1';role='pantry';files=@(@{path='VTubeControl.exe';sha256=(Get-FileHash $file).Hash})}
 $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'bundle.json')
 $installer=Join-Path $scripts 'Install-Control.ps1'
 $plan=& $installer -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly
 Assert ($plan.Role -eq 'pantry' -and -not $plan.TrackingChanges -and -not (Test-Path (Join-Path $root 'target'))) 'Dry run changed files or tracking'
 $rejected=$false;try{& $installer -Role canada -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly | Out-Null}catch{$rejected=$_.Exception.Message -like '*package for this PC role*'}
 Assert $rejected 'A per-role package installed for the other role'

 # One role-neutral package: the role must be given, and selects the PC.
 $manifest=@{version='1.0.0-rc.1';roles=@('pantry','canada');files=@(@{path='VTubeControl.exe';sha256=(Get-FileHash $file).Hash})}
 $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'bundle.json')
 $rejected=$false;try{& $installer -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly | Out-Null}catch{$rejected=$_.Exception.Message -like '*-Role pantry*'}
 Assert $rejected 'Role-neutral package installed without a role'
 foreach ($role in @('pantry','canada')) {
  $plan=& $installer -Role $role -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly
  Assert ($plan.Role -eq $role -and $plan.Version -eq '1.0.0-rc.1') "Role-neutral plan for $role"
  Assert ($plan.Uninstaller -like '*Uninstall-VTubeInputBridge.cmd' -and $plan.UninstallKey -like '*\CurrentVersion\Uninstall\VTubeInputBridge') 'Uninstaller not planned'
 }
 Set-Content -LiteralPath $file -Value 'tampered-binary'
 $rejected=$false;try{& $installer -Role pantry -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly | Out-Null}catch{$rejected=$_.Exception.Message -like '*checksum mismatch*'}
 Assert $rejected 'Tampered payload accepted'
 $manifest.files[0].path='../outside.exe';$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'bundle.json')
 $rejected=$false;try{& $installer -Role pantry -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly | Out-Null}catch{$rejected=$_.Exception.Message -like '*Unsafe bundle path*'}
 Assert $rejected 'Traversal path accepted'
 Write-Host 'Installer dry-run, role selection, tamper rejection, traversal rejection: PASS'

 # Firewall: program-scoped, private networks, local subnet, never a fixed peer address.
 $versionDir=Join-Path $root 'VTubeControl/versions/1.0.0-rc.1'
 foreach ($role in @('pantry','canada')) {
  $rules=@(& (Join-Path $scripts 'Set-BridgeFirewall.ps1') -VersionPath $versionDir -Role $role -PlanOnly)
  Assert ($rules.Count -eq 4) "Expected 4 firewall rules for $role"
  foreach ($rule in $rules) {
   Assert ($rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow' -and $rule.Profile -eq 'Private' -and $rule.RemoteAddress -eq 'LocalSubnet' -and $rule.Group -eq 'VTube Input Bridge') "Rule $($rule.Name) is not private/local-subnet"
   Assert ($rule.Program.StartsWith($versionDir) -and $rule.Name -like 'VTubeInputBridge-*' -and $rule.DisplayName -like 'VTube Input Bridge (*)') "Rule $($rule.Name) is not scoped to this version"
  }
  $app=Join-Path $versionDir 'VTubeControl.exe'
  foreach ($want in @('TCP/5056','TCP/5059','UDP/5059')) {
   Assert (@($rules | Where-Object { "$($_.Protocol)/$($_.LocalPort)" -eq $want -and $_.Program -eq $app }).Count -eq 1) "Missing app rule $want for $role"
  }
  $tracking=@($rules | Where-Object { $_.Program -ne $app })
  if ($role -eq 'canada') { Assert ($tracking[0].Protocol -eq 'UDP' -and $tracking[0].LocalPort -eq '5055' -and $tracking[0].Program -like '*vts_input_relay.exe') 'Missing relay UDP 5055 rule' }
  else { Assert ($tracking[0].Protocol -eq 'UDP' -and $tracking[0].Program -like '*VTubeInputBridge.exe') 'Missing tracking sender rule' }
 }
 Write-Host 'Firewall rules (program, Private, LocalSubnet, 5056/5059/5055): PASS'

 # One-click body: plain ASCII without a percent sign, no role baked in, and its role and update-result helpers.
 $oneClick=Join-Path $scripts 'Control-OneClick.ps1'
 $body=Get-Content -LiteralPath $oneClick -Raw
 Assert (-not $body.Contains('%') -and $body -notmatch '[^\x00-\x7F]') 'Control-OneClick.ps1 must be ASCII without %'
 Assert (-not $body.Contains('__VTC_ROLE__')) 'The one installer must not have a fixed role'
 . ([ScriptBlock]::Create((Get-FunctionText $oneClick @('Say','Read-SavedRole','Resolve-InstallRole','Write-UpdateResult'))))
 $yes={$true};$no={$false}
 $r=Resolve-InstallRole ' Canada ' 'pantry' $yes {'pantry'}; Assert ($r.Role -eq 'canada' -and $r.From -eq 'VTC_ROLE') 'VTC_ROLE must win'
 $rejected=$false;try{Resolve-InstallRole 'gaming' '' $null $null | Out-Null}catch{$rejected=$_.Exception.Message -like '*VTC_ROLE must be*'}; Assert $rejected 'Invalid VTC_ROLE accepted'
 $r=Resolve-InstallRole '' 'pantry' $yes {'canada'}; Assert ($r.Role -eq 'pantry') 'role.txt must win over detection and the question'
 $r=Resolve-InstallRole '' '' $yes {'pantry'}; Assert ($r.Role -eq 'canada') 'The old relay task means the Streaming PC'
 $r=Resolve-InstallRole '' '' $no {'pantry'}; Assert ($r.Role -eq 'pantry' -and $r.From -eq 'your answer') 'The question must decide last'
 $r=Resolve-InstallRole '' '' $no {'cancel'}; Assert ($r.Role -eq 'cancel') 'Cancel must be reported'
 $r=Resolve-InstallRole '' '' $null $null; Assert ($r.Role -eq '') 'Unattended runs must not guess a role'
 $roleFile=Join-Path $root 'role.txt'
 Assert ((Read-SavedRole $roleFile) -eq '') 'Missing role.txt'
 Set-Content -LiteralPath $roleFile -Value 'canada'; Assert ((Read-SavedRole $roleFile) -eq 'canada') 'role.txt not read'
 Set-Content -LiteralPath $roleFile -Value 'other'; Assert ((Read-SavedRole $roleFile) -eq '') 'Unknown role.txt accepted'
 $result=Join-Path $root 'local/VTubeControl/last-update.json'
 Write-UpdateResult $result '1.0.0-rc.1' $false 'Update to 1.0.0-rc.1 failed: "quoted" reason'
 $bytes=[IO.File]::ReadAllBytes($result)
 Assert (-not ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB)) 'last-update.json must have no byte-order mark'
 $lines=@(Get-Content -LiteralPath $result); Assert ($lines.Count -eq 1) 'last-update.json must be one line'
 $json=$lines[0] | ConvertFrom-Json
 Assert ($json.version -eq '1.0.0-rc.1' -and $json.ok -eq $false -and $json.message -like '*"quoted" reason' -and [string]$json.at -match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$') 'last-update.json fields'
 $fields=(@($json.PSObject.Properties.Name) -join ',')
 Assert ($fields -eq 'version,ok,message,at') 'last-update.json field order'
 Write-Host 'One-click role order (VTC_ROLE, role.txt, relay task, question) and last-update.json: PASS'

 # The installer file: header, then the package ZIP and the Stream Deck plugin as raw bytes.
 $pkg=Join-Path $root 'pkg'; New-Item -ItemType Directory -Path (Join-Path $pkg 'app') -Force | Out-Null
 Set-Content -LiteralPath (Join-Path $pkg 'app/VTubeControl.exe') -Value 'fixture'
 foreach ($name in @('Install-Control.ps1','Set-BridgeFirewall.ps1','Uninstall-VTubeInputBridge.ps1','Migrate-StreamPCRelay.ps1','Restore-StreamPCRelay.ps1')) { Copy-Item -LiteralPath (Join-Path $scripts $name) -Destination $pkg }
 @{version='1.0.0-rc.1';roles=@('pantry','canada');files=@()} | ConvertTo-Json | Set-Content (Join-Path $pkg 'bundle.json')
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $zipPath=Join-Path $root 'VTubeControl-1.0.0-rc.1.zip'; [IO.Compression.ZipFile]::CreateFromDirectory($pkg,$zipPath)
 $pluginPath=Join-Path $root 'com.chayzx.vtubecontrol.streamDeckPlugin'; [IO.File]::WriteAllBytes($pluginPath,[byte[]](1..200 | ForEach-Object {[byte]($_ -band 0xFF)}))
 $out=Join-Path $root 'Install-VTubeInputBridge.cmd'
 & (Join-Path $scripts 'New-ControlInstaller.ps1') -ZipPath $zipPath -PluginPath $pluginPath -OutFile $out | Out-Null
 $all=[IO.File]::ReadAllBytes($out); $zipBytes=[IO.File]::ReadAllBytes($zipPath); $pluginBytes=[IO.File]::ReadAllBytes($pluginPath)
 $headerLength=$all.Length-$zipBytes.Length-$pluginBytes.Length
 $header=[Text.Encoding]::ASCII.GetString($all,0,$headerLength)
 Assert ($header.StartsWith('@echo off') -and $header.TrimEnd().EndsWith('#VTC-PAYLOAD#') -and $header.Length -lt 65536) 'Installer header layout'
 Assert ($header.Contains('if "%VTC_UPDATE%"=="1" exit /b %VTC_RESULT%') -and $header.Contains('if "%VTC_QUIET%"=="1" exit /b %VTC_RESULT%')) 'Unattended runs must not wait for a key press'
 $script=$header.Substring($header.IndexOf('#VTC-SCRIPT#')+12)
 Assert (-not $script.Contains('%') -and -not $script.Contains('__VTC_')) 'Embedded script has % or an unfilled value'
 Assert ($script.Contains("`$PluginLength = [long]'" + $pluginBytes.Length + "'") -and $script.Contains("`$ZipLength = [long]'" + $zipBytes.Length + "'")) 'Payload lengths not recorded'
 Assert ([Convert]::ToBase64String($all,$headerLength,$zipBytes.Length) -eq [Convert]::ToBase64String($zipBytes)) 'ZIP payload differs'
 Assert ([Convert]::ToBase64String($all,$headerLength+$zipBytes.Length,$pluginBytes.Length) -eq [Convert]::ToBase64String($pluginBytes)) 'Plugin payload differs'
 # An older per-role package is refused.
 @{version='1.0.0-rc.1';role='canada';files=@()} | ConvertTo-Json | Set-Content (Join-Path $pkg 'bundle.json')
 $oldZip=Join-Path $root 'VTubeControl-canada-1.0.0-rc.1.zip'; [IO.Compression.ZipFile]::CreateFromDirectory($pkg,$oldZip)
 $rejected=$false;try{& (Join-Path $scripts 'New-ControlInstaller.ps1') -ZipPath $oldZip -PluginPath $pluginPath -OutFile $out | Out-Null}catch{$rejected=$_.Exception.Message -like '*older canada-only package*'}
 Assert $rejected 'Per-role package wrapped into the one installer'
 Write-Host 'One installer file (header, ZIP + plugin payloads, unattended exit): PASS'

 # Uninstaller: it only removes what points into the install folder.
 $uninstaller=Join-Path $scripts 'Uninstall-VTubeInputBridge.ps1'
 $text=Get-Content -LiteralPath $uninstaller -Raw
 Assert ($text -notmatch '[^\x00-\x7F]') 'Uninstaller must be ASCII'
 Assert ($text.Contains('com.chayzx.vtubecontrol.sdPlugin') -and $text.Contains('CurrentVersion\Uninstall\VTubeInputBridge') -and $text.Contains('Restore-StreamPCRelay.ps1')) 'Uninstaller scope'
 . ([ScriptBlock]::Create((Get-FunctionText $uninstaller @('Test-Inside','Get-CommandExe'))))
 $versions=Join-Path $root 'VTubeControl/versions'
 Assert (Test-Inside (Join-Path $versions '1.0.0-rc.1/VTubeControl.exe') $versions) 'Installed exe not recognized'
 Assert (-not (Test-Inside (Join-Path $root 'VTubeControl/versions-old/x.exe') $versions)) 'Sibling folder treated as installed'
 Assert (-not (Test-Inside $versions $versions)) 'The folder itself is not inside'
 Assert (-not (Test-Inside '' $versions)) 'Empty path'
 Assert ((Get-CommandExe '"C:\A B\VTubeControl.exe" --canada --background') -eq 'C:\A B\VTubeControl.exe') 'Quoted Run entry'
 Assert ((Get-CommandExe 'C:\Apps\VTubeInputBridge.exe --sender') -eq 'C:\Apps\VTubeInputBridge.exe') 'Unquoted Run entry'
 Write-Host 'Uninstaller ownership checks: PASS'
} finally {Remove-Item -LiteralPath $root -Recurse -Force}

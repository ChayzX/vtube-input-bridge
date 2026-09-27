param([Parameter(Mandatory=$true)][string]$GamingPC)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer in an administrator PowerShell session.' }
$source = [Net.IPAddress]::Parse($GamingPC)
if ($source.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'GamingPC must be an IPv4 address.' }
foreach ($name in @('vts_input_relay.exe', 'VTubeInputBridge.exe')) {
    if (-not (Test-Path (Join-Path $PSScriptRoot $name))) { throw ('Missing package file: ' + $name) }
}
if ((Get-Process vts_input_relay -ErrorAction SilentlyContinue) -or (Get-Process VTubeInputBridge -ErrorAction SilentlyContinue)) {
    throw 'A bridge process is running. This installer will not interrupt it. Arrange an offline installation window first.'
}
$dir = Join-Path $env:ProgramData 'VTubeInputRelay'
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'vts_input_relay.exe'), (Join-Path $PSScriptRoot 'VTubeInputBridge.exe') $dir -Force
$receiverArgs = '--source ' + $source.ToString() + ' --token-file "' + (Join-Path $dir 'vts-token.txt') + '" --status-file "' + (Join-Path $dir 'status.json') + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $dir 'vts_input_relay.exe') -Argument $receiverArgs -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'VTube Input Relay' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
$rule = 'VTube Input Relay LAN'
Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5055 -RemoteAddress $source.ToString() -Profile Private | Out-Null
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name 'VTube Input Bridge Receiver' -Value ('"' + (Join-Path $dir 'VTubeInputBridge.exe') + '" --receiver')
Start-ScheduledTask -TaskName 'VTube Input Relay'
Write-Output 'Receiver installed. Open VTube Studio, enable its API, and approve Game Input Relay if asked.'
Write-Output ('Start the tray status window in the stream user session: "' + (Join-Path $dir 'VTubeInputBridge.exe') + '" --receiver')

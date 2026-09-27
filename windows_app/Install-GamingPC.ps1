$ErrorActionPreference = 'Stop'
$packageExe = Join-Path $PSScriptRoot 'VTubeInputBridge.exe'
if (-not (Test-Path -LiteralPath $packageExe)) { throw 'VTubeInputBridge.exe is missing from this folder.' }
if (Get-Process gaming_input_relay -ErrorAction SilentlyContinue) {
    throw 'The old console sender is still running. Disable and stop its scheduled task first, then rerun this installer.'
}
if (Get-Process VTubeInputBridge -ErrorAction SilentlyContinue) {
    throw 'The current VTube Input Bridge app is running. Choose Exit from its tray menu, then rerun this installer.'
}
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\VTubeInputBridge'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$installedExe = Join-Path $installDir 'VTubeInputBridge.exe'
Copy-Item -LiteralPath $packageExe -Destination $installedExe -Force
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-Item -Path $runKey -Force | Out-Null
Set-ItemProperty -Path $runKey -Name 'VTube Input Bridge' -Value ('"' + $installedExe + '" --sender --autostart')
Start-Process -FilePath $installedExe -ArgumentList '--sender','--autostart'
Write-Output ('Installed to ' + $installedExe)
Write-Output 'The app is set to send to 10.0.0.119 at sign-in. Closing the window keeps it in the system tray.'

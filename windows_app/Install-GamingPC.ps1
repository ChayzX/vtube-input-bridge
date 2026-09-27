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
$shortcutShell = New-Object -ComObject WScript.Shell
try {
    foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
        if ([string]::IsNullOrWhiteSpace($folder)) { throw 'Could not locate the current user shortcut folder.' }
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
        $shortcut = $shortcutShell.CreateShortcut((Join-Path $folder 'VTube Input Bridge.lnk'))
        try {
            $shortcut.TargetPath = $installedExe
            $shortcut.Arguments = '--sender --autostart'
            $shortcut.WorkingDirectory = $installDir
            $shortcut.IconLocation = $installedExe + ',0'
            $shortcut.Description = 'Send gaming keyboard and mouse input to the stream PC'
            $shortcut.Save()
        } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null }
    }
} finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcutShell) | Out-Null }
Start-Process -FilePath $installedExe -ArgumentList '--sender','--autostart'
Write-Output ('Installed to ' + $installedExe)
Write-Output 'Desktop and Start menu shortcuts created: VTube Input Bridge.'
Write-Output 'The app is set to send to 10.0.0.119 at sign-in. Closing the window keeps it in the system tray.'

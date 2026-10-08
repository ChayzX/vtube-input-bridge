# Puts the separate VTube Input Bridge tracking app back after a failed or unwanted update to the one-app version.
# Safe to run more than once. It stops the new app and its sign-in entry, restores the old app's sign-in entry and
# shortcuts (from the backups the one-click installer saved in the retired folder under LOCALAPPDATA\VTubeControl), and starts the
# old app. No program files are deleted, and the stream PC's vts_input_relay service is never stopped or changed.
# Run it as the signed-in user, without administrator rights. Keep it Windows PowerShell 5.1 compatible, plain ASCII,
# and free of the percent sign: scripts/New-RestoreTool.ps1 embeds it in Restore-SeparateTracking.cmd.
$ErrorActionPreference = 'Stop'
# Filled in by scripts/New-RestoreTool.ps1, which embeds a released copy of the app after the payload marker.
$EmbeddedVersion = '__VTR_VERSION__'
$EmbeddedSha256 = '__VTR_EXE_SHA__'
function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Show-Result([string]$Text, [bool]$Failed) {
    if ($env:VTC_QUIET -eq '1') { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
        try {
            $icon = if ($Failed) { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
            [void][System.Windows.Forms.MessageBox]::Show($owner, $Text, 'VTube Input Bridge restore', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
        } finally { $owner.Dispose() }
    } catch { }
}
# Writes the app embedded in the restore .cmd to a temporary file after checking its SHA256, or returns $null when
# this script runs on its own.
function Get-EmbeddedApp {
    if (-not $env:VTR_SELF -or $EmbeddedSha256 -notmatch '^[0-9a-f]{64}$') { return $null }
    $text = [IO.File]::ReadAllText($env:VTR_SELF)
    $marker = '#VTR-' + 'PAYLOAD#'
    $at = $text.IndexOf($marker)
    if ($at -lt 0) { return $null }
    $file = Join-Path ([IO.Path]::GetTempPath()) ('VTubeInputBridge-' + [Guid]::NewGuid().ToString('N') + '.exe')
    [IO.File]::WriteAllBytes($file, [Convert]::FromBase64String(($text.Substring($at + $marker.Length) -replace '[^A-Za-z0-9+/=]', '')))
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower() -ne $EmbeddedSha256) {
        Remove-Item -LiteralPath $file -Force
        throw 'The copy of the app inside this restore file failed its checksum. Download the restore file again.'
    }
    return $file
}
# Copy a sign-in value or shortcut aside before replacing it, so this restore can itself be undone.
function Save-Aside([string]$Name, [string]$Value) {
    New-Item -ItemType Directory -Force -Path $retired | Out-Null
    Set-Content -LiteralPath (Join-Path $retired ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $Name)) -Value $Value
}
function Set-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Description) {
    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($Path)
        $shortcut.TargetPath = $Target; $shortcut.Arguments = $Arguments
        $shortcut.WorkingDirectory = Split-Path $Target; $shortcut.IconLocation = $Target + ',0'
        $shortcut.Description = $Description; $shortcut.Save()
    } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null }
}

$exitCode = 0
$retired = Join-Path $env:LOCALAPPDATA 'VTubeControl\retired'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
try {
    Say 'Restoring the separate VTube Input Bridge tracking app...' 'Cyan'

    # 1. Which PC is this? Only the stream PC has the relay service.
    $relayTask = $null
    if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) { $relayTask = Get-ScheduledTask -TaskName 'VTube Input Relay' -ErrorAction SilentlyContinue }
    if ($relayTask) { $role = 'stream'; $oldArgs = '--receiver'; $runName = 'VTube Input Bridge Receiver' }
    else { $role = 'gaming'; $oldArgs = '--sender --autostart'; $runName = 'VTube Input Bridge' }

    # Find the separate app. The old window may have been run from anywhere (an extracted download, say), so look:
    # where its saved sign-in entry pointed, its standard install folders, then Downloads, Desktop and Documents.
    # The new app's own tracking helper is the same program and opens the same window, so it is the last resort.
    $standard = Join-Path $env:LOCALAPPDATA 'Programs\VTubeInputBridge\VTubeInputBridge.exe'
    $candidates = New-Object System.Collections.Generic.List[string]
    $savedRun = Join-Path $retired ($runName + '.run.txt')
    if (Test-Path -LiteralPath $savedRun) {
        $value = (Get-Content -LiteralPath $savedRun -Raw).Trim()
        $path = if ($value.StartsWith('"')) { $value.Substring(1, [Math]::Max(0, $value.IndexOf('"', 1) - 1)) } else { ($value -split ' ')[0] }
        if ($path) { $candidates.Add($path) }
    }
    $candidates.Add($standard)
    $candidates.Add((Join-Path $env:ProgramData 'VTubeInputRelay\VTubeInputBridge.exe'))
    foreach ($folder in @((Join-Path $env:USERPROFILE 'Downloads'), [Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('MyDocuments'))) {
        if ([string]::IsNullOrWhiteSpace($folder) -or -not (Test-Path -LiteralPath $folder)) { continue }
        Get-ChildItem -LiteralPath $folder -Filter 'VTubeInputBridge.exe' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | ForEach-Object { $candidates.Add($_.FullName) }
    }
    $found = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $found) {
        $helper = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'VTubeControl\versions') -Filter 'VTubeInputBridge.exe' -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like '*\tracking\VTubeInputBridge.exe' -or $_.FullName -like '*/tracking/VTubeInputBridge.exe' } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($helper) { $found = $helper.FullName; Say 'Using the tracking program from the new install.' }
    }
    if (-not $found) {
        $found = Get-EmbeddedApp
        if ($found) { Say ('Using the copy of the app built into this restore file (' + $EmbeddedVersion + ').') }
    }
    if (-not $found) {
        throw 'No copy of VTube Input Bridge was found on this PC (checked the saved sign-in entry, the install folders, Downloads, Desktop, Documents and the new install). Reinstall it from its package instead.'
    }
    # Keep the app in its standard folder so cleaning up Downloads or removing the new app cannot break it again.
    if ($found -ne $standard) {
        if (Get-Process VTubeInputBridge -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $standard }) { Get-Process VTubeInputBridge | Stop-Process -Force; Start-Sleep -Seconds 1 }
        New-Item -ItemType Directory -Force -Path (Split-Path $standard) | Out-Null
        Copy-Item -LiteralPath $found -Destination $standard -Force
        Say ('Copied ' + $found + ' to ' + $standard)
    }
    $oldExe = $standard
    Say ('This is the ' + $role + ' PC. Previous app: ' + $oldExe)

    # 2. Stop the new app first (it would restart its tracking helper), then any copy of the old window.
    #    vts_input_relay is a different program and is left running.
    foreach ($name in @('VTubeControl', 'VTubeInputBridge')) {
        $running = @(Get-Process $name -ErrorAction SilentlyContinue)
        if ($running.Count -gt 0) {
            $running | Stop-Process -Force
            $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
            Say ('Stopped ' + $name + '.')
        }
    }

    # 3. Sign-in: remove the new app, put the old one back (the installer saved its value in the retired folder).
    New-Item -Path $runKey -Force | Out-Null
    $run = Get-Item -Path $runKey
    if ($run.GetValueNames() -contains 'VTubeControl') {
        Save-Aside 'VTubeControl.run.txt' ([string]$run.GetValue('VTubeControl'))
        Remove-ItemProperty -Path $runKey -Name 'VTubeControl'
        Say 'Removed the new app from sign-in.'
    }
    Set-ItemProperty -Path $runKey -Name $runName -Value ('"' + $oldExe + '" ' + $oldArgs)
    Say ('Restored sign-in entry: ' + $runName)

    # 4. Shortcuts: the new app took over "VTube Input Bridge.lnk". Point the gaming PC's back at the old app; the
    #    stream PC never had any, so its copies are set aside.
    foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
        if ([string]::IsNullOrWhiteSpace($folder)) { continue }
        $link = Join-Path $folder 'VTube Input Bridge.lnk'
        if ($role -eq 'gaming') {
            Set-Shortcut $link $oldExe $oldArgs 'Send gaming keyboard and mouse input to the stream PC'
        } elseif (Test-Path -LiteralPath $link) {
            Copy-Item -LiteralPath $link -Destination (Join-Path $retired ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-VTube Input Bridge.lnk'))
            Remove-Item -LiteralPath $link
        }
    }
    Say 'Shortcuts restored.'

    # 5. The stream PC's receiver service must be running for tracking; report it rather than changing it.
    if ($role -eq 'stream' -and -not (Get-Process vts_input_relay -ErrorAction SilentlyContinue)) {
        Say 'Warning: the VTube Input Relay background service is not running. Restart the PC; if it is still not running, reinstall the StreamPC package as administrator.' 'Yellow'
    }

    # 6. Start the old app.
    Start-Process -FilePath $oldExe -ArgumentList ($oldArgs -split ' ') -WorkingDirectory (Split-Path $oldExe)
    $done = 'The separate VTube Input Bridge app is back and running (check the system tray). It starts at sign-in as before.'
    if ($role -eq 'gaming') { $done += ' It started sending to the stream PC.' } else { $done += ' Its window should say Receiving input while the gaming PC sends.' }
    Say ''
    Say $done 'Green'
    Show-Result $done $false
} catch {
    Say ''
    Say ('Restore failed: ' + $_.Exception.Message) 'Red'
    $exitCode = 1
    Show-Result ('Restore failed: ' + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'The window stays open with the details. Take a screenshot of it, then close it with its X button.') $true
}
exit $exitCode

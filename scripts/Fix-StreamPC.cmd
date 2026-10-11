@echo off
setlocal
title VTube Input Bridge stream PC fix
rem Generated from scripts/Fix-StreamPC.ps1: double-click on the stream PC to repair it and finish the update.
set "VTF_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:VTF_SELF); $a=$s.IndexOf('#VTF-'+'SCRIPT#'); & ([ScriptBlock]::Create($s.Substring($a+12)))"
set "VTF_RESULT=%ERRORLEVEL%"
if "%VTF_RESULT%"=="0" exit /b 0
echo.
echo Something went wrong. Send a screenshot of this window to whoever sent you this file.
echo When you are done, close this window with its X button.
pause
exit /b %VTF_RESULT%

#VTF-SCRIPT#
# Repairs the stream PC after a half-finished update and finishes it with the newest installer.
# The relay migration had removed the old SYSTEM task, but relay-config.json (the gaming PC address the app's own relay
# needs) went missing, so the installer stopped; and Restore-SeparateTracking, finding no task, took this PC for the
# gaming PC and set up the sender here. This script:
#   1. stops the app and the wrongly restored sender, removes the sender from sign-in and its shortcuts (set aside);
#   2. recreates relay-config.json from the migration record (else the old firewall rule, else 10.0.0.112);
#   3. runs the newest Install-VTubeInputBridge.cmd (or older -StreamPC.cmd) from Downloads or Desktop as the
#      Streaming PC, then reports.
# If the old task is still there, it skips 1-2 and only runs the installer, which migrates the task.
# Run it as the signed-in streaming user, without administrator rights. It never deletes program files. Keep it
# Windows PowerShell 5.1 compatible, plain ASCII, and free of the percent sign: Fix-StreamPC.cmd embeds it.
$ErrorActionPreference = 'Stop'
function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Show-Result([string]$Text, [bool]$Failed) {
    if ($env:VTC_QUIET -eq '1') { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
        try {
            $icon = if ($Failed) { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
            [void][System.Windows.Forms.MessageBox]::Show($owner, $Text, 'VTube Input Bridge stream PC fix', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
        } finally { $owner.Dispose() }
    } catch { }
}

$exitCode = 0
$roaming = [Environment]::GetFolderPath('ApplicationData')
if (-not $roaming) { $roaming = $env:APPDATA }
$appData = Join-Path $roaming 'VTubeControl'
$localRoot = Join-Path $env:LOCALAPPDATA 'VTubeControl'
$retired = Join-Path $localRoot 'retired'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
try {
    Say 'Fixing the stream PC and finishing the update...' 'Cyan'

    # 0. Find the newest installer first, so nothing changes if it is missing. The one installer serves both PCs;
    #    older builds had a separate StreamPC file. The Gaming PC file is never used here.
    $installer = @((Join-Path $env:USERPROFILE 'Downloads'), [Environment]::GetFolderPath('DesktopDirectory')) |
        Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
        ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter 'Install-VTubeInputBridge*.cmd' -Recurse -Depth 3 -ErrorAction SilentlyContinue } |
        Where-Object { $_.Name -notlike '*GamingPC*' } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw 'Install-VTubeInputBridge.cmd was not found in Downloads or on the Desktop. Put the newest one there and run this again. Nothing was changed.' }
    Say ('Using installer: ' + $installer.FullName + ' (' + $installer.LastWriteTime + ')')
    # With the old task still present the installer migrates it, and the migration refuses an existing
    # relay-config.json, so the repairs below (meant for a PC whose task is gone) are skipped.
    $legacyTask = (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) -and (Get-ScheduledTask -TaskName 'VTube Input Relay' -ErrorAction SilentlyContinue)
    if ($legacyTask) {
        Say 'The old VTube Input Relay task is present, so no repair is needed: running the installer, which migrates it.' 'Yellow'
    }

    if (-not $legacyTask) {
        # 1. Stop the app and the separate window (here: the sender the restore set up by mistake), then take the sender
        #    off sign-in and set its shortcuts aside. The installer creates the app's own shortcuts.
        foreach ($name in @('VTubeControl', 'VTubeInputBridge')) {
            $running = @(Get-Process $name -ErrorAction SilentlyContinue)
            if ($running.Count -gt 0) {
                $running | Stop-Process -Force
                $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
                Say ('Stopped ' + $name + '.')
            }
        }
        New-Item -ItemType Directory -Force -Path $retired | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $run = Get-Item -Path $runKey -ErrorAction SilentlyContinue
        if ($run -and ($run.GetValueNames() -contains 'VTube Input Bridge')) {
            $value = [string]$run.GetValue('VTube Input Bridge')
            if ($value -like '*--sender*') {
                Set-Content -LiteralPath (Join-Path $retired ($stamp + '-VTube Input Bridge.run.txt')) -Value $value
                Remove-ItemProperty -Path $runKey -Name 'VTube Input Bridge'
                Say 'Removed the gaming PC sender from sign-in on this stream PC.'
            }
        }
        foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
            if ([string]::IsNullOrWhiteSpace($folder)) { continue }
            $link = Join-Path $folder 'VTube Input Bridge.lnk'
            if (Test-Path -LiteralPath $link) {
                Copy-Item -LiteralPath $link -Destination (Join-Path $retired ($stamp + '-VTube Input Bridge.lnk')) -Force
                Remove-Item -LiteralPath $link
            }
        }

        # A version folder without its app is left from an interrupted install; the installer would refuse to reuse it.
        $versions = Join-Path $localRoot 'versions'
        if (Test-Path -LiteralPath $versions) {
            foreach ($dir in @(Get-ChildItem -LiteralPath $versions -Directory -ErrorAction SilentlyContinue)) {
                if (-not (Test-Path -LiteralPath (Join-Path $dir.FullName 'VTubeControl.exe'))) {
                    Move-Item -LiteralPath $dir.FullName -Destination (Join-Path $retired ($stamp + '-incomplete-' + $dir.Name))
                    Say ('Set aside an incomplete install: ' + $dir.Name)
                }
            }
        }

        # 2. Recreate relay-config.json (the gaming PC address the app's relay accepts input from) if it is missing.
        $configPath = Join-Path $appData 'relay-config.json'
        if (Test-Path -LiteralPath $configPath) {
            Say ('Relay settings already present: ' + $configPath)
        } else {
            $source = $null; $from = ''
            $record = Get-ChildItem -LiteralPath $retired -Filter 'migration.json' -Recurse -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($record) {
                try { $source = [string]((Get-Content -LiteralPath $record.FullName -Raw | ConvertFrom-Json).source); $from = 'the migration record' } catch { $source = $null }
            }
            if (-not $source -and (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) {
                try {
                    $rule = Get-NetFirewallRule -DisplayName 'VTube Input Relay LAN' -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($rule) {
                        $address = @(($rule | Get-NetFirewallAddressFilter).RemoteAddress) | Select-Object -First 1
                        if ($address) { $source = [string]$address; $from = 'the old firewall rule' }
                    }
                } catch { $source = $null }
            }
            $ip = $null
            if (-not $source -or -not [Net.IPAddress]::TryParse($source, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
                $source = '10.0.0.112'; $from = 'the documented gaming PC address'
            } else { $source = $ip.ToString() }
            New-Item -ItemType Directory -Force -Path $appData | Out-Null
            $temp = $configPath + '.new'
            # No byte-order mark: Windows PowerShell's -Encoding UTF8 adds one, and the app's JSON.parse rejects it.
            [IO.File]::WriteAllText($temp, (@{ source = $source } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
            Move-Item -LiteralPath $temp -Destination $configPath -Force
            Say ('Recreated relay settings: gaming PC ' + $source + ' (from ' + $from + ').') 'Green'
        }
    }

    # 3. Finish the update with the newest installer, as the Streaming PC (VTC_ROLE, so it does not ask). Its own
    #    "press any key" is skipped (input from NUL).
    Say ''
    Say 'Running the installer for the Streaming PC...' 'Cyan'
    $env:VTC_ROLE = 'canada'
    $process = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/d /c ""' + $installer.FullName + '" < NUL"') -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw ('The installer reported a problem (exit code ' + $process.ExitCode + '). Its messages are above.') }
    $done = 'The stream PC is fixed and updated. VTube Input Bridge is open in the tray; its Tracking section should say Receiving input while the gaming PC sends. If VTube Studio asks to allow "Game Input Relay", click Allow.'
    Say ''
    Say $done 'Green'
    Show-Result $done $false
} catch {
    Say ''
    Say ('Fix failed: ' + $_.Exception.Message) 'Red'
    $exitCode = 1
    Show-Result ('Fix failed: ' + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'The window stays open with the details. Take a screenshot of it, then close it with its X button.') $true
}
exit $exitCode

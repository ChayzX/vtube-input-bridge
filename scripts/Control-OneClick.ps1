# Body of the one-click VTube Input Bridge installer. scripts/New-ControlInstaller.ps1 fills in the values below and
# builds a .cmd whose tail holds the raw package ZIP, followed on the gaming PC by the Stream Deck plugin. The .cmd sets
# VTC_SELF to its own path. This script cuts the payloads off the end of that file, verifies them, retires the separate
# tracking app it replaces, runs the package's own Install-Control.ps1, and starts the one app.
# Keep it Windows PowerShell 5.1 compatible, plain ASCII, and free of the percent sign (cmd.exe would expand it).
$ErrorActionPreference = 'Stop'
$Role = '__VTC_ROLE__'
$Version = '__VTC_VERSION__'
$ZipName = '__VTC_ZIP_NAME__'
$ZipLength = [long]'__VTC_ZIP_LEN__'
$ZipSha256 = '__VTC_ZIP_SHA__'
$PluginName = '__VTC_PLUGIN_NAME__'
$PluginLength = [long]'__VTC_PLUGIN_LEN__'
$PluginSha256 = '__VTC_PLUGIN_SHA__'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

# Copy $Length bytes starting at $Offset of $Source into a new file at $Destination.
function Save-Range([string]$Source, [long]$Offset, [long]$Length, [string]$Destination) {
    $in = [IO.File]::OpenRead($Source)
    try {
        $out = [IO.File]::Create($Destination)
        try {
            [void]$in.Seek($Offset, [IO.SeekOrigin]::Begin)
            $buffer = New-Object byte[] 1048576
            $left = $Length
            while ($left -gt 0) {
                $read = $in.Read($buffer, 0, [int][Math]::Min([long]$buffer.Length, $left))
                if ($read -le 0) { throw 'The installer file is shorter than expected. Download it again.' }
                $out.Write($buffer, 0, $read)
                $left -= $read
            }
        } finally { $out.Dispose() }
    } finally { $in.Dispose() }
}

# Stop a process and wait for it, so its files and single-instance locks are released.
function Stop-Named([string]$Name, [string]$Label) {
    $running = @(Get-Process $Name -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        $running | Stop-Process -Force
        $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
        Say ('Closed ' + $Label + '.')
    }
}

$exitCode = 0
$work = Join-Path ([IO.Path]::GetTempPath()) ('vtubebridge-' + [Guid]::NewGuid().ToString('N'))
try {
    if ($Role -ne 'pantry' -and $Role -ne 'canada') { throw 'This installer was not generated correctly (unknown PC role).' }
    if ($ZipSha256 -notmatch '^[0-9a-f]{64}$' -or ($PluginLength -gt 0 -and $PluginSha256 -notmatch '^[0-9a-f]{64}$')) { throw 'This installer was not generated correctly (missing checksum).' }
    $pcName = if ($Role -eq 'pantry') { 'gaming PC' } else { 'stream PC' }
    Say ('VTube Input Bridge ' + $Version + ' for the ' + $pcName) 'Cyan'
    Say 'One app for tracking, Stream Deck controls and reactives. It replaces the separate tracking app.'

    # 1. Cut the package (and plugin) off the end of this file and verify them before changing anything on this PC.
    $total = (Get-Item -LiteralPath $env:VTC_SELF).Length
    $zipOffset = $total - $ZipLength - $PluginLength
    if ($zipOffset -le 0) { throw 'The installer file is incomplete. Download it again.' }
    New-Item -ItemType Directory -Path $work | Out-Null
    $zip = Join-Path $work $ZipName
    Say 'Checking the package...'
    Save-Range $env:VTC_SELF $zipOffset $ZipLength $zip
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower() -ne $ZipSha256) {
        throw 'The package failed its checksum (the file was damaged or altered). Nothing was installed.'
    }
    if ($PluginLength -gt 0) {
        $plugin = Join-Path $work $PluginName
        Save-Range $env:VTC_SELF ($zipOffset + $ZipLength) $PluginLength $plugin
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $plugin).Hash.ToLower() -ne $PluginSha256) {
            throw 'The package failed its checksum (the file was damaged or altered). Nothing was installed.'
        }
    }
    Say 'Package verified.' 'Green'

    $installRoot = Join-Path $env:LOCALAPPDATA 'VTubeControl'
    $retired = Join-Path $installRoot 'retired'
    New-Item -ItemType Directory -Force -Path $retired | Out-Null

    # 2. Retire the separate apps this one replaces. Removed sign-in entries and shortcuts are copied to $retired first.
    #    Tracking settings (address, game mouse mode) are kept: the new app reads the same files.
    if ($Role -eq 'pantry') {
        # The old console sender must not run beside the app (README setup step 5). Enable-ScheduledTask undoes this.
        if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
            foreach ($task in @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
                @($_.Actions | Where-Object { $_.Execute -like '*gaming_input_relay*' }).Count -gt 0 })) {
                try {
                    Stop-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName -ErrorAction SilentlyContinue
                    Disable-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName | Out-Null
                    Say ('Disabled old sender task: ' + $task.TaskPath + $task.TaskName)
                } catch {
                    throw ('Could not disable the old sender task "' + $task.TaskPath + $task.TaskName + '". Right-click this file and choose Run as administrator, or disable it in Task Scheduler.')
                }
            }
        }
        Stop-Named 'gaming_input_relay' 'the old console sender'
    }
    # The app first (an installed one would restart its tracking helper), then the old tracking window: the sender on
    # the gaming PC, the receiver status on the stream PC. The stream PC's vts_input_relay background service is a
    # different program and keeps running: it is what feeds VTube Studio.
    Stop-Named 'VTubeControl' 'the running app'
    Stop-Named 'VTubeInputBridge' 'the separate VTube Input Bridge window'
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $oldRun = if ($Role -eq 'pantry') { 'VTube Input Bridge' } else { 'VTube Input Bridge Receiver' }
    $runItem = Get-Item -Path $runKey -ErrorAction SilentlyContinue
    if ($runItem -and ($runItem.GetValueNames() -contains $oldRun)) {
        Set-Content -LiteralPath (Join-Path $retired ($oldRun + '.run.txt')) -Value ([string]$runItem.GetValue($oldRun))
        Remove-ItemProperty -Path $runKey -Name $oldRun
        Say ('Removed the separate app from sign-in (saved in ' + $retired + ').')
    }
    # Shortcuts from the 0.2 companion would open the old version without tracking.
    foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
        if ([string]::IsNullOrWhiteSpace($folder)) { continue }
        $old = Join-Path $folder 'VTube Control.lnk'
        if (Test-Path -LiteralPath $old) {
            Copy-Item -LiteralPath $old -Destination (Join-Path $retired ([Guid]::NewGuid().ToString('N') + '-VTube Control.lnk'))
            Remove-Item -LiteralPath $old
        }
    }

    # 3. Install with the package's own installer (per-file checksums, rollback record). It takes over the
    #    VTube Input Bridge shortcuts and starts the app in the tray at sign-in.
    $versionPath = Join-Path $installRoot ('versions\' + $Version)
    $exe = Join-Path $versionPath 'VTubeControl.exe'
    if (Test-Path -LiteralPath $exe) {
        Say ('VTube Input Bridge ' + $Version + ' is already installed; skipping the app install.')
    } else {
        Say 'Unpacking (this can take a minute)...'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $extract = Join-Path $work 'pkg'
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
        & (Join-Path $extract 'Install-Control.ps1') -Role $Role -EnableStartup
    }

    if ($Role -eq 'pantry' -and $PluginLength -gt 0) {
        # 4. Keep a copy of the plugin and let Stream Deck install it (it shows its own confirmation prompt).
        $pluginDir = Join-Path $installRoot 'streamdeck'
        New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
        $pluginKeep = Join-Path $pluginDir $PluginName
        Copy-Item -LiteralPath $plugin -Destination $pluginKeep -Force
        $streamDeck = Join-Path $env:ProgramFiles 'Elgato\StreamDeck\StreamDeck.exe'
        if ((Test-Path -LiteralPath $streamDeck) -or (Get-Process StreamDeck -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $pluginKeep
            Say 'Stream Deck is opening the VTube Control plugin: confirm the install there (needs Stream Deck 7.1 or newer).'
        } else {
            Say ('Stream Deck was not found. After installing Stream Deck 7.1 or newer, double-click ' + $pluginKeep)
        }
    }
    if ($Role -eq 'canada' -and (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) -and
        -not (Get-ScheduledTask -TaskName 'VTube Input Relay' -ErrorAction SilentlyContinue)) {
        Say 'Note: the VTube Input Relay background service is not installed on this PC. Tracking needs it once:' 'Yellow'
        Say 'run Install-StreamPC.ps1 from the StreamPC package as administrator (see its README).' 'Yellow'
    }

    # 5. Start the one app. On the gaming PC it starts sending as the old app did.
    if (-not (Get-Process VTubeControl -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $exe -ArgumentList ('--' + $Role) -WorkingDirectory $versionPath
    }
    Say ''
    Say ('VTube Input Bridge ' + $Version + ' is installed and open (check the system tray).') 'Green'
    Say 'It starts in the tray at sign-in. Stream Deck controls and reactives stay off until paired and enabled.'
} catch {
    Say ''
    Say ('Install failed: ' + $_.Exception.Message) 'Red'
    $exitCode = 1
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit $exitCode

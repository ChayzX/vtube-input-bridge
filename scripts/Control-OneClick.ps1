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

# Reports the result in a dialog that stays on top of other windows. The console's "press any key" missed key presses
# once the app, the firewall prompt or Stream Deck took keyboard focus (issue #6), so a dialog is the one window the
# user is sure to see and answer. VTC_QUIET=1 skips it for scripted installs.
function Show-Result([string]$Text, [bool]$Failed) {
    if ($env:VTC_QUIET -eq '1') { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
        try {
            $icon = if ($Failed) { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
            [void][System.Windows.Forms.MessageBox]::Show($owner, $Text, 'VTube Input Bridge', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
        } finally { $owner.Dispose() }
    } catch { }
}

$exitCode = 0
$work = Join-Path ([IO.Path]::GetTempPath()) ('vtubebridge-' + [Guid]::NewGuid().ToString('N'))
try {
    if ($Role -ne 'pantry' -and $Role -ne 'canada') { throw 'This installer was not generated correctly (unknown PC role).' }
    if ($ZipSha256 -notmatch '^[0-9a-f]{64}$' -or ($PluginLength -gt 0 -and $PluginSha256 -notmatch '^[0-9a-f]{64}$')) { throw 'This installer was not generated correctly (missing checksum).' }
    $pcName = if ($Role -eq 'pantry') { 'Gaming PC' } else { 'Streaming PC' }
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

    # 2. Install first, and retire the old tracking app only once that worked: retiring first left a PC
    #    with nothing running when the install failed. The package's own installer checks every file and keeps a
    #    rollback record; it takes over the VTube Input Bridge shortcuts and starts the app in the tray at sign-in.
    $versionPath = Join-Path $installRoot ('versions\' + $Version)
    $exe = Join-Path $versionPath 'VTubeControl.exe'
    if (Test-Path -LiteralPath $exe) {
        Say ('VTube Input Bridge ' + $Version + ' is already installed; skipping the app install.')
    } else {
        if (Test-Path -LiteralPath $versionPath) {
            throw ('An earlier install of ' + $Version + ' did not finish. Run Rollback-Control.ps1 with the newest rollback.json under ' + (Join-Path $installRoot 'rollback') + ', then run this installer again. Nothing was changed this time.')
        }
        # The package installer refuses to replace a running app. Only an earlier version of this app is stopped
        # here; it is restarted below if the install fails. The old tracking window keeps running for now.
        $previous = @(Get-Process VTubeControl -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique)
        Stop-Named 'VTubeControl' 'the running app'
        Say 'Unpacking (this can take a minute)...'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $extract = Join-Path $work 'pkg'
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
    }

    try {
        if ($Role -eq 'canada') {
            if (-not $extract) {
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                $extract = Join-Path $work 'pkg'
                [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
            }
            $relayTask = Get-ScheduledTask -TaskName 'VTube Input Relay' -ErrorAction SilentlyContinue
            $relayConfig = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'VTubeControl\relay-config.json'
            if ($relayTask) {
                Say 'One-time Streaming PC migration: Windows will ask permission to replace only the old SYSTEM task.' 'Yellow'
                $migration = Join-Path $extract 'Migrate-StreamPCRelay.ps1'
                $appSettings = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'VTubeControl'
                $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $migration + '" -UserAppDataPath "' + $appSettings + '" -UserLocalAppDataPath "' + $installRoot + '"'
                $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $arguments
                if ($process.ExitCode -ne 0) { throw 'Streaming PC relay migration did not complete. The old task must remain stopped/unchanged as reported; do not launch this app yet.' }
            } elseif (-not (Test-Path -LiteralPath $relayConfig)) {
                # A new Streaming PC: nothing to migrate. The app learns the Gaming PC's address when the PCs are paired.
                Say 'New Streaming PC: tracking starts once this PC is paired with the Gaming PC (PC link in the app).'
            }
        }
        if (-not (Test-Path -LiteralPath $exe)) { & (Join-Path $extract 'Install-Control.ps1') -Role $Role -EnableStartup }
    } catch {
        foreach ($path in $previous) { Start-Process -FilePath $path -ArgumentList ('--' + $Role, '--background') -ErrorAction SilentlyContinue }
        throw ('The app could not be installed: ' + $_.Exception.Message + ' The previous apps were left in place.')
    }

    # 2b. Let the other PC reach this one on TCP 5056 (the secure link between the PCs). Without a rule Windows asks the
    #     first time the app listens, possibly while it is hidden in the tray, and a cancelled prompt blocks the link.
    #     The rule is for this version's app on private networks from this subnet; the app itself accepts only the
    #     paired PC's address and token. It is replaced on each upgrade. A refusal is a warning, not a failure.
    try {
        $hasRule = $false
        if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {
            $hasRule = @(Get-NetFirewallRule -Group 'VTube Input Bridge' -ErrorAction SilentlyContinue | Get-NetFirewallApplicationFilter |
                Where-Object { $_.Program -eq $exe }).Count -gt 0
        }
        if (-not $hasRule) {
            Say 'Windows will ask permission to let the other PC connect to VTube Input Bridge (TCP 5056, private networks).' 'Yellow'
            $quoted = $exe.Replace("'", "''")
            $rule = "Get-NetFirewallRule -Group 'VTube Input Bridge' -ErrorAction SilentlyContinue | Remove-NetFirewallRule; " +
                "New-NetFirewallRule -DisplayName 'VTube Input Bridge link between the PCs' -Group 'VTube Input Bridge' -Direction Inbound -Action Allow " +
                "-Protocol TCP -LocalPort 5056 -RemoteAddress LocalSubnet -Program '" + $quoted + "' -Profile Private | Out-Null"
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($rule))
            $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded)
            if ($process.ExitCode -ne 0) { throw ('exit code ' + $process.ExitCode) }
            Say 'Added the firewall rule for the link between the PCs.' 'Green'
        }
    } catch {
        Say ('Warning: the firewall rule was not added (' + $_.Exception.Message + '). If Windows asks whether VTube Input Bridge may use the network, allow it on private networks; otherwise the other PC cannot reach this one.') 'Yellow'
    }

    # 3. Now retire the separate apps this one replaces. Removed sign-in entries and shortcuts are copied to $retired
    #    first. A problem here is a warning, not a failure: the new app is installed, and whatever was not retired
    #    keeps working. Tracking settings (address, game mouse mode) carry over: the new app reads the same files.
    try {
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
                        Say ('Warning: could not disable the old sender task "' + $task.TaskPath + $task.TaskName + '". Disable it in Task Scheduler.') 'Yellow'
                    }
                }
            }
            Stop-Named 'gaming_input_relay' 'the old console sender'
        }
        # The old tracking window: the sender on the gaming PC, the receiver status on the stream PC. On the stream PC
        # the new app now runs vts_input_relay itself (migrated above), so nothing that feeds VTube Studio stops here.
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
    } catch {
        Say ('Warning: the separate tracking app was not fully retired: ' + $_.Exception.Message) 'Yellow'
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
    $nl = [Environment]::NewLine
    Say ''
    Say ('VTube Input Bridge ' + $Version + ' is installed.') 'Green'
    Say 'It starts in the tray at sign-in. Remote controls and reactives switch on once the two PCs are paired.'
    Show-Result ('VTube Input Bridge ' + $Version + ' is installed.' + $nl + $nl + 'Click OK to open it. From now on it starts in the system tray when you sign in.') $false

    # 5. Open the app only after the dialog, so nothing competes for focus. On the gaming PC it starts sending as the
    #    old app did. This window then closes by itself.
    if (-not (Get-Process VTubeControl -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $exe -ArgumentList ('--' + $Role) -WorkingDirectory $versionPath
    }
    Say 'VTube Input Bridge is open (check the system tray).' 'Green'
} catch {
    Say ''
    Say ('Install failed: ' + $_.Exception.Message) 'Red'
    $exitCode = 1
    Show-Result ('Install failed: ' + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'The installer window stays open with the details. Take a screenshot of it, then close it with its X button.') $true
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit $exitCode

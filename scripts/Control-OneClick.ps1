# Body of the one-click VTube Input Bridge installer (Install-VTubeInputBridge.cmd), the same file for both PCs.
# scripts/New-ControlInstaller.ps1 fills in the values below and builds a .cmd whose tail holds the raw package ZIP
# followed by the Stream Deck plugin. The .cmd sets VTC_SELF to its own path. This script cuts the payloads off the end
# of that file, verifies them, works out which PC this is, runs the package's own Install-Control.ps1, retires the
# separate tracking app it replaces, and starts the one app.
#
# Environment (all optional):
#   VTC_ROLE=pantry|canada  This PC's role (pantry = Gaming PC, canada = Streaming PC). Without it the role comes from
#                           role.txt in the roaming VTubeControl settings folder, then the old "VTube Input Relay" task (Streaming PC), then
#                           a "Which PC is this?" question.
#   VTC_QUIET=1             No dialogs or questions. The role must be known without asking.
#   VTC_UPDATE=1            Unattended update for the in-app updater; implies VTC_QUIET=1. Role from VTC_ROLE or
#                           role.txt only. Waits up to 20 s for VTubeControl.exe to exit (then stops it), installs,
#                           writes last-update.json in the local VTubeControl folder ({version, ok, message, at}) and starts
#                           the app again with --<role> --background. Never asks for administrator approval.
# Exit codes: 0 installed, 1 failed, 2 cancelled at the question, 3 the PC's role is unknown and could not be asked.
# Keep it Windows PowerShell 5.1 compatible, plain ASCII, and free of the percent sign (cmd.exe would expand it).
$ErrorActionPreference = 'Stop'
$Version = '__VTC_VERSION__'
$ZipName = '__VTC_ZIP_NAME__'
$ZipLength = [long]'__VTC_ZIP_LEN__'
$ZipSha256 = '__VTC_ZIP_SHA__'
$PluginName = '__VTC_PLUGIN_NAME__'
$PluginLength = [long]'__VTC_PLUGIN_LEN__'
$PluginSha256 = '__VTC_PLUGIN_SHA__'

$Update = $env:VTC_UPDATE -eq '1'
if ($Update) { $env:VTC_QUIET = '1' }
$Quiet = $env:VTC_QUIET -eq '1'
$roaming = [Environment]::GetFolderPath('ApplicationData')
if (-not $roaming) { $roaming = $env:APPDATA }
$appSettings = Join-Path $roaming 'VTubeControl'
$installRoot = Join-Path $env:LOCALAPPDATA 'VTubeControl'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

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

# The in-app updater starts this installer and then exits by itself: give it time to close cleanly, then stop it.
function Wait-AppExit([int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Process VTubeControl -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
    Stop-Named 'VTubeControl' 'the running app'
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

# The role the app last ran as (the app and Install-Control.ps1 write it), or '' when there is none.
function Read-SavedRole([string]$Path) {
    try { $saved = ([IO.File]::ReadAllText($Path)).Trim().ToLower() } catch { return '' }
    if ($saved -eq 'pantry' -or $saved -eq 'canada') { return $saved }
    return ''
}

function Test-LegacyRelayTask {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return $false }
    return [bool](Get-ScheduledTask -TaskName 'VTube Input Relay' -ErrorAction SilentlyContinue)
}

# Which PC is this? VTC_ROLE, then the saved role, then $Detect (the old relay task means the Streaming PC), then $Ask.
# A null $Detect or $Ask skips that step. Returns Role 'pantry', 'canada', 'cancel' (question cancelled) or '' (unknown).
function Resolve-InstallRole([string]$EnvRole, [string]$SavedRole, [scriptblock]$Detect, [scriptblock]$Ask) {
    if ($EnvRole) {
        $role = $EnvRole.Trim().ToLower()
        if ($role -ne 'pantry' -and $role -ne 'canada') { throw ('VTC_ROLE must be pantry (Gaming PC) or canada (Streaming PC), not "' + $EnvRole + '".') }
        return [pscustomobject]@{ Role = $role; From = 'VTC_ROLE' }
    }
    if ($SavedRole -eq 'pantry' -or $SavedRole -eq 'canada') { return [pscustomobject]@{ Role = $SavedRole; From = 'the existing install' } }
    if ($Detect -and (& $Detect)) { return [pscustomobject]@{ Role = 'canada'; From = 'the old VTube Input Relay task' } }
    if ($Ask) { return [pscustomobject]@{ Role = [string](& $Ask); From = 'your answer' } }
    return [pscustomobject]@{ Role = ''; From = '' }
}

function Show-RolePicker {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object System.Windows.Forms.Form
    try {
        $form.Text = 'VTube Input Bridge ' + $Version
        $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.MinimizeBox = $false
        $form.TopMost = $true; $form.ClientSize = New-Object System.Drawing.Size(480, 260)
        $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        $title = New-Object System.Windows.Forms.Label
        $title.Text = 'Which PC is this?'; $title.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
        $title.Location = New-Object System.Drawing.Point(20, 15); $title.Size = New-Object System.Drawing.Size(440, 32)
        $hint = New-Object System.Windows.Forms.Label
        $hint.Text = 'VTube Input Bridge runs on both PCs. Choose the one you are installing on now.'
        $hint.Location = New-Object System.Drawing.Point(20, 50); $hint.Size = New-Object System.Drawing.Size(440, 40)
        $gaming = New-Object System.Windows.Forms.Button
        $gaming.Text = 'Gaming PC (plays the game, has the Stream Deck)'; $gaming.DialogResult = [System.Windows.Forms.DialogResult]::Yes
        $gaming.Location = New-Object System.Drawing.Point(20, 95); $gaming.Size = New-Object System.Drawing.Size(440, 50)
        $stream = New-Object System.Windows.Forms.Button
        $stream.Text = 'Streaming PC (runs OBS and VTube Studio)'; $stream.DialogResult = [System.Windows.Forms.DialogResult]::No
        $stream.Location = New-Object System.Drawing.Point(20, 155); $stream.Size = New-Object System.Drawing.Size(440, 50)
        $cancel = New-Object System.Windows.Forms.Button
        $cancel.Text = 'Cancel'; $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $cancel.Location = New-Object System.Drawing.Point(360, 218); $cancel.Size = New-Object System.Drawing.Size(100, 32)
        $form.Controls.AddRange(@($title, $hint, $gaming, $stream, $cancel))
        $form.CancelButton = $cancel
        $answer = $form.ShowDialog()
        if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { return 'pantry' }
        if ($answer -eq [System.Windows.Forms.DialogResult]::No) { return 'canada' }
        return 'cancel'
    } finally { $form.Dispose() }
}

# One JSON line the app reads after it restarts: {version, ok, message, at}. No byte-order mark.
function Write-UpdateResult([string]$Path, [string]$ForVersion, [bool]$Ok, [string]$Message) {
    try {
        New-Item -ItemType Directory -Force -Path (Split-Path $Path -Parent) | Out-Null
        $at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
        $line = [ordered]@{ version = $ForVersion; ok = $Ok; message = $Message; at = $at } | ConvertTo-Json -Compress
        $temp = $Path + '.new'
        [IO.File]::WriteAllText($temp, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
        Move-Item -LiteralPath $temp -Destination $Path -Force
    } catch { Say ('Could not write ' + $Path + ': ' + $_.Exception.Message) 'Yellow' }
}

# After a failed update the app must come back: start what sign-in starts (the newest installed app with its role),
# else the app that was running before.
function Start-PreviousApp([string[]]$Previous, [string]$ForRole) {
    if (Get-Process VTubeControl -ErrorAction SilentlyContinue) { return }
    $run = Get-Item -Path $runKey -ErrorAction SilentlyContinue
    $command = if ($run -and ($run.GetValueNames() -contains 'VTubeControl')) { [string]$run.GetValue('VTubeControl') } else { '' }
    if ($command -match '^\s*"(?<exe>[^"]+)"\s*(?<rest>.*)$' -and (Test-Path -LiteralPath $Matches.exe)) {
        $exePath = $Matches.exe; $rest = $Matches.rest
        Start-Process -FilePath $exePath -ArgumentList $rest -WorkingDirectory (Split-Path $exePath -Parent) -ErrorAction SilentlyContinue
        return
    }
    $arguments = @('--background'); if ($ForRole) { $arguments = @('--' + $ForRole, '--background') }
    foreach ($path in $Previous) { if ($path -and (Test-Path -LiteralPath $path)) { Start-Process -FilePath $path -ArgumentList $arguments -ErrorAction SilentlyContinue; return } }
}

# The port rules Set-BridgeFirewall.ps1 makes (Installer.Tests.ps1 checks the two lists match): name, protocol, port.
function Get-BridgeRuleSpec([string]$ForRole) {
    $spec = @(@('VTubeInputBridge-Link-TCP-5056', 'TCP', '5056'), @('VTubeInputBridge-Pairing-TCP-5059', 'TCP', '5059'), @('VTubeInputBridge-Pairing-UDP-5059', 'UDP', '5059'))
    if ($ForRole -eq 'canada') { $spec += ,@('VTubeInputBridge-Tracking-UDP-5055', 'UDP', '5055') }
    return $spec
}

# True when those rules all exist as Set-BridgeFirewall.ps1 makes them: enabled inbound allow, private networks, local
# subnet, any program. Reading rules needs no approval, so installs and updates elevate only when this is false.
function Test-BridgeFirewall([string]$ForRole) {
    if (-not (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue)) { return $false }
    foreach ($want in (Get-BridgeRuleSpec $ForRole)) {
        $rule = Get-NetFirewallRule -Name $want[0] -ErrorAction SilentlyContinue
        if (-not $rule -or [string]$rule.Enabled -ne 'True' -or [string]$rule.Direction -ne 'Inbound' -or [string]$rule.Action -ne 'Allow' -or [string]$rule.Profile -ne 'Private') { return $false }
        $port = @($rule | Get-NetFirewallPortFilter)
        if ($port.Count -ne 1 -or [string]$port[0].Protocol -ne $want[1] -or (@($port[0].LocalPort) -join ',') -ne $want[2]) { return $false }
        $address = @($rule | Get-NetFirewallAddressFilter)
        if ($address.Count -ne 1 -or (@($address[0].RemoteAddress) -join ',') -ne 'LocalSubnet') { return $false }
        $program = @($rule | Get-NetFirewallApplicationFilter)
        if ($program.Count -eq 1 -and [string]$program[0].Program -ne 'Any') { return $false }
    }
    return $true
}

# The Version in a Stream Deck plugin's manifest.json, from the .streamDeckPlugin file or the installed folder.
function Get-PluginVersion([string]$Path) {
    try {
        if (Test-Path -LiteralPath $Path -PathType Container) { return [string]((Get-Content -LiteralPath (Join-Path $Path 'manifest.json') -Raw | ConvertFrom-Json).Version) }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($Path)
        try {
            $entry = $archive.Entries | Where-Object { $_.FullName -match '^[^/]+\.sdPlugin/manifest\.json$' } | Select-Object -First 1
            $reader = New-Object IO.StreamReader($entry.Open())
            try { return [string](($reader.ReadToEnd() | ConvertFrom-Json).Version) } finally { $reader.Dispose() }
        } finally { $archive.Dispose() }
    } catch { return '' }
}

$exitCode = 0
$Role = ''
$previous = @()
$notes = New-Object System.Collections.ArrayList
$resultPath = Join-Path $installRoot 'last-update.json'
$work = Join-Path ([IO.Path]::GetTempPath()) ('vtubebridge-' + [Guid]::NewGuid().ToString('N'))
$package = @{ Dir = $null }
try {
    if ($ZipSha256 -notmatch '^[0-9a-f]{64}$' -or $PluginSha256 -notmatch '^[0-9a-f]{64}$') { throw 'This installer was not generated correctly (missing checksum).' }
    if ($Update) {
        Say ('Updating VTube Input Bridge to ' + $Version + '...') 'Cyan'
        $previous = @(Get-Process VTubeControl -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique)
        Wait-AppExit 20
    }

    # 0. Which PC is this? An update never asks; a quiet install does not ask either.
    $detect = if ($Update) { $null } else { { Test-LegacyRelayTask } }
    $ask = if ($Quiet) { $null } else { { Show-RolePicker } }
    $choice = Resolve-InstallRole $env:VTC_ROLE (Read-SavedRole (Join-Path $appSettings 'role.txt')) $detect $ask
    if ($choice.Role -eq 'cancel') { $exitCode = 2; throw 'Cancelled. Nothing was changed.' }
    if (-not $choice.Role) {
        $exitCode = 3
        if ($Update) { throw 'This PC has no saved role (role.txt), so the update cannot tell which PC it is. Run Install-VTubeInputBridge.cmd by double-clicking it once. Nothing was changed.' }
        throw 'Could not tell which PC this is. Set VTC_ROLE=pantry (Gaming PC) or VTC_ROLE=canada (Streaming PC), or run the installer without VTC_QUIET. Nothing was changed.'
    }
    $Role = $choice.Role
    $pcName = if ($Role -eq 'pantry') { 'Gaming PC' } else { 'Streaming PC' }
    Say ('VTube Input Bridge ' + $Version + ' for the ' + $pcName + ' (from ' + $choice.From + ')') 'Cyan'
    Say 'One app for tracking, Stream Deck controls and reactives. It replaces the separate tracking app.'

    # 1. Cut the package and plugin off the end of this file and verify them before changing anything on this PC.
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
    $plugin = Join-Path $work $PluginName
    Save-Range $env:VTC_SELF ($zipOffset + $ZipLength) $PluginLength $plugin
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $plugin).Hash.ToLower() -ne $PluginSha256) {
        throw 'The package failed its checksum (the file was damaged or altered). Nothing was installed.'
    }
    Say 'Package verified.' 'Green'
    # Unpack once, when first needed (a hashtable, so the change is seen outside the scriptblock's own scope).
    $expand = {
        if (-not $package.Dir) {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $package.Dir = Join-Path $work 'pkg'
            [IO.Compression.ZipFile]::ExtractToDirectory($zip, $package.Dir)
        }
        $package.Dir
    }

    $retired = Join-Path $installRoot 'retired'
    New-Item -ItemType Directory -Force -Path $retired | Out-Null

    # 2. Install first, and retire the old tracking app only once that worked: retiring first left a PC
    #    with nothing running when the install failed. The package's own installer checks every file and keeps a
    #    rollback record; it takes over the VTube Input Bridge shortcuts and starts the app in the tray at sign-in.
    $versionPath = Join-Path $installRoot ('versions\' + $Version)
    $exe = Join-Path $versionPath 'VTubeControl.exe'
    if (Test-Path -LiteralPath $exe) {
        Say ('VTube Input Bridge ' + $Version + ' is already installed; skipping the app install.')
        [void]$notes.Add('Version ' + $Version + ' was already installed.')
    } else {
        if (Test-Path -LiteralPath $versionPath) {
            throw ('An earlier install of ' + $Version + ' did not finish. Run Rollback-Control.ps1 with the newest rollback.json under ' + (Join-Path $installRoot 'rollback') + ', then run this installer again. Nothing was changed this time.')
        }
        # The package installer refuses to replace a running app. Only an earlier version of this app is stopped
        # here; it is restarted below if the install fails. The old tracking window keeps running for now.
        $previous = @($previous) + @(Get-Process VTubeControl -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique)
        Stop-Named 'VTubeControl' 'the running app'
        Say 'Unpacking (this can take a minute)...'
        [void](& $expand)
    }

    try {
        if ($Role -eq 'canada') {
            [void](& $expand)
            $relayTask = Get-ScheduledTask -TaskName 'VTube Input Relay' -ErrorAction SilentlyContinue
            $relayConfig = Join-Path $appSettings 'relay-config.json'
            if ($relayTask -and -not $Update) {
                # The migration refuses to run beside the app (it would take over UDP 5055), so stop it here too when
                # this version was already installed; it is started again at the end, or below if this fails.
                $previous = @($previous) + @(Get-Process VTubeControl -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique)
                Stop-Named 'VTubeControl' 'the running app'
            }
            if ($relayTask -and $Update) {
                throw 'This Streaming PC still has the old VTube Input Relay task. Moving it into the app needs administrator approval once: run Install-VTubeInputBridge.cmd by double-clicking it.'
            } elseif ($relayTask) {
                Say 'One-time Streaming PC migration: Windows will ask permission to replace only the old SYSTEM task.' 'Yellow'
                $migration = Join-Path (& $expand) 'Migrate-StreamPCRelay.ps1'
                $migrationLog = Join-Path $work 'relay-migration.log'
                $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $migration + '" -UserAppDataPath "' + $appSettings + '" -UserLocalAppDataPath "' + $installRoot + '" -LogPath "' + $migrationLog + '"'
                $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $arguments
                $reason = if (Test-Path -LiteralPath $migrationLog) { ((Get-Content -LiteralPath $migrationLog) | Where-Object { $_ -like 'FAILED *' } | Select-Object -Last 1) } else { $null }
                if ($process.ExitCode -ne 0) {
                    $why = if ($reason) { $reason.Substring(7) } else { 'The permission prompt was cancelled or the migration window closed early.' }
                    throw ('Streaming PC relay migration did not complete: ' + $why + ' The old relay task was left as it was.')
                }
                Say 'Moved tracking from the old relay task into the app.' 'Green'
            } elseif (-not (Test-Path -LiteralPath $relayConfig)) {
                # A new Streaming PC: nothing to migrate. The app learns the Gaming PC's address when the PCs are paired.
                Say 'New Streaming PC: tracking starts once this PC is paired with the Gaming PC (PC link in the app).'
            }
        }
        if (-not (Test-Path -LiteralPath $exe)) { & (Join-Path (& $expand) 'Install-Control.ps1') -Role $Role -EnableStartup }
    } catch {
        Start-PreviousApp $previous $Role
        throw ('The app could not be installed: ' + $_.Exception.Message + ' The previous apps were left in place.')
    }
    # Remember the role for the next update and plain launches (Install-Control.ps1 also writes it on a new install).
    New-Item -ItemType Directory -Force -Path $appSettings | Out-Null
    [IO.File]::WriteAllText((Join-Path $appSettings 'role.txt'), $Role, (New-Object Text.UTF8Encoding $false))

    # 2b. Let the other PC reach this one: the PC link (TCP 5056), pairing/discovery (TCP and UDP 5059) and, on the
    #     Streaming PC, tracking (UDP 5055). Port rules on private networks from the local subnet, for any program, so
    #     a changed address on the other PC or a new app version needs no change (the app itself accepts only the
    #     paired PC's certificate). Without them Windows asks the first time the app listens, possibly while it is
    #     hidden in the tray. Approval is asked only when the rules are missing or differ; older VTube Control rules
    #     are replaced then. A refusal is a warning, not a failure. An update never asks: it reports missing rules.
    $firewallMissing = $false
    try {
        if (-not (Test-BridgeFirewall $Role)) {
            if ($Update) {
                $firewallMissing = $true
                [void]$notes.Add('The firewall rules for VTube Input Bridge are missing, so the two PCs may not reach each other. Run Install-VTubeInputBridge.cmd by double-clicking it and accept the Windows prompt.')
                Say ('Warning: ' + $notes[$notes.Count - 1]) 'Yellow'
            } else {
                $ports = if ($Role -eq 'canada') { 'TCP 5056, TCP and UDP 5059, UDP 5055' } else { 'TCP 5056, TCP and UDP 5059' }
                Say ('Windows will ask permission to let the other PC connect to VTube Input Bridge (' + $ports + ', private networks only).') 'Yellow'
                $firewallLog = Join-Path $work 'firewall.log'
                $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path (& $expand) 'Set-BridgeFirewall.ps1') + '" -Role ' + $Role + ' -VersionsRoot "' + (Join-Path $installRoot 'versions') + '" -LogPath "' + $firewallLog + '"'
                $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList $arguments
                if ($process.ExitCode -ne 0) {
                    $reason = if (Test-Path -LiteralPath $firewallLog) { ((Get-Content -LiteralPath $firewallLog) | Where-Object { $_ -like 'FAILED *' } | Select-Object -Last 1) } else { $null }
                    throw $(if ($reason) { $reason.Substring(7) } else { 'the permission prompt was cancelled' })
                }
                Say 'Added the firewall rules for the link between the PCs.' 'Green'
            }
        }
    } catch {
        $firewallMissing = $true
        Say ('Warning: the firewall rules were not added (' + $_.Exception.Message + ').') 'Yellow'
    }
    $firewallText = 'The firewall rules were not added, so the two PCs cannot reach each other until you run this installer again and accept the Windows permission prompt.'

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

    if ($Role -eq 'pantry') {
        # 4. The Stream Deck sits on the Gaming PC. Keep a copy of the plugin and let Stream Deck install it (it shows
        #    its own confirmation prompt). An update does not open that prompt; it reports a newer plugin instead.
        $pluginDir = Join-Path $installRoot 'streamdeck'
        New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
        $pluginKeep = Join-Path $pluginDir $PluginName
        Copy-Item -LiteralPath $plugin -Destination $pluginKeep -Force
        $streamDeck = Join-Path $env:ProgramFiles 'Elgato\StreamDeck\StreamDeck.exe'
        $installedPlugin = Join-Path $roaming 'Elgato\StreamDeck\Plugins\com.chayzx.vtubecontrol.sdPlugin'
        if ($Update) {
            $newPlugin = Get-PluginVersion $pluginKeep
            if ((Test-Path -LiteralPath $installedPlugin) -and $newPlugin -and $newPlugin -ne (Get-PluginVersion $installedPlugin)) {
                [void]$notes.Add('A newer Stream Deck plugin (' + $newPlugin + ') is ready: double-click ' + $pluginKeep + ' when you are not streaming.')
            }
        } elseif ((Test-Path -LiteralPath $streamDeck) -or (Get-Process StreamDeck -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $pluginKeep
            Say 'Stream Deck is opening the VTube Input Bridge plugin: confirm the install there (needs Stream Deck 7.1 or newer).'
        } else {
            Say ('Stream Deck was not found. After installing Stream Deck 7.1 or newer, double-click ' + $pluginKeep)
        }
    }
    $nl = [Environment]::NewLine
    Say ''
    Say ('VTube Input Bridge ' + $Version + ' is installed.') 'Green'
    if ($firewallMissing -and -not $Update) { Say $firewallText 'Yellow' }
    if ($Update) {
        # 5u. Report, then start the app again in the tray as sign-in does.
        Write-UpdateResult $resultPath $Version $true ((@('Updated to ' + $Version + '.') + @($notes)) -join ' ')
        Start-Process -FilePath $exe -ArgumentList @('--' + $Role, '--background') -WorkingDirectory $versionPath
        Say 'VTube Input Bridge was started again in the tray.' 'Green'
    } else {
        Say 'It starts in the tray at sign-in. Remote controls and reactives switch on once the two PCs are paired.'
        $done = 'VTube Input Bridge ' + $Version + ' is installed on the ' + $pcName + '.' + $nl + $nl + 'Click OK to open it. From now on it starts in the system tray when you sign in.'
        if ($firewallMissing) { $done += $nl + $nl + $firewallText }
        Show-Result $done $false

        # 5. Open the app only after the dialog, so nothing competes for focus. On the gaming PC it starts sending as
        #    the old app did. This window then closes by itself.
        if (-not (Get-Process VTubeControl -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $exe -ArgumentList ('--' + $Role) -WorkingDirectory $versionPath
        }
        Say 'VTube Input Bridge is open (check the system tray).' 'Green'
    }
} catch {
    $message = $_.Exception.Message
    if ($exitCode -eq 0) { $exitCode = 1 }
    Say ''
    if ($exitCode -eq 2) {
        Say $message 'Yellow'
    } else {
        Say ('Install failed: ' + $message) 'Red'
        Show-Result ('Install failed: ' + $message + [Environment]::NewLine + [Environment]::NewLine + 'The installer window stays open with the details. Take a screenshot of it, then close it with its X button.') $true
    }
    if ($Update) {
        Write-UpdateResult $resultPath $Version $false ('Update to ' + $Version + ' failed: ' + $message)
        Start-PreviousApp $previous $Role
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit $exitCode

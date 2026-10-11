[CmdletBinding()]
param(
    [string]$UserAppDataPath = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'VTubeControl'),
    [string]$UserLocalAppDataPath = (Join-Path $env:LOCALAPPDATA 'VTubeControl'),
    # The one-click installer runs this elevated in its own window, which closes at once; the outcome is written here so
    # the installer can show the actual reason.
    [string]$LogPath = ''
)
$ErrorActionPreference = 'Stop'
function Log([string]$Text) {
    Write-Output $Text
    if ($LogPath) { Add-Content -LiteralPath $LogPath -Value $Text -Encoding UTF8 }
}
try {
    $taskName = 'VTube Input Relay'
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) { throw "Scheduled task '$taskName' was not found. No changes were made." }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run only this migration script as administrator. The app itself stays installed and runs as the signed-in user.' }
    if (Get-Process -Name VTubeControl -ErrorAction SilentlyContinue) { throw 'Exit VTube Input Bridge from its tray before migrating the relay task.' }

    # The only thing taken from the old task is the Gaming PC address. Its executable path, account and other
    # arguments may differ between older installs; they are recorded in the exported XML, not required to match.
    $source = $null
    foreach ($action in @($task.Actions)) {
        if ([string]$action.Arguments -match '(?:^|\s)--source\s+(?:"(?<quoted>[^"]+)"|(?<plain>[^\s]+))') {
            $source = if ($Matches.quoted) { $Matches.quoted } else { $Matches.plain }
            break
        }
    }
    $ip = $null
    if (-not $source) { throw 'Could not read the Gaming PC address (--source) from the old relay task. No changes were made.' }
    if (-not [Net.IPAddress]::TryParse($source, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw "The old relay task's Gaming PC address '$source' is not an IPv4 address. No changes were made." }

    $settings = [IO.Path]::GetFullPath($UserAppDataPath)
    $localRoot = [IO.Path]::GetFullPath($UserLocalAppDataPath)
    if ((Split-Path $settings -Leaf) -ne 'VTubeControl' -or (Split-Path $localRoot -Leaf) -ne 'VTubeControl') { throw 'Expected the signed-in user VTubeControl data directories. No changes were made.' }
    $retired = Join-Path $localRoot ('retired\relay-migration-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $configPath = Join-Path $settings 'relay-config.json'
    New-Item -ItemType Directory -Force -Path $retired, $settings | Out-Null
    $xmlPath = Join-Path $retired 'VTube-Input-Relay.task.xml'
    $recordPath = Join-Path $retired 'migration.json'
    Set-Content -LiteralPath $xmlPath -Value (Export-ScheduledTask -TaskPath '\' -TaskName $taskName) -Encoding UTF8
    # A relay-config.json left by an earlier, interrupted attempt is kept in the retired folder and replaced.
    $previousConfig = $null
    if (Test-Path -LiteralPath $configPath) {
        $previousConfig = Join-Path $retired 'relay-config.previous.json'
        Copy-Item -LiteralPath $configPath -Destination $previousConfig -Force
    }
    $record = [ordered]@{schema=1;taskName=$taskName;taskPath=$task.TaskPath;source=$ip.ToString();taskXml=$xmlPath;configPath=$configPath;previousConfig=$previousConfig;created=(Get-Date).ToString('o')}
    $record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8

    # Stop the old relay: disable the task so it cannot restart it, stop it, then end any vts_input_relay still running
    # (it would hold UDP 5055). The task is re-enabled if the migration fails before it is removed.
    Disable-ScheduledTask -TaskPath '\' -TaskName $taskName | Out-Null
    $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
        } while ($task.State -eq 'Running' -and (Get-Date) -lt $deadline)
    }
    Get-Process vts_input_relay -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Process vts_input_relay -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (Get-Process vts_input_relay -ErrorAction SilentlyContinue) {
        Enable-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
        throw 'The old relay (vts_input_relay) would not stop. Nothing was removed; restart the PC and run the installer again.'
    }

    $temp = $configPath + '.new'
    # No byte-order mark: -Encoding UTF8 adds one in Windows PowerShell.
    [IO.File]::WriteAllText($temp, (@{source=$ip.ToString()} | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Move-Item -LiteralPath $temp -Destination $configPath -Force
    try {
        Unregister-ScheduledTask -TaskPath '\' -TaskName $taskName -Confirm:$false
    } catch {
        if ($previousConfig) { Copy-Item -LiteralPath $previousConfig -Destination $configPath -Force } else { Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue }
        Enable-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null
        throw ('Could not remove the old relay task: ' + $_.Exception.Message)
    }
    Log "OK Migration complete for Gaming PC $($ip.ToString()). Task XML and restore record: $recordPath"
    Log 'The old executable, token, status file, firewall rule, VTube Studio, and OBS were left unchanged.'
} catch {
    Log ('FAILED ' + $_.Exception.Message)
    exit 1
}

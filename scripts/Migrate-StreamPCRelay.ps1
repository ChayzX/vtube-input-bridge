[CmdletBinding()]
param(
    [string]$UserAppDataPath = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'VTubeControl'),
    [string]$UserLocalAppDataPath = (Join-Path $env:LOCALAPPDATA 'VTubeControl')
)
$ErrorActionPreference = 'Stop'
$taskName = 'VTube Input Relay'
$task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { throw "Scheduled task '$taskName' was not found. No changes were made." }
if ($task.Actions.Count -ne 1) { throw 'The relay task has an unexpected number of actions. No changes were made.' }
if ($task.Principal.UserId -notin @('SYSTEM','S-1-5-18')) { throw 'The relay task is not configured for SYSTEM. No changes were made.' }
$action = $task.Actions[0]
$expectedExe = Join-Path $env:ProgramData 'VTubeInputRelay\vts_input_relay.exe'
if ([IO.Path]::GetFullPath($action.Execute) -ne [IO.Path]::GetFullPath($expectedExe)) { throw 'The relay task points to an unexpected executable. No changes were made.' }
if ($action.Arguments -notmatch '(?:^|\s)--source\s+(?:"(?<quoted>[^" ]+)"|(?<plain>[^\s]+))') { throw 'Could not read the configured Gaming PC address from the task. No changes were made.' }
$source = if ($Matches.quoted) { $Matches.quoted } else { $Matches.plain }
$ip = $null
if (-not [Net.IPAddress]::TryParse($source, [ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'The task does not contain a valid Gaming PC IPv4 address. No changes were made.' }
$expectedToken = Join-Path $env:ProgramData 'VTubeInputRelay\vts-token.txt'
$expectedStatus = Join-Path $env:ProgramData 'VTubeInputRelay\status.json'
$expectedArguments = '--source ' + $ip.ToString() + ' --token-file "' + $expectedToken + '" --status-file "' + $expectedStatus + '"'
if ($action.Arguments -ne $expectedArguments) { throw 'The relay task arguments differ from the expected install. No changes were made.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run only this migration script as administrator. The app itself stays installed and runs as the signed-in user.' }
if (Get-Process -Name VTubeControl -ErrorAction SilentlyContinue) { throw 'Exit VTube Input Bridge from its tray before migrating the relay task.' }

$settings = [IO.Path]::GetFullPath($UserAppDataPath)
$localRoot = [IO.Path]::GetFullPath($UserLocalAppDataPath)
if ((Split-Path $settings -Leaf) -ne 'VTubeControl' -or (Split-Path $localRoot -Leaf) -ne 'VTubeControl') { throw 'Expected the signed-in user VTubeControl data directories. No changes were made.' }
$retired = Join-Path $localRoot ('retired\relay-migration-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$configPath = Join-Path $settings 'relay-config.json'
if (Test-Path -LiteralPath $configPath) { throw "Relay config already exists at '$configPath'. No changes were made." }
New-Item -ItemType Directory -Force -Path $retired, $settings | Out-Null
$xmlPath = Join-Path $retired 'VTube-Input-Relay.task.xml'
$recordPath = Join-Path $retired 'migration.json'
$xml = Export-ScheduledTask -TaskName $taskName
Set-Content -LiteralPath $xmlPath -Value $xml -Encoding UTF8
$record = [ordered]@{schema=1;taskName=$taskName;taskPath=$task.TaskPath;source=$ip.ToString();taskXml=$xmlPath;configPath=$configPath;created=(Get-Date).ToString('o')}
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $recordPath -Encoding UTF8
$temp = $configPath + '.new'
# No byte-order mark: -Encoding UTF8 adds one in Windows PowerShell and the app's JSON.parse rejects it.
[IO.File]::WriteAllText($temp, (@{source=$ip.ToString()} | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Move-Item -LiteralPath $temp -Destination $configPath
try {
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskPath '\' -TaskName $taskName
        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            $task = Get-ScheduledTask -TaskPath '\' -TaskName $taskName
        } while ($task.State -eq 'Running' -and (Get-Date) -lt $deadline)
        if ($task.State -eq 'Running') { throw 'The relay task did not stop. Task registration is preserved; do not launch the app yet.' }
    }
    if (Get-Process vts_input_relay -ErrorAction SilentlyContinue) { throw 'A relay process is still running after the task stop. Task registration is preserved; do not launch the app yet.' }
    Unregister-ScheduledTask -TaskPath '\' -TaskName $taskName -Confirm:$false
} catch {
    Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    throw
}
Write-Output "Migration complete for Gaming PC $($ip.ToString()). Task XML and restore record: $recordPath"
Write-Output 'The old executable, token, status file, firewall rule, VTube Studio, and OBS were left unchanged.'

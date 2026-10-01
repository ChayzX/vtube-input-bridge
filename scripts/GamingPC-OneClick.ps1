# Body of the one-click gaming PC updater. scripts/New-GamingPCInstaller.ps1 fills in the release values below and
# embeds this script, plus the base64 GamingPC ZIP, in a .cmd the streamer double-clicks. The .cmd sets VTB_SELF to
# its own path; this script reads the ZIP back out of that file, verifies it, and runs the package's own installer.
# Keep it Windows PowerShell 5.1 compatible, plain ASCII, and free of the percent sign (cmd.exe would expand it).
$ErrorActionPreference = 'Stop'
$Tag = '__VTB_TAG__'
$ZipName = '__VTB_ZIP__'
$Sha256 = '__VTB_SHA256__'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

$exitCode = 0
$work = Join-Path ([IO.Path]::GetTempPath()) ('vtubebridge-' + [Guid]::NewGuid().ToString('N'))
try {
    if ($Sha256 -notmatch '^[0-9a-f]{64}$') { throw 'This installer was not generated correctly (missing checksum).' }
    Say ('VTube Input Bridge gaming PC update: ' + $Tag) 'Cyan'
    $stateDir = Join-Path $env:LOCALAPPDATA 'VTubeInputBridge'
    $stateFile = Join-Path $stateDir 'installed-gaming.txt'
    if (Test-Path -LiteralPath $stateFile) { Say ('Previously installed: ' + (Get-Content -LiteralPath $stateFile -Raw).Trim()) }

    # 1. Unpack and verify the embedded package before touching anything on this PC.
    $self = [IO.File]::ReadAllText($env:VTB_SELF)
    $marker = '#VTB-' + 'PAYLOAD#'
    $at = $self.IndexOf($marker)
    if ($at -lt 0) { throw 'The embedded package is missing from this file. Download the installer again.' }
    $bytes = [Convert]::FromBase64String(($self.Substring($at + $marker.Length) -replace '[^A-Za-z0-9+/=]', ''))
    New-Item -ItemType Directory -Path $work | Out-Null
    $zip = Join-Path $work $ZipName
    [IO.File]::WriteAllBytes($zip, $bytes)
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower() -ne $Sha256) {
        throw 'The embedded package failed its checksum (the file was damaged or altered). Nothing was installed.'
    }
    $extract = Join-Path $work 'pkg'
    Expand-Archive -LiteralPath $zip -DestinationPath $extract
    $installer = Join-Path $extract 'Install-GamingPC.ps1'
    if (-not (Test-Path -LiteralPath $installer)) { throw 'Install-GamingPC.ps1 is missing from the package.' }
    Say 'Package verified.' 'Green'

    # 2. The old console sender must not run alongside the app (README step 5). Disable its logon task so it does not
    #    come back after a reboot; Enable-ScheduledTask undoes this.
    if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
        $legacyTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
            @($_.Actions | Where-Object { $_.Execute -like '*gaming_input_relay*' }).Count -gt 0 })
        foreach ($task in $legacyTasks) {
            try {
                Stop-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName -ErrorAction SilentlyContinue
                Disable-ScheduledTask -TaskPath $task.TaskPath -TaskName $task.TaskName | Out-Null
                Say ('Disabled old sender task: ' + $task.TaskPath + $task.TaskName)
            } catch {
                throw ('Could not disable the old sender task "' + $task.TaskPath + $task.TaskName + '". Right-click this file and choose Run as administrator, or disable it in Task Scheduler.')
            }
        }
    }
    $legacy = @(Get-Process gaming_input_relay -ErrorAction SilentlyContinue)
    if ($legacy.Count -gt 0) {
        $legacy | Stop-Process -Force
        $legacy | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
        Say 'Stopped the old console sender.'
    }

    # 3. Exit the running app. Closing its window only hides it to the tray, and its settings are saved as they
    #    change, so stopping the process loses nothing.
    $running = @(Get-Process VTubeInputBridge -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        $running | Stop-Process -Force
        $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
        Say 'Closed the running VTube Input Bridge app.'
    }

    # 4. Run the package's own installer: copies the app, registers sign-in start and shortcuts, and starts sending.
    & $installer
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    Set-Content -LiteralPath $stateFile -Value ($Tag + ' ' + $ZipName)
    Start-Sleep -Seconds 2
    if (-not (Get-Process VTubeInputBridge -ErrorAction SilentlyContinue)) {
        throw 'The app was installed but did not stay running. Open "VTube Input Bridge" from the Desktop shortcut.'
    }
    Say ''
    Say ('Updated to ' + $Tag + '. VTube Input Bridge is running (check the system tray).') 'Green'
} catch {
    Say ''
    Say ('Update failed: ' + $_.Exception.Message) 'Red'
    $exitCode = 1
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit $exitCode

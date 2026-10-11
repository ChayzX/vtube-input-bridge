<#
.SYNOPSIS
  Remove VTube Input Bridge from this PC for the signed-in user.
.DESCRIPTION
  Install-Control.ps1 copies this script to %LOCALAPPDATA%\VTubeControl with Uninstall-VTubeInputBridge.cmd beside it
  and registers both in Apps & features. It stops the app, then removes its shortcuts, sign-in entry, firewall rules
  (asking Windows for administrator approval only for that step, and only if there are any), the installed versions,
  the Stream Deck plugin and the Apps & features entry. It asks whether to delete settings and pairing too (default
  No). -Quiet or VTC_QUIET=1 asks nothing and keeps them; -DeleteSettings deletes them.
  It never touches OBS, VTube Studio, the old relay task or the separate tracking app. The retired folder (saved
  sign-in entries and the old relay task) is kept so the old setup can still be brought back.
  Keep it Windows PowerShell 5.1 compatible and plain ASCII.
  Exit codes: 0 removed, 1 something could not be removed (details printed), 2 cancelled.
#>
[CmdletBinding()]
param(
    [switch]$Quiet,
    [switch]$DeleteSettings
)
$ErrorActionPreference = 'Stop'
if ($env:VTC_QUIET -eq '1') { $Quiet = $true }
$installRoot = Join-Path $env:LOCALAPPDATA 'VTubeControl'
$roaming = [Environment]::GetFolderPath('ApplicationData')
if (-not $roaming) { $roaming = $env:APPDATA }
$settings = Join-Path $roaming 'VTubeControl'
$versions = Join-Path $installRoot 'versions'
$retired = Join-Path $installRoot 'retired'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VTubeInputBridge'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$pluginFolder = Join-Path $roaming 'Elgato\StreamDeck\Plugins\com.chayzx.vtubecontrol.sdPlugin'
$problems = New-Object System.Collections.ArrayList

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Problem([string]$text) { [void]$problems.Add($text); Say ('Warning: ' + $text) 'Yellow' }
# True when $Path is inside $Root (not $Root itself).
function Test-Inside([string]$Path, [string]$Root) {
    if (-not $Path -or -not $Root) { return $false }
    try { return [IO.Path]::GetFullPath($Path).StartsWith([IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) } catch { return $false }
}
# The exe a Run entry or shortcut command line starts: the quoted first token, or the text up to the first space.
function Get-CommandExe([string]$Command) {
    if (-not $Command) { return '' }
    if ($Command -match '^\s*"(?<exe>[^"]+)"') { return $Matches.exe }
    return ($Command.Trim() -split '\s+')[0]
}
function Show-Box([string]$Text, [string]$Buttons, [string]$Icon, [int]$DefaultButton) {
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
    try {
        $default = @([System.Windows.Forms.MessageBoxDefaultButton]::Button1, [System.Windows.Forms.MessageBoxDefaultButton]::Button2, [System.Windows.Forms.MessageBoxDefaultButton]::Button3)[$DefaultButton]
        return [string][System.Windows.Forms.MessageBox]::Show($owner, $Text, 'Uninstall VTube Input Bridge', $Buttons, $Icon, $default)
    } finally { $owner.Dispose() }
}

$exitCode = 0
try {
    Set-Location -LiteralPath ([IO.Path]::GetTempPath())
    [Environment]::CurrentDirectory = [IO.Path]::GetTempPath()
    $role = ''
    try { $role = ([IO.File]::ReadAllText((Join-Path $settings 'role.txt'))).Trim() } catch { }

    # 0. One question: remove, and whether to delete settings too. Yes / No / Cancel, No by default.
    if (-not $Quiet -and -not $DeleteSettings) {
        $nl = [Environment]::NewLine
        $answer = Show-Box ('VTube Input Bridge will be removed from this PC.' + $nl + $nl +
            'Also delete settings and pairing?' + $nl + $nl +
            'Yes: delete them too (you will have to pair the PCs again after a reinstall).' + $nl +
            'No: keep them for a later reinstall.' + $nl + 'Cancel: remove nothing.') 'YesNoCancel' 'Question' 1
        if ($answer -eq 'Cancel') { Say 'Cancelled. Nothing was removed.'; exit 2 }
        $DeleteSettings = ($answer -eq 'Yes')
    }
    Say 'Removing VTube Input Bridge...' 'Cyan'

    # 1. Stop the app and anything it started from its install folder (tracking helper, Streaming PC relay).
    $owned = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'VTubeControl' -or (Test-Inside $_.Path $versions) })
    if ($owned.Count -gt 0) {
        $owned | Stop-Process -Force -ErrorAction SilentlyContinue
        $owned | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
        Say 'Closed the app.'
    }

    # 2. Shortcuts and the sign-in entry, only where they still point at this app (a restored separate tracking app
    #    uses the same shortcut name and is left alone).
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('Programs'))) {
        if ([string]::IsNullOrWhiteSpace($folder)) { continue }
        $link = Join-Path $folder 'VTube Input Bridge.lnk'
        if ((Test-Path -LiteralPath $link) -and (Test-Inside ($shell.CreateShortcut($link).TargetPath) $versions)) {
            Remove-Item -LiteralPath $link -Force
            Say ('Removed shortcut: ' + $link)
        }
    }
    $run = Get-Item -Path $runKey -ErrorAction SilentlyContinue
    if ($run -and ($run.GetValueNames() -contains 'VTubeControl') -and (Test-Inside (Get-CommandExe ([string]$run.GetValue('VTubeControl'))) $versions)) {
        Remove-ItemProperty -Path $runKey -Name 'VTubeControl'
        Say 'Removed the app from sign-in.'
    }

    # 3. Firewall rules this app created. Reading them needs no approval; removing them does, so ask only if any exist.
    try {
        $rules = @()
        if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {
            $rules = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
                $_.Group -eq 'VTube Input Bridge' -or $_.Name -like 'VTubeInputBridge-*' -or $_.Name -like 'VTubeControl-*' })
            # Rules Windows made from its own prompt for the installed versions.
            $rules += @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like ($versions + '\*') } | Get-NetFirewallRule -ErrorAction SilentlyContinue)
            $rules = @($rules | Sort-Object Name -Unique)
        }
        if ($rules.Count -gt 0) {
            Say ('Windows will ask permission to remove ' + $rules.Count + ' VTube Input Bridge firewall rule(s).') 'Yellow'
            $names = ($rules | ForEach-Object { "'" + $_.Name.Replace("'", "''") + "'" }) -join ','
            $command = 'foreach ($n in @(' + $names + ')) { Remove-NetFirewallRule -Name $n -ErrorAction SilentlyContinue }'
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
            $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded)
            if ($process.ExitCode -ne 0) { throw ('exit code ' + $process.ExitCode) }
            Say 'Removed the firewall rules.'
        }
    } catch {
        Problem ('the firewall rules were not removed (' + $_.Exception.Message + '). Remove the "VTube Input Bridge" rules in Windows Defender Firewall > Advanced settings > Inbound Rules.')
    }

    # 4. Stream Deck plugin (the Gaming PC). Stream Deck keeps it loaded, so close Stream Deck, remove it, reopen it.
    if (Test-Path -LiteralPath $pluginFolder) {
        $deck = @(Get-Process StreamDeck -ErrorAction SilentlyContinue)
        $deckPath = @($deck | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique) | Select-Object -First 1
        if ($deck.Count -gt 0) {
            Say 'Closing Stream Deck to remove the VTube Input Bridge plugin...'
            foreach ($p in $deck) { try { [void]$p.CloseMainWindow() } catch { } }
            $deck | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
            Get-Process StreamDeck -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Get-Process StreamDeck -ErrorAction SilentlyContinue | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
        }
        try {
            Remove-Item -LiteralPath $pluginFolder -Recurse -Force
            Say 'Removed the Stream Deck plugin.'
        } catch {
            Problem ('the Stream Deck plugin could not be removed. Quit Stream Deck, delete ' + $pluginFolder + ', then start Stream Deck again.')
        }
        if ($deckPath -and (Test-Path -LiteralPath $deckPath)) { Start-Process -FilePath $deckPath -ErrorAction SilentlyContinue }
        elseif ($deck.Count -gt 0) { Say 'Start Stream Deck again.' 'Yellow' }
    }

    # 5. The installed app: versions, rollback records, the kept plugin copy, the uninstaller itself. retired\ stays.
    foreach ($name in @('versions', 'rollback', 'streamdeck')) {
        $path = Join-Path $installRoot $name
        if (Test-Path -LiteralPath $path) {
            try { Remove-Item -LiteralPath $path -Recurse -Force } catch {
                Start-Sleep -Seconds 2
                try { Remove-Item -LiteralPath $path -Recurse -Force } catch { Problem ('could not delete ' + $path + ' (' + $_.Exception.Message + '). Delete it after restarting Windows.') }
            }
        }
    }
    # On a Streaming PC the old relay task's saved copy stays in retired\, with the script that restores it.
    $relayRecord = $null
    if (Test-Path -LiteralPath $retired) {
        $relayRecord = Get-ChildItem -LiteralPath $retired -Filter 'migration.json' -Recurse -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName 'VTube-Input-Relay.task.xml') } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    $restoreScript = Join-Path $installRoot 'Restore-StreamPCRelay.ps1'
    if ($relayRecord -and (Test-Path -LiteralPath $restoreScript)) { Copy-Item -LiteralPath $restoreScript -Destination (Join-Path $retired 'Restore-StreamPCRelay.ps1') -Force }
    foreach ($name in @('Restore-StreamPCRelay.ps1', 'last-update.json')) {
        Remove-Item -LiteralPath (Join-Path $installRoot $name) -Force -ErrorAction SilentlyContinue
    }
    $uninstaller = @('Uninstall-VTubeInputBridge.ps1', 'Uninstall-VTubeInputBridge.cmd')

    # 6. Settings and pairing (only when asked). They hold the PC link credential, app settings and VTube Studio token.
    if ($DeleteSettings) {
        foreach ($path in @($settings) + @(Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'retired' -and $uninstaller -notcontains $_.Name } | Select-Object -ExpandProperty FullName)) {
            if ($path -and (Test-Path -LiteralPath $path)) {
                try { Remove-Item -LiteralPath $path -Recurse -Force } catch { Problem ('could not delete ' + $path + ' (' + $_.Exception.Message + ').') }
            }
        }
        Say 'Deleted settings and pairing.'
    } else {
        Say ('Kept settings and pairing in ' + $settings + ' for a later reinstall.')
    }

    # 7. Last, the uninstaller and its Apps & features entry, kept if anything failed so it can be run again.
    if ($problems.Count -eq 0) {
        foreach ($name in $uninstaller) { Remove-Item -LiteralPath (Join-Path $installRoot $name) -Force -ErrorAction SilentlyContinue }
        Remove-Item -Path $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
        if ((Test-Path -LiteralPath $installRoot) -and -not (Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue
        }
    }

    Say ''
    if ($problems.Count -eq 0) { Say 'VTube Input Bridge was removed.' 'Green' } else { Say 'VTube Input Bridge was removed, except for the items listed above.' 'Yellow'; $exitCode = 1 }
    if ($relayRecord) {
        Say 'The old VTube Input Relay task was not brought back. To use it again, run in an administrator PowerShell:' 'Yellow'
        Say ('  & "' + (Join-Path $retired 'Restore-StreamPCRelay.ps1') + '" -Record "' + $relayRecord.FullName + '"') 'Yellow'
    } elseif ($role -eq 'canada') {
        Say 'The Streaming PC now has no tracking receiver. Reinstall VTube Input Bridge, or set up the separate tracking app again.' 'Yellow'
    }
} catch {
    Say ''
    Say ('Uninstall failed: ' + $_.Exception.Message) 'Red'
    [void]$problems.Add($_.Exception.Message)
    $exitCode = 1
}

if (-not $Quiet) {
    $nl = [Environment]::NewLine
    $text = if ($exitCode -eq 0) { 'VTube Input Bridge was removed.' } else { 'Some parts could not be removed:' + $nl + $nl + ($problems -join $nl) }
    if ($relayRecord) { $text += $nl + $nl + 'The old VTube Input Relay task (Streaming PC) was not brought back. Restore-StreamPCRelay.ps1 in ' + $retired + ' can restore it; run it as administrator with -Record "' + $relayRecord.FullName + '".' }
    try { [void](Show-Box $text 'OK' $(if ($exitCode -eq 0) { 'Information' } else { 'Warning' }) 0) } catch { }
}
exit $exitCode

# Body of the one-click VTube Control installer for the gaming PC (Pantry). scripts/New-ControlInstaller.ps1 fills in
# the values below and builds a .cmd whose tail holds the raw pantry package ZIP followed by the Stream Deck plugin.
# The .cmd sets VTC_SELF to its own path. This script cuts both payloads off the end of that file, verifies them, runs
# the package's own Install-Control.ps1, and hands the plugin to Stream Deck. The tracking bridge is never touched.
# Keep it Windows PowerShell 5.1 compatible, plain ASCII, and free of the percent sign (cmd.exe would expand it).
$ErrorActionPreference = 'Stop'
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

$exitCode = 0
$work = Join-Path ([IO.Path]::GetTempPath()) ('vtubecontrol-' + [Guid]::NewGuid().ToString('N'))
try {
    if ($ZipSha256 -notmatch '^[0-9a-f]{64}$' -or $PluginSha256 -notmatch '^[0-9a-f]{64}$') { throw 'This installer was not generated correctly (missing checksum).' }
    Say ('VTube Control ' + $Version + ' for the gaming PC (Stream Deck controls and reactives)') 'Cyan'
    Say 'This adds a separate companion app. VTube Input Bridge tracking is not changed.'

    # 1. Cut the package and plugin off the end of this file and verify both before changing anything on this PC.
    $total = (Get-Item -LiteralPath $env:VTC_SELF).Length
    $zipOffset = $total - $ZipLength - $PluginLength
    if ($zipOffset -le 0) { throw 'The installer file is incomplete. Download it again.' }
    New-Item -ItemType Directory -Path $work | Out-Null
    $zip = Join-Path $work $ZipName
    $plugin = Join-Path $work $PluginName
    Say 'Checking the package...'
    Save-Range $env:VTC_SELF $zipOffset $ZipLength $zip
    Save-Range $env:VTC_SELF ($zipOffset + $ZipLength) $PluginLength $plugin
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower() -ne $ZipSha256 -or
        (Get-FileHash -Algorithm SHA256 -LiteralPath $plugin).Hash.ToLower() -ne $PluginSha256) {
        throw 'The package failed its checksum (the file was damaged or altered). Nothing was installed.'
    }
    Say 'Package verified.' 'Green'

    # 2. Install the companion with its own installer (per-file checksums, rollback record, no tracking changes).
    $installRoot = Join-Path $env:LOCALAPPDATA 'VTubeControl'
    $versionPath = Join-Path $installRoot ('versions\' + $Version)
    $exe = Join-Path $versionPath 'VTubeControl.exe'
    if (Test-Path -LiteralPath $exe) {
        Say ('VTube Control ' + $Version + ' is already installed; skipping the app install.')
    } else {
        # Closing its window only hides it to the tray. Its settings are written atomically when saved, so stopping
        # the process cannot leave them half-written.
        $running = @(Get-Process VTubeControl -ErrorAction SilentlyContinue)
        if ($running.Count -gt 0) {
            $running | Stop-Process -Force
            $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
            Say 'Closed the running VTube Control app.'
        }
        Say 'Unpacking (this can take a minute)...'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $extract = Join-Path $work 'pkg'
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)
        & (Join-Path $extract 'Install-Control.ps1') -Role pantry
    }

    # 3. Keep a copy of the plugin and let Stream Deck install it (it shows its own confirmation prompt).
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

    # 4. Open the companion so pairing can start. Controls stay disabled until they are enabled in the app.
    if (-not (Get-Process VTubeControl -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath $exe -ArgumentList '--pantry' -WorkingDirectory $versionPath
    }
    Say ''
    Say ('VTube Control ' + $Version + ' is installed and open (check the system tray).') 'Green'
    Say 'Next: pair it with the stream PC companion, then enable controls. See the setup guide you were sent.'
} catch {
    Say ''
    Say ('Install failed: ' + $_.Exception.Message) 'Red'
    $exitCode = 1
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
exit $exitCode

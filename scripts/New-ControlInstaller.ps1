<#
.SYNOPSIS
  Wrap the VTube Input Bridge app package and the Stream Deck plugin into one double-click installer for both PCs:
  build\Install-VTubeInputBridge.cmd.
.DESCRIPTION
  The package is about 200 MB (Electron), so it is appended to the .cmd as raw bytes rather than base64. The embedded
  script reads only the text header, cuts the payloads off the end of the file by their recorded lengths, verifies
  their SHA256, asks which PC this is (or reads it from VTC_ROLE or the existing install), and runs the package's own
  Install-Control.ps1. The plugin is installed on the Gaming PC only. See scripts/Control-OneClick.ps1 for the
  VTC_ROLE / VTC_QUIET / VTC_UPDATE contract and exit codes.
.EXAMPLE
  .\scripts\New-ControlInstaller.ps1
#>
param(
    [string]$ZipPath,
    [string]$PluginPath = 'build\com.chayzx.vtubecontrol.streamDeckPlugin',
    [string]$OutFile
)
$ErrorActionPreference = 'Stop'
function Resolve-Input([string]$path) { (Resolve-Path -LiteralPath $path).ProviderPath }
if (-not $OutFile) { $OutFile = 'build\Install-VTubeInputBridge.cmd' }
if (-not $ZipPath) {
    # VTubeControl-<version>.zip; older per-role packages (VTubeControl-pantry-..., -canada-...) are ignored.
    $found = @(Get-ChildItem -Path 'build' -Filter 'VTubeControl-*.zip' | Where-Object { $_.Name -match '^VTubeControl-\d' })
    if ($found.Count -ne 1) { throw 'Pass -ZipPath: expected exactly one build\VTubeControl-<version>.zip.' }
    $ZipPath = $found[0].FullName
}
$zipFull = Resolve-Input $ZipPath
$zipName = Split-Path $zipFull -Leaf
# One file for both PCs carries the plugin; the installer hands it to Stream Deck on the Gaming PC only.
$pluginFull = Resolve-Input $PluginPath
$pluginName = Split-Path $pluginFull -Leaf
foreach ($name in @($zipName, $pluginName)) { if ($name -notmatch '^[A-Za-z0-9._-]+$') { throw ('Unexpected file name: ' + $name) } }

# One package serves both PCs; read its version from the bundle manifest and check the scripts the installer runs.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipFull)
try {
    $entry = $archive.GetEntry('bundle.json')
    if (-not $entry) { throw ($zipName + ' has no bundle.json; is it a VTube Input Bridge package?') }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { $bundle = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    foreach ($script in @('Install-Control.ps1', 'Set-BridgeFirewall.ps1', 'Uninstall-VTubeInputBridge.ps1', 'Migrate-StreamPCRelay.ps1', 'Restore-StreamPCRelay.ps1')) {
        if (-not $archive.GetEntry($script)) { throw ($zipName + ' is missing ' + $script + '.') }
    }
} finally { $archive.Dispose() }
if ($bundle.role) { throw ($zipName + ' is an older ' + $bundle.role + '-only package; rebuild it with scripts/build-controls.mjs.') }
if ($bundle.version -notmatch '^\d+\.\d+\.\d+(-[a-z0-9.]+)?$') { throw ('Invalid bundle version: ' + $bundle.version) }

$zipLength = (Get-Item -LiteralPath $zipFull).Length
$pluginLength = (Get-Item -LiteralPath $pluginFull).Length
$body = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Control-OneClick.ps1') -Raw
$values = @{
    '__VTC_VERSION__' = $bundle.version; '__VTC_ZIP_NAME__' = $zipName; '__VTC_ZIP_LEN__' = [string]$zipLength
    '__VTC_ZIP_SHA__' = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipFull).Hash.ToLower()
    '__VTC_PLUGIN_NAME__' = $pluginName; '__VTC_PLUGIN_LEN__' = [string]$pluginLength
    '__VTC_PLUGIN_SHA__' = (Get-FileHash -Algorithm SHA256 -LiteralPath $pluginFull).Hash.ToLower()
}
foreach ($key in $values.Keys) { $body = $body.Replace($key, $values[$key]) }
if ($body -match '__VTC_') { throw 'Control-OneClick.ps1 has an unfilled placeholder.' }
if ($body.Contains('%') -or $body -match '[^\x00-\x7F]') { throw 'Control-OneClick.ps1 must be plain ASCII with no % (cmd.exe would expand it).' }

# cmd.exe runs the lines above "exit /b" and never reads further, so it never reaches the binary tail. The one-liner
# reads only the first 64 KB as text and runs what sits between the two markers (split so it cannot match itself).
$batch = @(
    '@echo off',
    'setlocal',
    'title VTube Input Bridge install',
    'set "VTC_SELF=%~f0"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::OpenRead($env:VTC_SELF); $n=[int][Math]::Min(65536,$f.Length); $buf=New-Object byte[] $n; $r=$f.Read($buf,0,$n); $f.Dispose(); $s=[Text.Encoding]::ASCII.GetString($buf,0,$r); $a=$s.IndexOf(''#VTC-''+''SCRIPT#''); $b=$s.IndexOf(''#VTC-''+''PAYLOAD#''); & ([ScriptBlock]::Create($s.Substring($a+12, $b-$a-12)))"',
    'set "VTC_RESULT=%ERRORLEVEL%"',
    # Success needs no key press: the script already confirmed it in a dialog (issue #6). On failure the window stays,
    # except for unattended runs (the in-app updater, scripted installs), where nobody could press a key.
    'if "%VTC_RESULT%"=="0" exit /b 0',
    'if "%VTC_UPDATE%"=="1" exit /b %VTC_RESULT%',
    'if "%VTC_QUIET%"=="1" exit /b %VTC_RESULT%',
    'echo.',
    'echo Something went wrong. Send a screenshot of this window to whoever sent you this file.',
    'echo When you are done, close this window with its X button.',
    'pause',
    'exit /b %VTC_RESULT%',
    '',
    '#VTC-SCRIPT#'
)
$header = (($batch + ($body -split "`r?`n") + @('#VTC-PAYLOAD#')) -join "`r`n") + "`r`n"
if ($header.Length -ge 65536) { throw 'The script header must stay under 64 KB.' }

$outFull = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile)
New-Item -ItemType Directory -Force -Path (Split-Path $outFull -Parent) | Out-Null
$out = [IO.File]::Create($outFull)
try {
    $bytes = [Text.Encoding]::ASCII.GetBytes($header)
    $out.Write($bytes, 0, $bytes.Length)
    foreach ($part in @($zipFull, $pluginFull)) {
        $in = [IO.File]::OpenRead($part)
        try { $in.CopyTo($out) } finally { $in.Dispose() }
    }
} finally { $out.Dispose() }
Write-Output ('Wrote ' + $OutFile + ' (VTube Input Bridge ' + $bundle.version + ' for both PCs: ' + $zipName + ' + ' + $pluginName + ')')

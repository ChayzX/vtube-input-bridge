<#
.SYNOPSIS
  Wrap the gaming PC (pantry) VTube Control package and Stream Deck plugin into one double-click .cmd.
.DESCRIPTION
  The package is about 200 MB (Electron), so it is appended to the .cmd as raw bytes rather than base64. The embedded
  script reads only the text header, cuts the payloads off the end of the file by their recorded lengths, verifies
  their SHA256, and runs the package's own Install-Control.ps1. See scripts/Control-OneClick.ps1.
.EXAMPLE
  .\scripts\New-ControlInstaller.ps1
#>
param(
    [string]$ZipPath,
    [string]$PluginPath = 'build\com.chayzx.vtubecontrol.streamDeckPlugin',
    [string]$OutFile = 'build\Install-VTubeControl-GamingPC.cmd'
)
$ErrorActionPreference = 'Stop'
function Resolve-Input([string]$path) { (Resolve-Path -LiteralPath $path).ProviderPath }
if (-not $ZipPath) {
    $found = @(Get-ChildItem -Path 'build' -Filter 'VTubeControl-pantry-*.zip')
    if ($found.Count -ne 1) { throw 'Pass -ZipPath: expected exactly one build\VTubeControl-pantry-*.zip.' }
    $ZipPath = $found[0].FullName
}
$zipFull = Resolve-Input $ZipPath
$pluginFull = Resolve-Input $PluginPath
$zipName = Split-Path $zipFull -Leaf
$pluginName = Split-Path $pluginFull -Leaf
foreach ($name in @($zipName, $pluginName)) { if ($name -notmatch '^[A-Za-z0-9._-]+$') { throw ('Unexpected file name: ' + $name) } }

# Only the pantry package belongs on the gaming PC; read its role and version from the bundle manifest.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipFull)
try {
    $entry = $archive.GetEntry('bundle.json')
    if (-not $entry) { throw ($zipName + ' has no bundle.json; is it a VTube Control package?') }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { $bundle = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
if ($bundle.role -ne 'pantry') { throw ($zipName + ' is the ' + $bundle.role + ' package; the gaming PC needs the pantry package.') }
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
    'title VTube Control install',
    'set "VTC_SELF=%~f0"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::OpenRead($env:VTC_SELF); $n=[int][Math]::Min(65536,$f.Length); $buf=New-Object byte[] $n; $r=$f.Read($buf,0,$n); $f.Dispose(); $s=[Text.Encoding]::ASCII.GetString($buf,0,$r); $a=$s.IndexOf(''#VTC-''+''SCRIPT#''); $b=$s.IndexOf(''#VTC-''+''PAYLOAD#''); & ([ScriptBlock]::Create($s.Substring($a+12, $b-$a-12)))"',
    'set "VTC_RESULT=%ERRORLEVEL%"',
    'echo.',
    'if not "%VTC_RESULT%"=="0" echo Something went wrong. Send a screenshot of this window to whoever sent you this file.',
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
Write-Output ('Wrote ' + $OutFile + ' (VTube Control ' + $bundle.version + ', ' + $zipName + ' + ' + $pluginName + ')')

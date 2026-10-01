<#
.SYNOPSIS
  Wrap a GamingPC release ZIP into one double-click .cmd updater for the streamer.
.DESCRIPTION
  The .cmd carries the ZIP inside it (base64) with its SHA256, so the gaming PC needs no GitHub token, download, or
  PowerShell commands. Double-clicking it verifies the package, retires the old console sender, exits the running
  app, and runs the package's Install-GamingPC.ps1. See scripts/GamingPC-OneClick.ps1 for what runs on the PC.
.EXAMPLE
  .\scripts\New-GamingPCInstaller.ps1 -Tag v0.1.0-game-mouse-preview.4
#>
param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$ZipPath = 'build\VTubeInputBridge-GamingPC.zip',
    [string]$SumsPath = 'build\SHA256SUMS.txt',
    [string]$OutFile = 'build\Update-VTubeInputBridge-GamingPC.cmd'
)
$ErrorActionPreference = 'Stop'
if ($Tag -notmatch '^[A-Za-z0-9._-]+$') { throw 'Tag may only contain letters, digits, dot, dash, and underscore.' }
$zipName = Split-Path $ZipPath -Leaf
if ($zipName -notmatch '^[A-Za-z0-9._-]+\.zip$') { throw ('Unexpected package name: ' + $zipName) }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash.ToLower()
if (Test-Path -LiteralPath $SumsPath) {
    $line = Get-Content -LiteralPath $SumsPath | Where-Object { $_ -match ('\s\*?' + [regex]::Escape($zipName) + '$') } | Select-Object -First 1
    if (-not $line) { throw ($SumsPath + ' has no entry for ' + $zipName) }
    if (($line -split '\s+')[0].ToLower() -ne $hash) { throw ($zipName + ' does not match ' + $SumsPath) }
} else { Write-Warning ($SumsPath + ' not found; embedding ' + $zipName + ' without cross-checking it.') }

$body = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'GamingPC-OneClick.ps1') -Raw
$body = $body.Replace('__VTB_TAG__', $Tag).Replace('__VTB_ZIP__', $zipName).Replace('__VTB_SHA256__', $hash)
if ($body.Contains('%') -or $body -match '[^\x00-\x7F]') { throw 'GamingPC-OneClick.ps1 must be plain ASCII with no % (cmd.exe would expand it).' }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $ZipPath).ProviderPath))
$wrapped = for ($i = 0; $i -lt $b64.Length; $i += 76) { $b64.Substring($i, [Math]::Min(76, $b64.Length - $i)) }

# cmd.exe runs the lines above "exit /b" and never reads further. The PowerShell one-liner reads this file, cuts out
# the text between the two markers, and runs it. Marker names are split in the one-liner so it cannot match itself.
$batch = @(
    '@echo off',
    'setlocal',
    'title VTube Input Bridge update',
    'set "VTB_SELF=%~f0"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:VTB_SELF); $a=$s.IndexOf(''#VTB-''+''SCRIPT#''); $b=$s.IndexOf(''#VTB-''+''PAYLOAD#''); & ([ScriptBlock]::Create($s.Substring($a+12, $b-$a-12)))"',
    'set "VTB_RESULT=%ERRORLEVEL%"',
    'echo.',
    'if not "%VTB_RESULT%"=="0" echo Something went wrong. Send a screenshot of this window to whoever sent you this file.',
    'pause',
    'exit /b %VTB_RESULT%',
    '',
    '#VTB-SCRIPT#'
)
$lines = $batch + ($body -split "`r?`n") + @('#VTB-PAYLOAD#') + $wrapped
$outDir = Split-Path $OutFile -Parent
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
# cmd.exe needs CRLF line endings and plain ASCII.
[IO.File]::WriteAllText($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile), (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
Write-Output ('Wrote ' + $OutFile + ' (' + $Tag + ', ' + $zipName + ', sha256 ' + $hash + ')')

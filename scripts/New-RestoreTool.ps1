<#
.SYNOPSIS
  Builds Restore-SeparateTracking.cmd: a double-click tool that puts the separate VTube Input Bridge tracking app back
  after a failed or unwanted update to the one-app version (see scripts/Restore-SeparateTracking.ps1).
.DESCRIPTION
  The .cmd runs the script and carries a released VTubeInputBridge.exe (base64, with its SHA256) as a last resort for
  PCs where no copy of the app is left.
.EXAMPLE
  .\scripts\New-RestoreTool.ps1 -ExePath build\GamingPC\VTubeInputBridge.exe -Version v0.1.0-game-mouse-preview.4
#>
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$OutFile = 'scripts\Restore-SeparateTracking.cmd'
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^[A-Za-z0-9._-]+$') { throw 'Version may only contain letters, digits, dot, dash, and underscore.' }
$exe = (Resolve-Path -LiteralPath $ExePath).ProviderPath
$body = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Restore-SeparateTracking.ps1') -Raw
$body = $body.Replace('__VTR_VERSION__', $Version).Replace('__VTR_EXE_SHA__', (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLower())
if ($body.Contains('%') -or $body -match '[^\x00-\x7F]') { throw 'Restore-SeparateTracking.ps1 must be plain ASCII with no % (cmd.exe would expand it).' }
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($exe))
$wrapped = for ($i = 0; $i -lt $b64.Length; $i += 76) { $b64.Substring($i, [Math]::Min(76, $b64.Length - $i)) }
# cmd.exe never reads past "exit /b". The one-liner runs the text between the markers (split so it cannot match itself).
$batch = @(
    '@echo off',
    'setlocal',
    'title VTube Input Bridge restore',
    'set "VTR_SELF=%~f0"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:VTR_SELF); $a=$s.IndexOf(''#VTR-''+''SCRIPT#''); $b=$s.IndexOf(''#VTR-''+''PAYLOAD#''); & ([ScriptBlock]::Create($s.Substring($a+12, $b-$a-12)))"',
    'set "VTR_RESULT=%ERRORLEVEL%"',
    'if "%VTR_RESULT%"=="0" exit /b 0',
    'echo.',
    'echo Something went wrong. Send a screenshot of this window to whoever sent you this file.',
    'echo When you are done, close this window with its X button.',
    'pause',
    'exit /b %VTR_RESULT%',
    '',
    '#VTR-SCRIPT#'
)
$lines = $batch + ($body -split "`r?`n") + @('#VTR-PAYLOAD#') + $wrapped
$out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutFile)
[IO.File]::WriteAllText($out, (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
Write-Output ('Wrote ' + $OutFile + ' (embeds VTubeInputBridge.exe ' + $Version + ')')

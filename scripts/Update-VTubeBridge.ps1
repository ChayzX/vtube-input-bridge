<#
.SYNOPSIS
  Pull the newest VTube Input Bridge release and install it on this PC.
.EXAMPLE
  # Gaming PC (Pantry), run as the signed-in gaming user:
  .\Update-VTubeBridge.ps1 -Role Gaming
.EXAMPLE
  # Stream PC (Canada), run in an administrator PowerShell:
  .\Update-VTubeBridge.ps1 -Role Stream -GamingPC 10.0.0.112
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet('Gaming', 'Stream')][string]$Role,
    [string]$GamingPC,
    [string]$Repo = 'ChayzX/vtube-input-bridge',
    [string]$ApiBase = 'https://api.github.com',
    [string]$Tag,
    [string]$Token,
    [switch]$StopApp,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if ($Role -eq 'Stream' -and -not $GamingPC) { throw 'Stream role requires -GamingPC <gaming PC IPv4 address>.' }

# The repo is private: use a read-only fine-grained token (-Token, or the VTUBE_BRIDGE_TOKEN / GITHUB_TOKEN environment variable).
if (-not $Token) { $Token = if ($env:VTUBE_BRIDGE_TOKEN) { $env:VTUBE_BRIDGE_TOKEN } else { $env:GITHUB_TOKEN } }
$headers = @{ 'User-Agent' = 'VTubeBridgeUpdater'; 'Accept' = 'application/vnd.github+json' }
if ($Token) { $headers['Authorization'] = 'Bearer ' + $Token }
$api = $ApiBase + '/repos/' + $Repo

# /releases/latest skips pre-releases, and every release so far is one, so pick the newest published release.
if ($Tag) { $release = Invoke-RestMethod -Headers $headers -Uri ($api + '/releases/tags/' + $Tag) }
else {
    # Assign before piping: Invoke-RestMethod emits the JSON array as one object, so piping the cmdlet
    # directly (or wrapping it in @()) would hand Where-Object a single array instead of the releases.
    try { $all = Invoke-RestMethod -Headers $headers -Uri ($api + '/releases?per_page=20') }
    catch { throw ('Could not list releases for ' + $Repo + ' (' + $_.Exception.Message + '). Check that VTUBE_BRIDGE_TOKEN is set in this window, unexpired, and has Contents: Read-only on this repository.') }
    $release = $all | Where-Object { -not $_.draft } | Sort-Object { [datetime]$_.published_at } -Descending | Select-Object -First 1
}
if (-not $release) { throw 'No published release was found.' }

$pattern = if ($Role -eq 'Gaming') { '*GamingPC*.zip' } else { '*StreamPC*.zip' }
$zipAsset = @($release.assets | Where-Object { $_.name -like $pattern }) | Select-Object -First 1
if (-not $zipAsset) { throw ('Release ' + $release.tag_name + ' has no ' + $pattern + ' package.') }
$sumsAsset = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' }) | Select-Object -First 1
if (-not $sumsAsset) { throw ('Release ' + $release.tag_name + ' has no SHA256SUMS.txt; refusing to install an unverified package.') }

$stateDir = Join-Path $env:LOCALAPPDATA 'VTubeInputBridge'
$stateFile = Join-Path $stateDir ('installed-' + $Role.ToLower() + '.txt')
$installed = if (Test-Path $stateFile) { (Get-Content $stateFile -Raw).Trim() } else { '' }
$wanted = $release.tag_name + ' ' + $zipAsset.name
if (-not $Force -and $installed -eq $wanted) { Write-Output ('Already up to date: ' + $wanted); return }

$work = Join-Path ([IO.Path]::GetTempPath()) ('vtubebridge-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $dl = @{ 'User-Agent' = $headers['User-Agent']; 'Accept' = 'application/octet-stream' }
    if ($headers['Authorization']) { $dl['Authorization'] = $headers['Authorization'] }
    $zip = Join-Path $work $zipAsset.name
    $sums = Join-Path $work 'SHA256SUMS.txt'
    Invoke-WebRequest -Headers $dl -Uri $zipAsset.url -OutFile $zip -UseBasicParsing
    Invoke-WebRequest -Headers $dl -Uri $sumsAsset.url -OutFile $sums -UseBasicParsing

    $line = Get-Content $sums | Where-Object { $_ -match ('\s\*?' + [regex]::Escape($zipAsset.name) + '$') } | Select-Object -First 1
    if (-not $line) { throw ('SHA256SUMS.txt has no entry for ' + $zipAsset.name) }
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
    if ($actual -ne $expected) { throw ('Checksum mismatch for ' + $zipAsset.name + '; nothing was installed.') }

    $extract = Join-Path $work 'pkg'
    Expand-Archive -LiteralPath $zip -DestinationPath $extract
    if ($Role -eq 'Gaming') {
        if ($StopApp) { Get-Process VTubeInputBridge -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1 }
        & (Join-Path $extract 'Install-GamingPC.ps1')
    } else {
        # The stream installer deliberately refuses to interrupt a running bridge; schedule an offline window.
        & (Join-Path $extract 'Install-StreamPC.ps1') -GamingPC $GamingPC
    }
    New-Item -ItemType Directory -Force $stateDir | Out-Null
    Set-Content -LiteralPath $stateFile -Value $wanted
    Write-Output ('Installed ' + $wanted)
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

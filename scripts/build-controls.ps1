param([switch]$SkipTests, [switch]$CiStorage)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Checked([scriptblock]$Work) { & $Work; if ($LASTEXITCODE -ne 0) { throw "Build command failed: $Work" } }
# Opted in by the ephemeral Linux CI job, never by ordinary local builds.
function Report-CiStorage([string]$Phase) {
    if (-not $CiStorage) { return }
    Write-Output "CI storage phase: $Phase"
    & df -h . $env:RUNNER_TEMP
    foreach ($path in @('.', $env:RUNNER_TEMP, $env:RUNNER_TOOL_CACHE, "$HOME/.cargo", "$HOME/.rustup")) {
        if ($path -and (Test-Path -LiteralPath $path)) { & du -sh -- $path }
    }
}
function Clear-CiCache([string]$Name) {
    if (-not $CiStorage) { return }
    # Fixed names under this job's temp directory, matching build.yml; no shared cache deletion.
    Remove-Item -LiteralPath (Join-Path $env:RUNNER_TEMP $Name) -Recurse -Force -ErrorAction SilentlyContinue
}
function Clear-CiIntermediates([string[]]$Paths) {
    if (-not $CiStorage) { return }
    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
}
if ($CiStorage -and (-not $IsLinux -or -not $env:RUNNER_TEMP -or $env:GITHUB_ACTIONS -ne 'true')) {
    throw '-CiStorage is reserved for the ephemeral Linux GitHub Actions job.'
}
Report-CiStorage 'tools installed'
# PowerShell is already installed in RUNNER_TEMP/pwsh; its downloaded NuGet packages are redundant.
Clear-CiCache 'vtube-nuget-cache'
Report-CiStorage 'PowerShell download cache removed'
Checked { npm ci --prefix control_app }
Checked { npm ci --prefix streamdeck_plugin }
Report-CiStorage 'npm dependencies installed'
Clear-CiCache 'vtube-npm-cache'
Report-CiStorage 'npm download cache removed'
if (-not $SkipTests) {
    Checked { node --test scripts/control-tests/Bundle.Tests.mjs }
    Checked { npm test --prefix control_app }
    Checked { npm test --prefix streamdeck_plugin }
    Checked { dotnet run --project media_helper/tests/SelectionTests.csproj }
}
Report-CiStorage 'dependency tests complete'
# The tracking plugin runs the gaming PC sender as a hidden helper; ship it inside the app.
Checked { dotnet build windows_app/VTubeInputBridge.csproj -c Release -o build/tracking-helper }
New-Item -ItemType Directory -Force control_app/tracking | Out-Null
Copy-Item build/tracking-helper/VTubeInputBridge.exe control_app/tracking/VTubeInputBridge.exe -Force
Clear-CiIntermediates @('build/tracking-helper', 'windows_app/bin', 'windows_app/obj')
Report-CiStorage 'tracking helper copied'
# The receiver is a Windows child process owned by the Canada app; ship it in the immutable app version.
Checked { cargo build --release --locked --target x86_64-pc-windows-gnu -p vts_input_relay }
New-Item -ItemType Directory -Force control_app/relay | Out-Null
Copy-Item target/x86_64-pc-windows-gnu/release/vts_input_relay.exe control_app/relay/vts_input_relay.exe -Force
foreach ($dll in @('libgcc_s_seh-1.dll','libwinpthread-1.dll','libstdc++-6.dll')) {
    $runtime = (& x86_64-w64-mingw32-gcc ("-print-file-name=$dll") | Select-Object -First 1).Trim()
    if (Test-Path -LiteralPath $runtime -PathType Leaf) { Copy-Item -LiteralPath $runtime -Destination control_app/relay -Force }
}
Report-CiStorage 'Windows receiver copied'
Clear-CiIntermediates @('target')
Report-CiStorage 'Rust intermediates removed'
Checked { dotnet publish media_helper/MediaHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o control_app/media }
Report-CiStorage 'media helper published'
Clear-CiIntermediates @('media_helper/bin', 'media_helper/obj', 'media_helper/tests/bin', 'media_helper/tests/obj')
Clear-CiCache 'vtube-nuget-cache'
Report-CiStorage 'dotnet intermediates and NuGet cache removed'
Checked { npm run build --prefix streamdeck_plugin }
if (-not $SkipTests) {
    Checked { streamdeck_plugin/node_modules/.bin/streamdeck validate streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin }
    Checked { pwsh -NoProfile -File scripts/control-tests/Installer.Tests.ps1 }
    Checked { pwsh -NoProfile -File scripts/control-tests/Rollback.Tests.ps1 }
}
Report-CiStorage 'before Electron packaging'
Checked { node scripts/build-controls.mjs }
Clear-CiCache 'vtube-electron-cache'
Report-CiStorage 'Electron bundle and ZIP complete'
Checked { streamdeck_plugin/node_modules/.bin/streamdeck pack streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin -o build }
# One installer for both PCs: it asks which PC it is on (or reads VTC_ROLE / the existing install).
Checked { pwsh -NoProfile -File scripts/New-ControlInstaller.ps1 }
Report-CiStorage 'installer and plugin complete'

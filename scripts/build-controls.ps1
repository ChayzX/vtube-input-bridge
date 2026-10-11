param([switch]$SkipTests)
$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Checked([scriptblock]$Work) { & $Work; if ($LASTEXITCODE -ne 0) { throw "Build command failed: $Work" } }
Checked { npm ci --prefix control_app }
Checked { npm ci --prefix streamdeck_plugin }
if (-not $SkipTests) {
    Checked { npm test --prefix control_app }
    Checked { npm test --prefix streamdeck_plugin }
    Checked { dotnet run --project media_helper/tests/SelectionTests.csproj }
}
# The tracking plugin runs the gaming PC sender as a hidden helper; ship it inside the app.
Checked { dotnet build windows_app/VTubeInputBridge.csproj -c Release -o build/tracking-helper }
New-Item -ItemType Directory -Force control_app/tracking | Out-Null
Copy-Item build/tracking-helper/VTubeInputBridge.exe control_app/tracking/VTubeInputBridge.exe -Force
# The receiver is a Windows child process owned by the Canada app; ship it in the immutable app version.
Checked { cargo build --release --locked --target x86_64-pc-windows-gnu -p vts_input_relay }
New-Item -ItemType Directory -Force control_app/relay | Out-Null
Copy-Item target/x86_64-pc-windows-gnu/release/vts_input_relay.exe control_app/relay/vts_input_relay.exe -Force
foreach ($dll in @('libgcc_s_seh-1.dll','libwinpthread-1.dll','libstdc++-6.dll')) {
    $runtime = (& x86_64-w64-mingw32-gcc ("-print-file-name=$dll") | Select-Object -First 1).Trim()
    if (Test-Path -LiteralPath $runtime -PathType Leaf) { Copy-Item -LiteralPath $runtime -Destination control_app/relay -Force }
}
Checked { dotnet publish media_helper/MediaHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o control_app/media }
Checked { npm run build --prefix streamdeck_plugin }
if (-not $SkipTests) {
    Checked { streamdeck_plugin/node_modules/.bin/streamdeck validate streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin }
    Checked { pwsh -NoProfile -File scripts/control-tests/Installer.Tests.ps1 }
    Checked { pwsh -NoProfile -File scripts/control-tests/Rollback.Tests.ps1 }
}
Checked { node scripts/build-controls.mjs }
Checked { streamdeck_plugin/node_modules/.bin/streamdeck pack streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin -o build }
# One installer for both PCs: it asks which PC it is on (or reads VTC_ROLE / the existing install).
Checked { pwsh -NoProfile -File scripts/New-ControlInstaller.ps1 }

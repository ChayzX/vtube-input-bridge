$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Checked([scriptblock]$Work) { & $Work; if ($LASTEXITCODE -ne 0) { throw "Build command failed: $Work" } }
Checked { npm ci --prefix control_app }
Checked { npm ci --prefix streamdeck_plugin }
Checked { npm test --prefix control_app }
Checked { npm test --prefix streamdeck_plugin }
Checked { dotnet run --project media_helper/tests/SelectionTests.csproj }
Checked { dotnet publish media_helper/MediaHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o control_app/media }
Checked { npm run build --prefix streamdeck_plugin }
Checked { streamdeck_plugin/node_modules/.bin/streamdeck validate streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin }
Checked { pwsh -NoProfile -File scripts/control-tests/Installer.Tests.ps1 }
Checked { pwsh -NoProfile -File scripts/control-tests/Rollback.Tests.ps1 }
Checked { node scripts/build-controls.mjs }
Checked { streamdeck_plugin/node_modules/.bin/streamdeck pack streamdeck_plugin/com.chayzx.vtubecontrol.sdPlugin -o build }
Checked { pwsh -NoProfile -File scripts/New-ControlInstaller.ps1 }

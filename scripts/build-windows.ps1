param([switch]$SkipReceiver)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'The .NET Framework C# compiler is required.' }
New-Item -ItemType Directory -Force build | Out-Null
$common = @('windows_app/BridgeCore.cs', 'windows_app/SenderRuntime.cs', 'windows_app/MouseMotion.cs')
foreach ($suite in @('BridgeCore', 'SenderRuntime', 'MouseMotion')) {
    & $csc /nologo /nowarn:0649 /r:System.Web.Extensions.dll "/out:build/${suite}Tests.exe" @common "windows_app/${suite}Tests.cs"
    if ($LASTEXITCODE -ne 0) { throw ($suite + ' test compilation failed.') }
    & ".\build\${suite}Tests.exe"
    if ($LASTEXITCODE -ne 0) { throw ($suite + ' tests failed.') }
}
& $csc /nologo /nowarn:0649 /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:build/RawMouseInputTests.exe @common windows_app/RawMouseInput.cs windows_app/RawMouseInputTests.cs
if ($LASTEXITCODE -ne 0) { throw 'Raw mouse test compilation failed.' }
& .\build\RawMouseInputTests.exe
if ($LASTEXITCODE -ne 0) { throw 'Raw mouse registration test failed.' }
& $csc /nologo /target:winexe /win32icon:windows_app/bridge.ico /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:build/VTubeInputBridge.exe @common windows_app/RawMouseInput.cs windows_app/WindowsInputCapture.cs windows_app/BridgeApp.cs
if ($LASTEXITCODE -ne 0) { throw 'App compilation failed.' }
$gaming = 'build\GamingPC'
New-Item -ItemType Directory -Force $gaming | Out-Null
Copy-Item build\VTubeInputBridge.exe, windows_app\Install-GamingPC.ps1, windows_app\README.txt $gaming -Force
Compress-Archive "$gaming\*" build\VTubeInputBridge-GamingPC.zip -Force
if (-not $SkipReceiver) {
    & cargo test --workspace --locked
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }
    & cargo build --release --locked -p vts_input_relay
    if ($LASTEXITCODE -ne 0) { throw 'Receiver build failed.' }
    $stream = 'build\StreamPC'
    New-Item -ItemType Directory -Force $stream | Out-Null
    Copy-Item build\VTubeInputBridge.exe, target\release\vts_input_relay.exe, windows_app\Install-StreamPC.ps1 $stream -Force
    Copy-Item docs\StreamPC-Setup.txt "$stream\README.txt" -Force
    Compress-Archive "$stream\*" build\VTubeInputBridge-StreamPC.zip -Force
}
$sums = Get-ChildItem build\VTubeInputBridge-*.zip | ForEach-Object { (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower() + '  ' + $_.Name }
Set-Content -Path build\SHA256SUMS.txt -Value $sums
Write-Output 'Build complete. Packages are in build\; SHA256SUMS.txt lists each ZIP; attach it to the release for Update-VTubeBridge.ps1. Nothing was installed.'

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
for suite in BridgeCore SenderRuntime MouseMotion; do
  mcs -nowarn:0649 -r:System.Web.Extensions.dll -out:"build/${suite}Tests.exe" \
    windows_app/BridgeCore.cs windows_app/SenderRuntime.cs windows_app/MouseMotion.cs "windows_app/${suite}Tests.cs"
  mono "build/${suite}Tests.exe"
done
mcs -nowarn:0649 -r:System.Web.Extensions.dll -r:System.Windows.Forms.dll -r:System.Drawing.dll \
  -out:build/HeadlessSenderTests.exe windows_app/BridgeCore.cs windows_app/SenderRuntime.cs windows_app/MouseMotion.cs \
  windows_app/SenderSettings.cs windows_app/RawMouseInput.cs windows_app/WindowsInputCapture.cs \
  windows_app/HeadlessSender.cs windows_app/HeadlessSenderTests.cs
mono build/HeadlessSenderTests.exe
mcs -target:winexe -win32icon:windows_app/bridge.ico \
  -r:System.Web.Extensions.dll -r:System.Windows.Forms.dll -r:System.Drawing.dll \
  -out:build/VTubeInputBridge.exe windows_app/BridgeCore.cs windows_app/SenderRuntime.cs \
  windows_app/MouseMotion.cs windows_app/SenderSettings.cs windows_app/RawMouseInput.cs windows_app/WindowsInputCapture.cs \
  windows_app/HeadlessSender.cs windows_app/BridgeApp.cs

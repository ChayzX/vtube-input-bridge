<#
.SYNOPSIS
  Let the other PC reach VTube Input Bridge, so Windows never asks: inbound allow rules on private networks, from the
  local subnet only, for each program of this app version that receives from the network.
.DESCRIPTION
  Both PCs: the app (VTubeControl.exe) for the PC link (TCP 5056) and pairing/discovery (TCP and UDP 5059).
  Gaming PC: the tracking helper (tracking\VTubeInputBridge.exe), whose UDP socket receives the Streaming PC's
  acknowledgements. Streaming PC: the relay (relay\vts_input_relay.exe) on UDP 5055, the tracking input.
  Program paths include the version folder, so every install and update replaces the rules. Every earlier VTube Input
  Bridge / VTube Control rule goes too, including the old ones that allowed one fixed peer address and broke when the
  other PC's address changed. The old relay's own rule (VTube Input Relay LAN) is left alone: Restore-StreamPCRelay.ps1
  needs it. Needs an elevated PowerShell, except with -PlanOnly. The one-click installer runs it elevated in its own
  window, so the outcome is also written to -LogPath. Keep it Windows PowerShell 5.1 compatible and plain ASCII.
.EXAMPLE
  .\Set-BridgeFirewall.ps1 -VersionPath "$env:LOCALAPPDATA\VTubeControl\versions\1.0.0-rc.1" -Role canada
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$VersionPath,
    [Parameter(Mandatory = $true)][ValidateSet('pantry','canada')][string]$Role,
    [string]$LogPath = '',
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$group = 'VTube Input Bridge'
$app = Join-Path $VersionPath 'VTubeControl.exe'
$rules = @(
    [pscustomobject]@{ Name = 'VTubeInputBridge-Link-TCP-5056'; DisplayName = 'VTube Input Bridge (PC link)'; Protocol = 'TCP'; LocalPort = '5056'; Program = $app },
    [pscustomobject]@{ Name = 'VTubeInputBridge-Pairing-TCP-5059'; DisplayName = 'VTube Input Bridge (pairing)'; Protocol = 'TCP'; LocalPort = '5059'; Program = $app },
    [pscustomobject]@{ Name = 'VTubeInputBridge-Pairing-UDP-5059'; DisplayName = 'VTube Input Bridge (pairing)'; Protocol = 'UDP'; LocalPort = '5059'; Program = $app }
)
if ($Role -eq 'canada') {
    $rules += [pscustomobject]@{ Name = 'VTubeInputBridge-Tracking-UDP-5055'; DisplayName = 'VTube Input Bridge (tracking receiver)'; Protocol = 'UDP'; LocalPort = '5055'; Program = (Join-Path $VersionPath 'relay\vts_input_relay.exe') }
} else {
    $rules += [pscustomobject]@{ Name = 'VTubeInputBridge-Tracking-UDP'; DisplayName = 'VTube Input Bridge (tracking sender)'; Protocol = 'UDP'; LocalPort = 'Any'; Program = (Join-Path $VersionPath 'tracking\VTubeInputBridge.exe') }
}
foreach ($rule in $rules) {
    Add-Member -InputObject $rule -NotePropertyMembers ([ordered]@{ Group = $group; Direction = 'Inbound'; Action = 'Allow'; Profile = 'Private'; RemoteAddress = 'LocalSubnet' })
}
if ($PlanOnly) { return $rules }

function Log([string]$Text) {
    Write-Output $Text
    if ($LogPath) { Add-Content -LiteralPath $LogPath -Value $Text -Encoding UTF8 }
}
try {
    if (-not [IO.Path]::IsPathRooted($VersionPath) -or (Split-Path (Split-Path $VersionPath -Parent) -Leaf) -ne 'versions') { throw ('Unexpected version folder: ' + $VersionPath) }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Firewall rules need an elevated PowerShell.' }
    # Earlier rules: this group (0.3 previews), Install-Control's VTubeControl-<id> rules and their "VTube Control ..."
    # display names (fixed peer address), and any rule this script made before.
    $old = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
        $_.Group -eq $group -or $_.Name -like 'VTubeControl-*' -or $_.Name -like 'VTubeInputBridge-*' -or $_.DisplayName -like 'VTube Control *' })
    # Rules Windows made from its own prompt for any installed version (an answered "Block" would override ours).
    $versionsRoot = (Split-Path $VersionPath -Parent).TrimEnd('\') + '\*'
    $old += @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like $versionsRoot } | Get-NetFirewallRule -ErrorAction SilentlyContinue)
    $old = @($old | Sort-Object Name -Unique)
    foreach ($rule in $old) { Remove-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue }
    foreach ($rule in $rules) {
        New-NetFirewallRule -Name $rule.Name -DisplayName $rule.DisplayName -Group $rule.Group -Direction $rule.Direction -Action $rule.Action `
            -Protocol $rule.Protocol -LocalPort $rule.LocalPort -RemoteAddress $rule.RemoteAddress -Program $rule.Program -Profile $rule.Profile | Out-Null
    }
    Log ('OK ' + $rules.Count + ' firewall rules set for ' + $VersionPath + ' (replaced ' + $old.Count + ' older rule(s)).')
} catch {
    Log ('FAILED ' + $_.Exception.Message)
    exit 1
}

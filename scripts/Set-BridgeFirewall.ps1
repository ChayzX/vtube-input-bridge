<#
.SYNOPSIS
  Let the other PC reach VTube Input Bridge, so Windows never asks: inbound allow rules by port, on private networks,
  from the local subnet only.
.DESCRIPTION
  Both PCs: TCP 5056 (PC link), TCP and UDP 5059 (pairing/discovery). Streaming PC also: UDP 5055 (tracking input to
  the relay). The Gaming PC's tracking sender needs no rule: the acknowledgements are replies to its own UDP packets.
  The rules name no program, so they do not depend on the version folder: installs and in-app updates leave them as
  they are, and the installer runs this only when they are missing or differ (see Test-BridgeFirewall in
  Control-OneClick.ps1). It replaces every earlier rule this app made: this group, Install-Control's VTubeControl-<id>
  and "VTube Control ..." rules (one fixed peer address), and rules Windows made from its own prompt for programs under
  -VersionsRoot (an answered "Block" there would override these). The old relay's own rule (VTube Input Relay LAN) is
  left alone: Restore-StreamPCRelay.ps1 needs it.
  Needs an elevated PowerShell, except with -PlanOnly. The one-click installer runs it elevated in its own window, so
  the outcome is also written to -LogPath. Keep it Windows PowerShell 5.1 compatible and plain ASCII.
.EXAMPLE
  .\Set-BridgeFirewall.ps1 -Role canada -VersionsRoot "$env:LOCALAPPDATA\VTubeControl\versions"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('pantry','canada')][string]$Role,
    # The signed-in user's install folder, passed in because an elevated window may run as another account.
    [string]$VersionsRoot = '',
    [string]$LogPath = '',
    [switch]$PlanOnly
)
$ErrorActionPreference = 'Stop'
$group = 'VTube Input Bridge'
$rules = @(
    [pscustomobject]@{ Name = 'VTubeInputBridge-Link-TCP-5056'; DisplayName = 'VTube Input Bridge (PC link)'; Protocol = 'TCP'; LocalPort = '5056' },
    [pscustomobject]@{ Name = 'VTubeInputBridge-Pairing-TCP-5059'; DisplayName = 'VTube Input Bridge (pairing)'; Protocol = 'TCP'; LocalPort = '5059' },
    [pscustomobject]@{ Name = 'VTubeInputBridge-Pairing-UDP-5059'; DisplayName = 'VTube Input Bridge (pairing)'; Protocol = 'UDP'; LocalPort = '5059' }
)
if ($Role -eq 'canada') {
    $rules += [pscustomobject]@{ Name = 'VTubeInputBridge-Tracking-UDP-5055'; DisplayName = 'VTube Input Bridge (tracking)'; Protocol = 'UDP'; LocalPort = '5055' }
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
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Firewall rules need an elevated PowerShell.' }
    $old = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
        $_.Group -eq $group -or $_.Name -like 'VTubeControl-*' -or $_.Name -like 'VTubeInputBridge-*' -or $_.DisplayName -like 'VTube Control *' })
    if ($VersionsRoot) {
        $pattern = $VersionsRoot.TrimEnd('\') + '\*'
        $old += @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -like $pattern } | Get-NetFirewallRule -ErrorAction SilentlyContinue)
    }
    $old = @($old | Sort-Object Name -Unique)
    foreach ($rule in $old) { Remove-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue }
    foreach ($rule in $rules) {
        New-NetFirewallRule -Name $rule.Name -DisplayName $rule.DisplayName -Group $rule.Group -Direction $rule.Direction -Action $rule.Action `
            -Protocol $rule.Protocol -LocalPort $rule.LocalPort -RemoteAddress $rule.RemoteAddress -Profile $rule.Profile | Out-Null
    }
    Log ('OK ' + $rules.Count + ' firewall rules set (replaced ' + $old.Count + ' older rule(s)).')
} catch {
    Log ('FAILED ' + $_.Exception.Message)
    exit 1
}

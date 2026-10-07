[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Record)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run only this restore script as administrator.' }
if (Get-Process -Name VTubeControl -ErrorAction SilentlyContinue) { throw 'Exit VTube Input Bridge from its tray before restoring the old relay task.' }
$record = Get-Content -LiteralPath $Record -Raw | ConvertFrom-Json
$expectedXml = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($Record))) 'VTube-Input-Relay.task.xml'
if ($record.schema -ne 1 -or $record.taskName -ne 'VTube Input Relay' -or $record.taskPath -ne '\' -or [IO.Path]::GetFullPath($record.taskXml) -ne [IO.Path]::GetFullPath($expectedXml) -or -not (Test-Path -LiteralPath $expectedXml)) { throw 'The migration record is invalid or its saved task XML is missing.' }
$sourceIp = $null
if (-not [Net.IPAddress]::TryParse([string]$record.source,[ref]$sourceIp) -or $sourceIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'The saved Pantry address is invalid.' }
if (Get-ScheduledTask -TaskPath '\' -TaskName $record.taskName -ErrorAction SilentlyContinue) { throw "Task '$($record.taskName)' already exists. No changes were made." }
$xml = Get-Content -LiteralPath $record.taskXml -Raw
$taskXml = [xml]$xml
$commands = $taskXml.SelectNodes('//*[local-name()="Command"]')
$command = if ($commands.Count -eq 1) { $commands[0] } else { $null }
$arguments = $taskXml.SelectSingleNode('//*[local-name()="Arguments"]')
$principalId = $taskXml.SelectSingleNode('//*[local-name()="Principal"]/*[local-name()="UserId"]')
$expectedExe = Join-Path $env:ProgramData 'VTubeInputRelay\vts_input_relay.exe'
$expectedToken = Join-Path $env:ProgramData 'VTubeInputRelay\vts-token.txt'
$expectedStatus = Join-Path $env:ProgramData 'VTubeInputRelay\status.json'
$expectedArguments = '--source ' + $sourceIp.ToString() + ' --token-file "' + $expectedToken + '" --status-file "' + $expectedStatus + '"'
if (-not $command -or [IO.Path]::GetFullPath($command.InnerText) -ne [IO.Path]::GetFullPath($expectedExe) -or -not $arguments -or $arguments.InnerText -ne $expectedArguments -or -not $principalId -or $principalId.InnerText -notin @('SYSTEM','S-1-5-18')) { throw 'Saved task XML does not match the expected VTube Input Relay task.' }
Register-ScheduledTask -TaskName $record.taskName -TaskPath '\' -Xml $xml | Out-Null
Start-ScheduledTask -TaskPath '\' -TaskName $record.taskName
Write-Output "Restored and started '$($record.taskName)' from $($record.taskXml)."
Write-Output 'The VTube Input Bridge app must remain exited while the legacy task is running.'

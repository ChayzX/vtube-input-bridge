$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('vtube-installer-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root 'app') -Force | Out-Null
try {
 $file=Join-Path $root 'app/VTubeControl.exe';Set-Content -LiteralPath $file -Value 'fixture-binary'
 $manifest=@{version='0.2.0-preview.1';role='pantry';files=@(@{path='VTubeControl.exe';sha256=(Get-FileHash $file).Hash})}
 $manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'bundle.json')
 $installer=Join-Path $PSScriptRoot '../Install-Control.ps1'
 $plan=& $installer -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly
 if ($plan.Role -ne 'pantry' -or $plan.TrackingChanges -or (Test-Path (Join-Path $root 'target'))) {throw 'Dry run changed files or tracking'}
 Set-Content -LiteralPath $file -Value 'tampered-binary'
 $rejected=$false;try{& $installer -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly | Out-Null}catch{$rejected=$_.Exception.Message -like '*checksum mismatch*'}
 if(-not $rejected){throw 'Tampered payload accepted'}
 $manifest.files[0].path='../outside.exe';$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'bundle.json')
 $rejected=$false;try{& $installer -PackagePath $root -InstallRoot (Join-Path $root 'target') -PlanOnly | Out-Null}catch{$rejected=$_.Exception.Message -like '*Unsafe bundle path*'}
 if(-not $rejected){throw 'Traversal path accepted'}
 Write-Host 'Installer dry-run, tamper rejection, traversal rejection: PASS'
} finally {Remove-Item -LiteralPath $root -Recurse -Force}

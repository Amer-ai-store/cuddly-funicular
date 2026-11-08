#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference='Stop'
$dir=Join-Path $env:ProgramData 'AmanAccessMonitor'
$script=Join-Path $dir 'Aman-Collect.ps1'
if(!(Test-Path $script) -or !(Test-Path (Join-Path $dir 'collector.dpapi'))){throw 'Initialize and copy the reviewed collector before installing'}
# Installation is deliberately gated on working storage; never claim a live source otherwise.
$health=Invoke-RestMethod -Uri 'https://zvedrouuboxgbanzdnio.supabase.co/functions/v1/aman-access-monitor/api/health' -TimeoutSec 10 -MaximumRedirection 0
if($health.database_available -ne $true){throw 'Monitoring database is unavailable; task not installed'}
if(Get-ScheduledTask -TaskName AmanAccessMonitor -ErrorAction SilentlyContinue){throw 'Task already exists; review it before replacement'}
$exe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# Prove authenticated ingestion before creating a persistent task.
& $exe -NoProfile -NonInteractive -File $script -Once | Out-Null
if($LASTEXITCODE -ne 0){throw 'Collector did not acknowledge ingestion; task not installed'}
$action=New-ScheduledTaskAction -Execute $exe -Argument ('-NoProfile -NonInteractive -File "'+$script+'"')
$startup=New-ScheduledTaskTrigger -AtStartup
$repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName AmanAccessMonitor -Action $action -Trigger @($startup,$repeat) -Settings $settings -Principal $principal -Description 'Outbound-only Aman Security log collector; no database or firewall changes' | Out-Null
Start-ScheduledTask -TaskName AmanAccessMonitor
Write-Output 'AmanAccessMonitor installed; ingestion still needs a verified device key.'

#Requires -Version 5.1
param([switch]$Once,[switch]$SelfTest,[ValidateRange(0,60)][int]$BackfillMinutes=0,[switch]$IncludeProcess)
$ErrorActionPreference='Stop'
function Convert-AmanEvent([xml]$Xml,[double]$Offset,[string]$Source){
  $fields=@{}
  foreach($node in $Xml.Event.EventData.Data){$fields[[string]$node.Name]=[string]$node.InnerText}
  $code=[int]$Xml.Event.System.EventID
  $raw=[DateTimeOffset]::Parse([string]$Xml.Event.System.TimeCreated.SystemTime,[Globalization.CultureInfo]::InvariantCulture)
  $record=[string]$Xml.Event.System.EventRecordID
  $type=switch($code){4624{'login_success'}4625{'login_failed'}4634{'logout'}4647{'logout'}4688{'process'}default{return $null}}
  $prefix=if($code -in @(4647,4688)){'Subject'}else{'Target'}
  $name=$fields[$prefix+'UserName'];$domain=$fields[$prefix+'DomainName']
  $actor=if($name -and $name -ne '-') {if($domain -and $domain -ne '-'){$domain+'\'+$name}else{$name}}else{$null}
  if($actor -and $actor.Length -gt 128){$actor=$actor.Substring(0,128)}
  $session=$fields[$prefix+'LogonId']
  if($code -eq 4625 -or !$session -or $session -in @('-','0x0','0')){$session=$null}else{$session=$session.ToLowerInvariant()}
  $ip=$fields['IpAddress'];$parsed=$null
  if(!$ip -or ![Net.IPAddress]::TryParse($ip,[ref]$parsed)){$ip=$null}else{$ip=$parsed.ToString()}
  $action='Windows Security '+$code
  if($fields['LogonType']){$action+='; logon type '+$fields['LogonType']}
  if($code -eq 4688 -and $fields['NewProcessName']){$action+='; process '+$fields['NewProcessName']}
  if($action.Length -gt 500){$action=$action.Substring(0,500)}
  return @{id=('win-'+$record+'-'+$raw.UtcTicks.ToString('x')+'-'+$code);source_id=$Source;session_id=$session;type=$type;actor=$actor;ip=$ip;action=$action;occurred_at=$raw.AddSeconds($Offset).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');metadata=@{service='windows-security';source_occurred_at=$raw.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');clock_offset_seconds=[Math]::Round($Offset,3);source_record_id=$record}}
}
if($SelfTest){
  $xml=[xml]'<Event><System><EventID>4624</EventID><TimeCreated SystemTime="2026-10-30T12:00:00.000Z"/><EventRecordID>123</EventRecordID></System><EventData><Data Name="TargetUserName">synthetic</Data><Data Name="TargetDomainName">TEST</Data><Data Name="TargetLogonId">0xabc</Data><Data Name="IpAddress">192.0.2.10</Data><Data Name="LogonType">10</Data></EventData></Event>'
  $record=Convert-AmanEvent $xml -3600 'synthetic-server'
  if($record.type -ne 'login_success' -or $record.session_id -ne '0xabc' -or $record.occurred_at -ne '2026-10-30T11:00:00.000Z' -or $record.metadata.source_occurred_at -ne '2026-10-30T12:00:00.000Z'){throw 'Synthetic parser test failed'}
  [pscustomobject]@{self_test='passed';synthetic=$true;real_logs_read=$false} | ConvertTo-Json -Compress
  exit 0
}
$dir=Join-Path $env:ProgramData 'AmanAccessMonitor'
if(!(Test-Path $dir) -or ((Get-Item $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Initialize the protected directory first'}
$config=Get-Content -LiteralPath (Join-Path $dir 'config.json') -Raw | ConvertFrom-Json
$base=[string]$config.base_url
if($base -ne 'https://zvedrouuboxgbanzdnio.supabase.co/functions/v1/aman-access-monitor' -or $config.source_id -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'){throw 'Invalid collector configuration'}
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$tokenPath=Join-Path $dir 'collector.dpapi'
if((Get-Item $tokenPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse file refused'}
$raw=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($tokenPath),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
$token=[Text.Encoding]::UTF8.GetString($raw);[Array]::Clear($raw,0,$raw.Length)
$handler=New-Object Net.Http.HttpClientHandler
$handler.AllowAutoRedirect=$false
$client=New-Object Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromSeconds(10)
function Request-Aman([string]$Path,[object]$Body=$null,[bool]$Authenticated=$true){
  $method=if($null -eq $Body){[Net.Http.HttpMethod]::Get}else{[Net.Http.HttpMethod]::Post}
  $request=New-Object Net.Http.HttpRequestMessage($method,($base+$Path))
  if($Authenticated){$request.Headers.Authorization=New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer',$token)}
  if($null -ne $Body){$request.Content=New-Object Net.Http.StringContent(($Body | ConvertTo-Json -Depth 10 -Compress),[Text.Encoding]::UTF8,'application/json')}
  try{
    $response=$client.SendAsync($request).GetAwaiter().GetResult()
    try{if(!$response.IsSuccessStatusCode){throw 'Monitoring endpoint rejected the request'};$content=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult();if($content.Length -gt 262144){throw 'Oversized response'};return ($content | ConvertFrom-Json)}finally{$response.Dispose()}
  }finally{$request.Dispose()}
}
$statePath=Join-Path $dir 'state.json'
if(Test-Path $statePath){if((Get-Item $statePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse state refused'};$state=Get-Content $statePath -Raw | ConvertFrom-Json}else{$state=[pscustomobject]@{cursor=$null;cursor_time=$null;queue=@()}}
$state.queue=@($state.queue)
function Save-AmanState {
  $json=$state | ConvertTo-Json -Depth 12 -Compress
  if([Text.Encoding]::UTF8.GetByteCount($json) -gt 20MB){throw 'Spool byte bound reached'}
  $temp=Join-Path $dir ('spool-'+[Guid]::NewGuid().ToString('N')+'.tmp')
  [IO.File]::WriteAllText($temp,$json,(New-Object Text.UTF8Encoding($false)))
  if(Test-Path $statePath){[IO.File]::Replace($temp,$statePath,$null)}else{[IO.File]::Move($temp,$statePath)}
}
try{
  do{
    try{
      # Reading only; never enable auditing, modify the clock or alter the event log.
      $log=Get-WinEvent -ListLog Security -ErrorAction Stop
      if(!$log.IsEnabled){throw 'Security log unavailable'}
      $begin=[DateTime]::UtcNow
      $clock=Request-Aman '/api/time' $null $false
      $end=[DateTime]::UtcNow
      $server=[DateTimeOffset]::Parse([string]$clock.server_time).UtcDateTime
      $mid=$begin.AddTicks([long](($end-$begin).Ticks/2))
      $offset=($server-$mid).TotalSeconds
      if([Math]::Abs($offset) -gt 86400){throw 'Source clock difference exceeds one day'}
      $latest=Get-WinEvent -LogName Security -MaxEvents 1 -ErrorAction Stop
      if($null -eq $state.cursor){
        if($BackfillMinutes -gt 0){$cutoff=[DateTime]::UtcNow.AddMinutes(-$BackfillMinutes);$first=Get-WinEvent -FilterHashtable @{LogName='Security';StartTime=$cutoff} -Oldest -MaxEvents 1 -ErrorAction Stop;$state.cursor=[long]$first.RecordId-1}else{$state.cursor=[long]$latest.RecordId;$state.cursor_time=$latest.TimeCreated.ToUniversalTime().ToString('o')}
        Save-AmanState
      }
      if([long]$latest.RecordId -lt [long]$state.cursor -or ([long]$latest.RecordId -eq [long]$state.cursor -and $state.cursor_time -and $latest.TimeCreated.ToUniversalTime().ToString('o') -ne $state.cursor_time)){$state.cursor=0;$state.cursor_time=$null;Save-AmanState}
      $ids='EventID=4624 or EventID=4625 or EventID=4634 or EventID=4647'
      if($IncludeProcess){$ids+=' or EventID=4688'}
      if($state.queue.Count -lt 20000){
        $xpath='*[System[EventRecordID > '+[long]$state.cursor+' and ('+$ids+')]]'
        try{$records=@(Get-WinEvent -LogName Security -FilterXPath $xpath -Oldest -MaxEvents 100 -ErrorAction Stop)}catch{if($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'){$records=@()}else{throw}}
        foreach($record in $records){
          if($state.queue.Count -ge 20000){break}
          $item=Convert-AmanEvent ([xml]$record.ToXml()) $offset $config.source_id
          $candidate=@($state.queue)+@($item)
          if([Text.Encoding]::UTF8.GetByteCount(($candidate | ConvertTo-Json -Depth 12 -Compress)) -gt 19MB){break}
          $state.queue=$candidate;$state.cursor=[long]$record.RecordId;$state.cursor_time=$record.TimeCreated.ToUniversalTime().ToString('o');Save-AmanState
        }
      }
      # Empty batches are source heartbeats only after the Security log read succeeds.
      $batch=@($state.queue | Select-Object -First 100)
      $reply=Request-Aman '/api/ingest' @{source_id=$config.source_id;events=$batch}
      if($reply.ok -ne $true){throw 'Ingestion was not acknowledged'}
      if($batch.Count){$state.queue=@($state.queue | Select-Object -Skip $batch.Count);Save-AmanState}
      if($Once){[pscustomobject]@{ok=$true;acknowledged=$batch.Count;queued=$state.queue.Count;source_id=$config.source_id} | ConvertTo-Json -Compress}
    }catch{
      # No credentials, raw events, account names, IPs or exception bodies in task logs.
      if($Once){[pscustomobject]@{ok=$false;queued=$state.queue.Count;reason='Source or monitoring endpoint unavailable'} | ConvertTo-Json -Compress;exit 1}
    }
    if(!$Once){Start-Sleep -Seconds 15}
  }while(!$Once)
}finally{$token=$null;$client.Dispose();$handler.Dispose()}

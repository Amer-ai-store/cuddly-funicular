#Requires -Version 5.1
#Requires -RunAsAdministrator
param([string]$SourceId='JAWAFFASVR')
$ErrorActionPreference='Stop'
if($SourceId -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'){throw 'Invalid source ID'}
$dir=Join-Path $env:ProgramData 'AmanAccessMonitor'
if(Test-Path $dir){if((Get-Item $dir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse directory refused'}}else{New-Item -ItemType Directory -Path $dir | Out-Null}
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @('S-1-5-18','S-1-5-32-544')){
  $identity=New-Object Security.Principal.SecurityIdentifier($sid)
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $dir -AclObject $acl
Add-Type -AssemblyName System.Security
$secret=Join-Path $dir 'collector.dpapi'
if(Test-Path $secret){
  if((Get-Item $secret -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse file refused'}
  $raw=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($secret),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  $token=[Text.Encoding]::UTF8.GetString($raw)
}else{
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
  try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
  $token='aman_'+[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $raw=[Text.Encoding]::UTF8.GetBytes($token)
  [IO.File]::WriteAllBytes($secret,[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))
}
$sha=[Security.Cryptography.SHA256]::Create()
try{$digest=([BitConverter]::ToString($sha.ComputeHash($raw))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose();[Array]::Clear($raw,0,$raw.Length);$token=$null}
$config=@{source_id=$SourceId;base_url='https://zvedrouuboxgbanzdnio.supabase.co/functions/v1/aman-access-monitor'}
[IO.File]::WriteAllText((Join-Path $dir 'config.json'),($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
# Deliberately never emit the token, protected bytes or request headers.
[pscustomobject]@{source_id=$SourceId;sha256=$digest;directory=$dir} | ConvertTo-Json -Compress

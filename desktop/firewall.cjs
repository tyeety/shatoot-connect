'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const quote = text => "'" + text.replace(/'/g, "''") + "'";
function evaluateFirewall({profiles,rules}){
  const covers=(ports,port)=>!ports||/^(\*|any)$/i.test(ports)||ports.split(',').some(value=>{const bounds=value.trim().split('-').map(Number);return bounds.length===1?bounds[0]===port:port>=bounds[0]&&port<=bounds[1];});
  for(const profile of profiles){
    if(!profile.enabled)continue;
    const active=rules.filter(r=>r.enabled&&r.direction===1&&(r.profiles&profile.id));
    if(active.some(r=>r.action===0&&(r.protocol===256||r.protocol===6&&covers(r.ports,8788)||r.protocol===17&&covers(r.ports,8789))))return{needsRepair:true};
    if(profile.blockAll)return{needsRepair:true};
    if(profile.defaultAction!==0)continue;
    const allowed=active.filter(r=>r.action===1);
    if(!allowed.some(r=>(r.protocol===256||r.protocol===6)&&covers(r.ports,8788))||!allowed.some(r=>(r.protocol===256||r.protocol===17)&&(!r.ports||/^(\*|any)$/i.test(r.ports))))return{needsRepair:true};
  }
  return{needsRepair:false};
}
function firewallStatus(executable,{run=require('node:child_process').execFile}={}){
  const script=`$ErrorActionPreference='Stop';$program=${quote(executable)};$policy=New-Object -ComObject HNetCfg.FwPolicy2;
$profiles=@(foreach($id in @(1,2,4)){if($policy.CurrentProfileTypes -band $id){@{id=$id;enabled=$policy.FirewallEnabled($id);defaultAction=[int]$policy.DefaultInboundAction($id);blockAll=$policy.BlockAllInboundTraffic($id)}}});
$rules=@(foreach($r in $policy.Rules){if([Environment]::ExpandEnvironmentVariables($r.ApplicationName).Trim('"').Equals($program,[StringComparison]::OrdinalIgnoreCase)){@{enabled=$r.Enabled;direction=[int]$r.Direction;action=[int]$r.Action;profiles=[int]$r.Profiles;protocol=[int]$r.Protocol;ports=$r.LocalPorts}}});
@{profiles=$profiles;rules=$rules}|ConvertTo-Json -Depth 4 -Compress`;
  return new Promise(resolve=>run(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,maxBuffer:1048576},(error,output)=>{try{resolve(error?{needsRepair:null}:evaluateFirewall(JSON.parse(output)));}catch{resolve({needsRepair:null});}}));
}
function repairFirewall(executable) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = `$ErrorActionPreference='Stop'; $program=${quote(executable)};
Get-NetFirewallApplicationFilter -Program $program -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } | Remove-NetFirewallRule;
foreach($name in @('ShatootConnect-LAN-TCP','ShatootConnect-Discovery-UDP','ShatootConnect-WebRTC-UDP')){ Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
New-NetFirewallRule -Name 'ShatootConnect-LAN-TCP' -DisplayName 'Shatoot Connect LAN' -Program $program -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8788 -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null;
New-NetFirewallRule -Name 'ShatootConnect-Discovery-UDP' -DisplayName 'Shatoot Connect Discovery' -Program $program -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8789 -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null;
New-NetFirewallRule -Name 'ShatootConnect-WebRTC-UDP' -DisplayName 'Shatoot Connect WebRTC' -Program $program -Direction Inbound -Action Allow -Protocol UDP -Profile Private,Domain -RemoteAddress LocalSubnet | Out-Null;`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const elevation = `$ErrorActionPreference='Stop';try{$p=Start-Process -FilePath ${quote(powershell)} -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru;exit $p.ExitCode}catch{exit 1223}`;
  return new Promise((resolve, reject) => {
    const proc = spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(elevation, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    proc.on('error', reject); proc.on('exit', code => code === 0 ? resolve(true) : reject(new Error(code === 1223 ? 'Firewall permission was cancelled. You can retry at any time.' : 'Windows could not update firewall rules. Check your administrator or network policy.')));
  });
}
module.exports = { repairFirewall,firewallStatus,evaluateFirewall };

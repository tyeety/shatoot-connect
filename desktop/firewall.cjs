'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const quote = text => "'" + text.replace(/'/g, "''") + "'";
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
module.exports = { repairFirewall };

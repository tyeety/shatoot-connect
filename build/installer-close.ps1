param([string]$OnlyExecutable,[switch]$CloseVisible,[string]$MaximumVersion)
$ErrorActionPreference='Stop'
# Only our product, in the installer's own Windows account and desktop session.
Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;
public static class ShatootSetupWindows {
 public delegate bool Callback(IntPtr window,IntPtr state);
 [DllImport("user32.dll")]static extern bool EnumWindows(Callback cb,IntPtr state);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 public static bool Visible(int[] processes){var ids=new HashSet<int>(processes);bool visible=false;EnumWindows((w,s)=>{uint id;GetWindowThreadProcessId(w,out id);if(ids.Contains((int)id)&&IsWindowVisible(w)){visible=true;return false;}return true;},IntPtr.Zero);return visible;}
}
'@
$account=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
$processes=@(Get-CimInstance Win32_Process -Filter "Name='Shatoot Connect.exe'")
foreach($root in $processes){
    if(!$root.ExecutablePath -or $root.SessionId -ne $session -or $root.CommandLine -match '(?:^|\s)--type='){continue}
    if($OnlyExecutable -and ![IO.Path]::GetFullPath($root.ExecutablePath).Equals([IO.Path]::GetFullPath($OnlyExecutable),[StringComparison]::OrdinalIgnoreCase)){continue}
    try{
        if((Invoke-CimMethod -InputObject $root -MethodName GetOwnerSid).Sid -ne $account){continue}
        $info=[Diagnostics.FileVersionInfo]::GetVersionInfo($root.ExecutablePath)
        if($info.ProductName -ne 'Shatoot Connect'){continue}
        $ids=@($processes|Where-Object {$_.SessionId -eq $session -and $_.ExecutablePath -eq $root.ExecutablePath}|ForEach-Object {[int]$_.ProcessId})
        if($MaximumVersion -and $info.ProductVersion -match '^\d+\.\d+\.\d+' -and [version]$Matches[0] -gt [version]$MaximumVersion){continue}
        if(!$CloseVisible -and [ShatootSetupWindows]::Visible($ids)){continue}
        if($CloseVisible){
            if($info.ProductVersion -match '^\d+\.\d+\.\d+' -and [version]$Matches[0] -ge [version]'0.27.0'){
                $request=Start-Process -FilePath $root.ExecutablePath -ArgumentList '--quit-for-update' -WindowStyle Hidden -PassThru
                $request.WaitForExit(4000)|Out-Null
            }else{
                foreach($processId in $ids){$process=Get-Process -Id $processId -ErrorAction SilentlyContinue;if($process){$process.CloseMainWindow()|Out-Null}}
            }
            $remaining=Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue
            if($remaining){$remaining.WaitForExit(4000)|Out-Null}
            $same=Get-CimInstance Win32_Process -Filter "ProcessId=$($root.ProcessId)" -ErrorAction SilentlyContinue
            if($same -and $same.CreationDate -eq $root.CreationDate -and $same.ExecutablePath -eq $root.ExecutablePath -and (Invoke-CimMethod -InputObject $same -MethodName GetOwnerSid).Sid -eq $account){& "$env:SystemRoot\System32\taskkill.exe" /PID $root.ProcessId /T /F 2>$null|Out-Null}
            continue
        }
        if($info.ProductVersion -match '^\d+\.\d+\.\d+' -and [version]$Matches[0] -ge [version]'0.15.0'){
            $request=Start-Process -FilePath $root.ExecutablePath -ArgumentList '--quit-if-background' -WindowStyle Hidden -PassThru
            $request.WaitForExit(4000)|Out-Null
            $remaining=Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue
            if($remaining){$remaining.WaitForExit(5000)|Out-Null}
        }else{
            # Earlier clients have no graceful background-exit command.
            # Recheck immediately before closing only this verified process tree.
            if(![ShatootSetupWindows]::Visible($ids)){& "$env:SystemRoot\System32\taskkill.exe" /PID $root.ProcessId /T /F 2>$null|Out-Null}
        }
    }catch{continue}
}
Start-Sleep -Milliseconds 300

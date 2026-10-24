$ErrorActionPreference='Stop'
function Get-Sha256([string]$File){$stream=[IO.File]::OpenRead($File);$algorithm=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}}
$workspaceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')+'\'
$testRoot=[IO.Path]::GetFullPath((Join-Path $workspaceRoot 'artifacts/updater-worker-test'))
if(!$testRoot.StartsWith($workspaceRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $testRoot)){throw 'Inspect the existing updater fixture before retrying.'}
[IO.Directory]::CreateDirectory($testRoot)|Out-Null
$originalTest=$env:SHATOOTCONNECT_UPDATE_TEST;$env:SHATOOTCONNECT_UPDATE_TEST='1'
try{
    $cache=Join-Path $testRoot 'updates';[IO.Directory]::CreateDirectory($cache)|Out-Null
    $oldExe=Join-Path $testRoot 'old.exe';$newExe=Join-Path $cache 'ShatootConnect-0.14.0-win-x64.exe';$badExe=Join-Path $cache 'ShatootConnect-0.15.0-win-x64.exe'
    Add-Type -TypeDefinition 'using System.Reflection; [assembly:AssemblyProduct("Shatoot Connect")][assembly:AssemblyInformationalVersion("0.13.0")] public class OldUpdateFixture { public static void Main() {} }' -OutputAssembly $oldExe -OutputType WindowsApplication
    Add-Type -TypeDefinition 'using System;using System.IO;using System.Reflection;
[assembly:AssemblyProduct("Shatoot Connect")][assembly:AssemblyInformationalVersion("0.14.0")]
public class NewUpdateFixture { public static void Main(string[] args) {
 string executable=Assembly.GetExecutingAssembly().Location;File.WriteAllText(Path.ChangeExtension(executable,".started"),"updated");
 string ready=Environment.GetEnvironmentVariable("SHATOOTCONNECT_UPDATE_READY"),token="";foreach(string a in args)if(a.StartsWith("--update-token="))token=a.Substring(15);
 if(!String.IsNullOrEmpty(ready)&&!String.IsNullOrEmpty(token))File.WriteAllText(ready,"{\"token\":\""+token+"\",\"version\":\"0.14.0\",\"executable\":\""+executable.Replace("\\","\\\\")+"\"}");
} }' -OutputAssembly $newExe -OutputType WindowsApplication
    Add-Type -TypeDefinition 'public class FailedUpdateFixture {public static void Main(){System.Environment.Exit(1);}}' -OutputAssembly $badExe -OutputType WindowsApplication
    $target=Join-Path $testRoot 'Shatoot Connect.exe';Copy-Item -LiteralPath $oldExe -Destination $target
    $settingsFile=Join-Path $testRoot 'connection.json';$historyFile=Join-Path $testRoot 'chat-encrypted.dat'
    [IO.File]::WriteAllText($settingsFile,'settings-preserved');[IO.File]::WriteAllText($historyFile,'history-preserved')
    $obsolete=Join-Path $cache 'ShatootConnect-Setup-0.12.0-win-x64.exe';[IO.File]::WriteAllText($obsolete,'obsolete cached setup')
    $keep=Join-Path $cache 'keep.txt';[IO.File]::WriteAllText($keep,'unrelated')
    $worker=Join-Path $workspaceRoot 'desktop/update-worker.ps1';$digest=Get-Sha256 $newExe
    function Run-Worker([string]$Package,[string]$Hash,[string]$Version,[int]$Expected=0){
        $token=[guid]::NewGuid().ToString();$arguments="-NoProfile -ExecutionPolicy Bypass -File `"$worker`" -ParentId 2147483647 -Package `"$Package`" -Target `"$target`" -Digest $Hash -Version $Version -ReadyToken $token -CacheDirectory `"$cache`" -Portable"
        $process=Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
        if(!$process.WaitForExit(90000)){Stop-Process -Id $process.Id -Force;throw 'Update worker timed out.'};$process.Refresh();if($process.ExitCode -ne $Expected){throw "Unexpected update worker result $($process.ExitCode), expected $Expected."}
    }
    Run-Worker $newExe $digest '0.14.0'
    if((Get-Sha256 $target) -ne $digest -or !(Test-Path -LiteralPath ([IO.Path]::ChangeExtension($target,'.started')))){throw 'Updated app did not restart.'}
    if((Test-Path -LiteralPath ($target+'.previous')) -or (Test-Path -LiteralPath $newExe) -or (Test-Path -LiteralPath $obsolete) -or !(Test-Path -LiteralPath $keep)){throw 'Successful update cleanup removed wrong files or left older versions.'}
    Run-Worker $badExe (Get-Sha256 $badExe) '0.15.0' 1
    if((Get-Sha256 $target) -ne $digest -or (Test-Path -LiteralPath ($target+'.previous'))){throw 'Failed startup did not restore the working executable.'}
    Run-Worker $badExe ('0'*64) '0.15.0' 1
    if((Get-Sha256 $target) -ne $digest){throw 'Bad digest modified the application.'}
    if([IO.File]::ReadAllText($settingsFile) -ne 'settings-preserved' -or [IO.File]::ReadAllText($historyFile) -ne 'history-preserved'){throw 'Update touched profile data.'}
    Copy-Item -LiteralPath $oldExe -Destination ($target+'.previous')
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $worker -CleanupOnly -Target $target -Version '0.14.0' -CacheDirectory $cache
    if($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath ($target+'.previous'))){throw 'Legacy updater backup was not cleaned on successful startup.'}
    [IO.File]::WriteAllText(($target+'.previous'),'unrelated backup')
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $worker -CleanupOnly -Target $target -Version '0.14.0' -CacheDirectory $cache
    if(!(Test-Path -LiteralPath ($target+'.previous'))){throw 'Unknown backup was incorrectly deleted.'}
    Remove-Item -LiteralPath ($target+'.previous')
    Write-Output 'Ready-confirmed replacement, old-version cleanup, startup-failure rollback, invalid-digest refusal and profile preservation passed.'
    $launcherDir=Join-Path $testRoot 'stable launcher';$script=Join-Path $workspaceRoot 'desktop/launcher.ps1';[IO.Directory]::CreateDirectory($launcherDir)|Out-Null
    Copy-Item -LiteralPath $script -Destination (Join-Path $launcherDir 'launcher.ps1')
    @{target=$target;version='0.14.0'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $launcherDir 'launcher.json') -Encoding utf8
    $linkFile=Join-Path $testRoot 'Shatoot Connect.lnk';$shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($linkFile);$link.TargetPath=(Get-Command powershell.exe).Source;$link.Arguments="-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $launcherDir 'launcher.ps1')`"";$link.Save();$linkHash=Get-Sha256 $linkFile
    $moved=Join-Path $testRoot 'Another version.exe';Copy-Item -LiteralPath $target -Destination $moved
    @{target=$moved;version='0.15.0'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $launcherDir 'launcher.json') -Encoding utf8
    Start-Process -FilePath $linkFile -WindowStyle Hidden
    $marker=[IO.Path]::ChangeExtension($moved,'.started');for($i=0;$i -lt 100 -and !(Test-Path -LiteralPath $marker);$i++){Start-Sleep -Milliseconds 100}
    if(!(Test-Path -LiteralPath $marker) -or (Get-Sha256 $linkFile) -ne $linkHash){throw 'Stable desktop shortcut failed after executable/version path changed.'}
    Write-Output 'The same Windows desktop shortcut opened a different/newer executable without changing the link.'
}finally{
    $env:SHATOOTCONNECT_UPDATE_TEST=$originalTest
    if(!$testRoot.StartsWith($workspaceRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup target.'}
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}

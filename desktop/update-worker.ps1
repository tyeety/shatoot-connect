param([int]$ParentId,[string]$Package,[string]$Target,[string]$Digest,[string]$Version,[string]$ReadyToken,[string]$CacheDirectory,[switch]$Portable,[switch]$CleanupOnly)
$ErrorActionPreference='Stop'
function Get-Sha256([string]$File){$stream=[IO.File]::OpenRead($File);$algorithm=[Security.Cryptography.SHA256]::Create();try{return([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$algorithm.Dispose()}}
function Remove-OldCache {
    if(!$CacheDirectory -or !(Test-Path -LiteralPath $CacheDirectory)){return}
    $cache=[IO.Path]::GetFullPath($CacheDirectory).TrimEnd('\')
    foreach($file in Get-ChildItem -LiteralPath $cache -File){
        if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
        if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($file.FullName)) -ne $cache){throw 'Cache cleanup escaped its directory.'}
        if($file.Name -match '^ShatootConnect-(?:Setup-)?(\d+\.\d+\.\d+)-win-x64\.exe(?:\.partial)?$' -and [version]$Matches[1] -le [version]$Version){Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue}
    }
}
function Remove-LegacyBackup {
    $candidate=[IO.Path]::GetFullPath($Target)+'.previous'
    if(!(Test-Path -LiteralPath $candidate)){return}
    $item=Get-Item -LiteralPath $candidate
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){return}
    $info=[Diagnostics.FileVersionInfo]::GetVersionInfo($candidate)
    if($info.ProductName -eq 'Shatoot Connect' -and $info.ProductVersion -match '^\d+\.\d+\.\d+$' -and [version]$info.ProductVersion -le [version]$Version){Remove-Item -LiteralPath $candidate -Force}
}
$startup=$null;$backup=$null;$replaced=$false;$readyFile=$null
try {
    $Target=[IO.Path]::GetFullPath($Target)
    if([IO.Path]::GetExtension($Target) -ne '.exe' -or $Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid update destination or version.'}
    if($CleanupOnly){Remove-LegacyBackup;Remove-OldCache;exit 0}
    if($ReadyToken -notmatch '^[a-f0-9-]{36}$'){throw 'Invalid update startup token.'}
    $Package=[IO.Path]::GetFullPath($Package)
    if($Package -eq $Target -or (Get-Sha256 $Package) -ne $Digest){throw 'Update integrity check failed.'}
    if(!$CacheDirectory){$CacheDirectory=[IO.Path]::GetDirectoryName($Package)}
    $readyFile=Join-Path $CacheDirectory ($ReadyToken+'.ready.json')
    if(Test-Path -LiteralPath $readyFile){Remove-Item -LiteralPath $readyFile -Force}
    $parentProcess=Get-Process -Id $ParentId -ErrorAction SilentlyContinue
    if($parentProcess -and !$parentProcess.WaitForExit(30000)){throw 'The application did not close. Please retry the update.'}
    Start-Sleep -Seconds 2
    if($Portable){
        $backup=$Target+'.previous'
        if(Test-Path -LiteralPath $backup){Remove-LegacyBackup;if(Test-Path -LiteralPath $backup){throw 'An unrecognized rollback file must be preserved.'}}
        Move-Item -LiteralPath $Target -Destination $backup;$replaced=$true
        Copy-Item -LiteralPath $Package -Destination $Target
    }else{
        $destination=[IO.Path]::GetDirectoryName($Target)
        $setup=Start-Process -FilePath $Package -ArgumentList "/S /D=$destination" -WindowStyle Hidden -PassThru -Wait
        if($setup.ExitCode -ne 0){throw "Setup returned $($setup.ExitCode). The existing profile was retained."}
    }
    $env:SHATOOTCONNECT_UPDATE_READY=$readyFile
    $startup=Start-Process -FilePath $Target -ArgumentList "--update-token=$ReadyToken" -WorkingDirectory ([IO.Path]::GetDirectoryName($Target)) -WindowStyle Hidden -PassThru
    $deadline=[DateTime]::UtcNow.AddSeconds(60);$ready=$false
    while([DateTime]::UtcNow -lt $deadline){
        if(Test-Path -LiteralPath $readyFile){try{$ack=Get-Content -LiteralPath $readyFile -Raw|ConvertFrom-Json;if($ack.token -eq $ReadyToken -and $ack.version -eq $Version -and [IO.Path]::GetFullPath($ack.executable).Equals($Target,[StringComparison]::OrdinalIgnoreCase)){$ready=$true;break}}catch{}}
        $startup.Refresh();if($startup.HasExited){break};Start-Sleep -Milliseconds 200
    }
    if(!$ready){throw 'The updated application did not confirm successful startup.'}
    if($Portable -and (Test-Path -LiteralPath $backup)){Remove-Item -LiteralPath $backup -Force}
    Remove-Item -LiteralPath $Package -Force -ErrorAction SilentlyContinue
    Remove-OldCache
    Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
} catch {
    $failure=$_.Exception.Message
    if($replaced -and $backup -and (Test-Path -LiteralPath $backup)){
        if($startup){try{$startup.Refresh();if(!$startup.HasExited){& taskkill.exe /PID $startup.Id /T /F | Out-Null}}catch{}}
        if(Test-Path -LiteralPath $Target){Remove-Item -LiteralPath $Target -Force}
        Move-Item -LiteralPath $backup -Destination $Target
    }
    if($readyFile){Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue}
    if($CleanupOnly){exit 1}
    if($env:SHATOOTCONNECT_UPDATE_TEST -ne '1'){Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.MessageBox]::Show($failure,'Shatoot Connect update','OK','Error')|Out-Null;if(Test-Path -LiteralPath $Target){Start-Process -FilePath $Target -ArgumentList '--update-failed' -WindowStyle Hidden}}
    else{Write-Output $failure}
    exit 1
}

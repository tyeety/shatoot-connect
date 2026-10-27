param([string]$Installer)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$package = Get-Content -LiteralPath (Join-Path $workspace 'package.json') -Raw | ConvertFrom-Json
if (!$Installer) { $Installer = Join-Path $workspace "release/ShatootConnect-Setup-$($package.version)-win-x64.exe" }
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$payload = Join-Path $workspace 'release/win-unpacked'
if (!(Test-Path -LiteralPath $payload)) { throw 'Build the installer first; win-unpacked is required for byte verification.' }
Push-Location $workspace
try { $guid = 'const {UUID}=require("builder-util-runtime");console.log(UUID.v5(require("./package.json").build.appId,UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3")))' | & node } finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or !$guid) { throw 'Cannot determine installer identity.' }
$registry = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$installRegistry = "Software\$guid"
foreach ($hive in @([Microsoft.Win32.Registry]::CurrentUser, [Microsoft.Win32.Registry]::LocalMachine)) {
    $existing = $hive.OpenSubKey($registry)
    if ($existing) { $existing.Dispose(); throw 'An existing Shatoot Connect installation was found. Run this integration test in a clean Windows account or VM.' }
    $existing = $hive.OpenSubKey($installRegistry)
    if ($existing) { $existing.Dispose(); throw 'An existing installation record was found. Use a clean Windows account or VM.' }
}
if (Get-Process -Name 'Shatoot Connect' -ErrorAction SilentlyContinue) { throw 'Close Shatoot Connect before testing.' }
$links = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Shatoot Connect.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Shatoot Connect.lnk'))
foreach ($link in $links) { if (Test-Path -LiteralPath $link) { throw "An existing shortcut must be preserved. Test in a clean account: $link" } }
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'artifacts/installer-test'))
if (!$testRoot.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Test path outside workspace.' }
if (Test-Path -LiteralPath $testRoot) { throw 'A previous installer test directory exists. Inspect it before testing again.' }
$installDir = Join-Path $testRoot 'installed/Shatoot Connect'
$fixture = $null
$profileProbe = $null
$createdSettings=$false
$aclPath = $null
$originalAcl = $null

function Invoke-Setup([string]$Path, [string]$Arguments, [int]$Expected = 0) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(120000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'Installer timed out. Inspect Windows dialogs or security software.'
    }
    $process.Refresh()
    if ($process.ExitCode -ne $Expected) { throw "Expected installer exit $Expected; got $($process.ExitCode). See the setup log in TEMP." }
}
function Get-ContentHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)) } finally { $stream.Dispose(); $hash.Dispose() }
}
function Assert-Payload {
    $count = 0
    foreach ($source in Get-ChildItem -LiteralPath $payload -File -Recurse) {
        $relative = $source.FullName.Substring($payload.Length).TrimStart('\')
        $target = Join-Path $installDir $relative
        if (!(Test-Path -LiteralPath $target) -or (Get-ContentHash $source.FullName) -ne (Get-ContentHash $target)) { throw "Installed payload mismatch: $relative" }
        $count++
    }
    Write-Output "Verified $count installed files against the packaged payload."
}
function Uninstall-TestCopy([int]$Expected = 0) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($installRegistry)
    if (!$key) { return }
    try { $registeredPath = $key.GetValue('InstallLocation') } finally { $key.Dispose() }
    if ($registeredPath -ne $installDir) { throw 'Refusing to uninstall a location outside this test.' }
    $uninstaller = Join-Path $installDir 'Uninstall Shatoot Connect.exe'
    if (!(Test-Path -LiteralPath $uninstaller)) { throw 'Test uninstaller is missing.' }
    # Relocate the uninstaller as its normal launcher does, then use _?= to keep
    # the worker in-process. Running _?= from INSTDIR would lock its own payload.
    $worker = Join-Path $testRoot 'uninstall-worker.exe'
    Copy-Item -LiteralPath $uninstaller -Destination $worker -Force
    try { Invoke-Setup $worker "/S /currentuser _?=$installDir" $Expected } finally { [IO.File]::Delete($worker) }
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    $invalid = Join-Path $testRoot 'Shatoot Connect unrelated'
    Invoke-Setup $Installer "/S /currentuser /D=$invalid" 11
    if ((Test-Path -LiteralPath $invalid) -and (Get-ChildItem -LiteralPath $invalid -Force)) { throw 'Rejected destination contains installed files.' }

    $occupied = Join-Path $testRoot 'occupied/Shatoot Connect'
    New-Item -ItemType Directory -Path $occupied -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $occupied 'keep.txt'), 'Unrelated data')
    Invoke-Setup $Installer "/S /currentuser /D=$occupied" 11
    if ([IO.File]::ReadAllText((Join-Path $occupied 'keep.txt')) -ne 'Unrelated data') { throw 'Unrelated files were modified.' }
    Write-Output 'Unsafe and occupied destination rejection passed.'

    $aclPath = Join-Path $testRoot 'denied/Shatoot Connect'
    New-Item -ItemType Directory -Path $aclPath -Force | Out-Null
    $originalAcl = [IO.Directory]::GetAccessControl($aclPath)
    $deniedAcl = [IO.Directory]::GetAccessControl($aclPath)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $deniedAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'Write', 'ContainerInherit,ObjectInherit', 'None', 'Deny'))
    try {
        [IO.Directory]::SetAccessControl($aclPath, $deniedAcl)
        Invoke-Setup $Installer "/S /currentuser /D=$aclPath" 12
    } finally { [IO.Directory]::SetAccessControl($aclPath, $originalAcl); $originalAcl = $null }
    Write-Output 'Destination write-denied handling passed.'

    # A harmless process fixture tests the real process gate without opening the app,
    # connecting to a server, or changing the user's credentials/preferences.
    $fixtureDir = Join-Path $testRoot 'running'
    New-Item -ItemType Directory -Path $fixtureDir | Out-Null
    $fixtureExe = Join-Path $fixtureDir 'Shatoot Connect.exe'
    Add-Type -TypeDefinition 'public class InstallerRunningFixture { public static void Main() { System.Threading.Thread.Sleep(120000); } }' -OutputAssembly $fixtureExe -OutputType WindowsApplication
    $fixture = Start-Process -FilePath $fixtureExe -WindowStyle Hidden -PassThru
    try {
        Invoke-Setup $Installer "/S /currentuser /D=$installDir" 1618
        $fixture.Refresh()
        if ($fixture.HasExited) { throw 'Installer terminated the running process.' }
    } finally { Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue; $fixture = $null }
    Write-Output 'An unrelated same-name process returns 1618 and is preserved.'

    $verifiedDir=Join-Path $testRoot 'verified-background';New-Item -ItemType Directory -Path $verifiedDir|Out-Null
    $verifiedExe=Join-Path $verifiedDir 'Shatoot Connect.exe'
    Add-Type -ReferencedAssemblies 'System.Windows.Forms','System.Drawing' -TypeDefinition @'
using System;using System.Reflection;using System.Runtime.InteropServices;using System.Windows.Forms;
[assembly:AssemblyProduct("Shatoot Connect")][assembly:AssemblyInformationalVersion("0.14.2")]
public class VerifiedSetupFixture {
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr window,int command);
 [STAThread]public static void Main(string[] args){
  if(args.Length==0){System.Threading.Thread.Sleep(120000);return;}
  var form=new Form {Text="Shatoot Connect installer visibility fixture"};
  form.Shown+=(sender,e)=>ShowWindow(form.Handle,5);Application.Run(form);
 }
}
'@ -OutputAssembly $verifiedExe -OutputType WindowsApplication
    $closer=Join-Path $workspace 'build/installer-close.ps1'
    $fixture=Start-Process -FilePath $verifiedExe -ArgumentList 'visible' -WindowStyle Hidden -PassThru
    try{
        for($i=0;$i -lt 50;$i++){$fixture.Refresh();if($fixture.MainWindowHandle -ne 0){break};Start-Sleep -Milliseconds 100}
        if($fixture.MainWindowHandle -eq 0){throw 'Visible installer fixture did not open.'}
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $closer -OnlyExecutable $verifiedExe
        $fixture.Refresh();if($fixture.HasExited){throw 'Background closer terminated an open window.'}
    }finally{Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue;$fixture=$null}
    $fixture=Start-Process -FilePath $verifiedExe -WindowStyle Hidden -PassThru
    try{
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $closer -OnlyExecutable $verifiedExe
        if(!$fixture.WaitForExit(5000)){throw 'Verified background app was not closed.'}
    }finally{Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue;$fixture=$null}
    $fixture=Start-Process -FilePath $verifiedExe -ArgumentList 'visible' -WindowStyle Hidden -PassThru
    try{
        for($i=0;$i -lt 50;$i++){$fixture.Refresh();if($fixture.MainWindowHandle -ne 0){break};Start-Sleep -Milliseconds 100}
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $closer -OnlyExecutable $verifiedExe -CloseVisible -MaximumVersion $package.version
        if(!$fixture.WaitForExit(8000)){throw 'Upgrade closer left the verified visible legacy app running.'}
    }finally{Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue;$fixture=$null}
    Write-Output 'Upgrade closes verified visible/hidden legacy apps; background-only mode and unrelated-process guards are preserved.'
    $profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) $package.name
    New-Item -ItemType Directory -Path $profile -Force | Out-Null
    $profileProbe = Join-Path $profile ('installer-preservation-' + [Guid]::NewGuid().ToString('N'))
    $probeBytes = [Text.Encoding]::UTF8.GetBytes([Guid]::NewGuid().ToString())
    [IO.File]::WriteAllBytes($profileProbe, $probeBytes)
    $settings = Join-Path $profile 'connection.json'
    if(!(Test-Path -LiteralPath $settings)){[IO.File]::WriteAllText($settings,'{"startupEnabled":false,"internetEnabled":false,"sharedCursor":false}');$createdSettings=$true}
    $settingsHash = if (Test-Path -LiteralPath $settings) { Get-ContentHash $settings } else { $null }
    $settingsBefore=if(Test-Path -LiteralPath $settings){Get-Content -LiteralPath $settings -Raw|ConvertFrom-Json}else{$null}
    Invoke-Setup $Installer "/S /currentuser /D=$installDir"
    Assert-Payload
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registry)
    try { if (!$key -or $key.GetValue('DisplayVersion') -ne $package.version) { throw 'Installed version registration failed.' } } finally { if ($key) { $key.Dispose() } }
    $wsh = New-Object -ComObject WScript.Shell
    foreach ($link in $links) { if (!(Test-Path -LiteralPath $link) -or $wsh.CreateShortcut($link).TargetPath -ne (Join-Path $installDir 'Shatoot Connect.exe')) { throw 'Installed shortcut points to the wrong executable.' } }
    Write-Output 'Fresh installation, Windows registration and shortcuts passed.'

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registry, $true)
    try { $key.SetValue('DisplayVersion', '99.0.0') } finally { $key.Dispose() }
    try { Invoke-Setup $Installer "/S /currentuser /D=$installDir" 16 } finally {
        $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registry, $true)
        try { $key.SetValue('DisplayVersion', $package.version) } finally { $key.Dispose() }
    }
    Write-Output 'Accidental downgrade prevention passed.'

    $locked = [IO.File]::Open((Join-Path $installDir 'resources/app.asar'), 'Open', 'Read', 'Read')
    try { Invoke-Setup $Installer "/S /currentuser /D=$installDir" 1603 } finally { $locked.Dispose() }
    Assert-Payload
    Write-Output 'Locked-file upgrade failure preserved the previous installation.'

    [IO.File]::WriteAllText((Join-Path $installDir 'resources/app.asar'), 'Damaged test payload')
    Invoke-Setup $Installer "/S /currentuser /D=$installDir"
    Assert-Payload
    Write-Output 'Reinstall repaired a damaged payload.'
    # Exercise the installed updater itself, including NSIS and the real packaged
    # application ready acknowledgement. The clean-account guards above apply.
    $updateCache=Join-Path $profile 'updates';[IO.Directory]::CreateDirectory($updateCache)|Out-Null
    $updatePackage=Join-Path $updateCache "ShatootConnect-Setup-$($package.version)-win-x64.exe"
    Copy-Item -LiteralPath $Installer -Destination $updatePackage
    $updateDigest=(Get-ContentHash $updatePackage).Replace('-','').ToLowerInvariant();$updateToken=[guid]::NewGuid().ToString()
    [IO.File]::WriteAllText((Join-Path $installDir 'resources/app.asar'),'Installed updater repair fixture')
    $updateWorker=Join-Path $workspace 'desktop/update-worker.ps1';$updateTarget=Join-Path $installDir 'Shatoot Connect.exe'
    $originalUpdateTest=$env:SHATOOTCONNECT_UPDATE_TEST;$env:SHATOOTCONNECT_UPDATE_TEST='1'
    try{
        $updateArgs="-NoProfile -ExecutionPolicy Bypass -File `"$updateWorker`" -ParentId 2147483647 -Package `"$updatePackage`" -Target `"$updateTarget`" -Digest $updateDigest -Version $($package.version) -ReadyToken $updateToken -CacheDirectory `"$updateCache`""
        $updateProcess=Start-Process powershell.exe -ArgumentList $updateArgs -WindowStyle Hidden -PassThru
        if(!$updateProcess.WaitForExit(180000)){Stop-Process -Id $updateProcess.Id -Force;throw 'Installed update timed out.'}
        $updateProcess.Refresh();if($updateProcess.ExitCode -ne 0){throw ('Installed updater failed: '+[IO.File]::ReadAllText((Join-Path $updateCache 'last-update.json')))}
        $result=Get-Content -LiteralPath (Join-Path $updateCache 'last-update.json') -Raw|ConvertFrom-Json
        if($result.state -ne 'installed' -or $result.token -ne $updateToken -or (Test-Path -LiteralPath $updatePackage)){throw 'Installed update did not acknowledge restart/cleanup.'}
        Assert-Payload
        $settingsAfter=Get-Content -LiteralPath $settings -Raw|ConvertFrom-Json
        if($settingsAfter.inputModeVersion -ne 1 -or $settingsAfter.sharedCursor -ne $true){throw 'The legacy profile did not migrate to shared mouse control.'}
        foreach($property in $settingsBefore.PSObject.Properties){
            $afterProperty=$settingsAfter.PSObject.Properties[$property.Name]
            if($property.Name -eq 'sharedCursor' -and !$settingsBefore.PSObject.Properties['inputModeVersion']){if($afterProperty.Value -ne $true){throw 'Shared mouse migration failed.'};continue}
            if(!$afterProperty -or ($property.Value|ConvertTo-Json -Depth 100 -Compress) -cne ($afterProperty.Value|ConvertTo-Json -Depth 100 -Compress)){throw ('Installed update changed an existing preference: '+$property.Name)}
        }
        foreach($property in $settingsAfter.PSObject.Properties){if(!$settingsBefore.PSObject.Properties[$property.Name] -and $property.Name -notin @('deviceId','deviceSecret','inputModeVersion','sharedCursor')){throw ('Unexpected startup preference change: '+$property.Name)}}
        if(!$settingsAfter.deviceId -or !$settingsAfter.deviceSecret){throw 'Packaged startup did not retain the device identity.'}
        # A first application launch initializes identity; retain this complete
        # profile byte-for-byte through the following uninstall checks.
        $settingsHash=Get-ContentHash $settings
        foreach($link in $links){
            $shortcut=$wsh.CreateShortcut($link)
            if($shortcut.TargetPath -eq $updateTarget){continue}
            $launcherFile=Join-Path $profile 'launcher/launcher.ps1';$launcherConfig=Join-Path $profile 'launcher/launcher.json'
            $powershellFile=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
            if($shortcut.TargetPath -ne $powershellFile -or !$shortcut.Arguments.Contains($launcherFile) -or !(Test-Path -LiteralPath $launcherConfig)){throw 'Update changed the shortcut to an unrecognized target.'}
            $registeredLauncher=Get-Content -LiteralPath $launcherConfig -Raw|ConvertFrom-Json
            if($registeredLauncher.target -ne $updateTarget -or $registeredLauncher.version -ne $package.version){throw 'The stable desktop launcher does not target the updated application.'}
        }
        Write-Output 'Real installed updater repaired payload through NSIS, relaunched the packaged app, verified startup, cleaned cache and retained shortcuts/profile.'
    }finally{
        $env:SHATOOTCONNECT_UPDATE_TEST=$originalUpdateTest
        foreach($running in Get-Process -Name 'Shatoot Connect' -ErrorAction SilentlyContinue){try{if($running.Path -eq $updateTarget){Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue}}catch{}}
        Start-Sleep -Milliseconds 500
    }
    $locked = [IO.File]::Open((Join-Path $installDir 'resources/app.asar'), 'Open', 'Read', 'Read')
    try { Uninstall-TestCopy 1603 } finally { $locked.Dispose() }
    Assert-Payload
    Write-Output 'Locked-file uninstall failed safely and restored the application.'
    Uninstall-TestCopy
    foreach ($link in $links) { if (Test-Path -LiteralPath $link) { throw 'Uninstall left an application shortcut.' } }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registry)
    if ($key) { $key.Dispose(); throw 'Uninstall left the registered application.' }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($profileProbe)) -ne [Convert]::ToBase64String($probeBytes)) { throw 'Uninstall changed personal data.' }
    $afterHash = if (Test-Path -LiteralPath $settings) { Get-ContentHash $settings } else { $null }
    if ($afterHash -ne $settingsHash) { throw 'Installation lifecycle changed saved settings.' }
    Write-Output 'Uninstall removed registration/shortcuts and retained personal data. Installer integration checks passed.'
} finally {
    if ($fixture) { Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue }
    if ($originalAcl) { [IO.Directory]::SetAccessControl($aclPath, $originalAcl) }
    Uninstall-TestCopy
    if ($profileProbe -and (Test-Path -LiteralPath $profileProbe)) { [IO.File]::Delete($profileProbe) }
    if($createdSettings -and (Test-Path -LiteralPath $settings)){[IO.File]::Delete($settings)}
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        if (!$resolvedTestRoot.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup path outside workspace.' }
        Add-Type -AssemblyName Microsoft.VisualBasic
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($resolvedTestRoot, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
    }
}

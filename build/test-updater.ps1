$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'artifacts/updater-worker-test'))
if (!$testRoot.StartsWith($workspaceRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $testRoot)) { throw 'Inspect the existing updater fixture before retrying.' }
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
try {
    $oldExe = Join-Path $testRoot 'old.exe'
    $newExe = Join-Path $testRoot 'new.exe'
    Add-Type -TypeDefinition 'public class OldUpdateFixture { public static void Main() {} }' -OutputAssembly $oldExe -OutputType WindowsApplication
    Add-Type -TypeDefinition 'public class NewUpdateFixture { public static void Main() { System.IO.File.WriteAllText(System.IO.Path.ChangeExtension(System.Reflection.Assembly.GetExecutingAssembly().Location,".started"),"updated"); } }' -OutputAssembly $newExe -OutputType WindowsApplication
    $target = Join-Path $testRoot 'Shatoot Connect.exe'
    Copy-Item -LiteralPath $oldExe -Destination $target
    $settingsFile = Join-Path $testRoot 'connection.json'
    $historyFile = Join-Path $testRoot 'chat-encrypted.dat'
    [IO.File]::WriteAllText($settingsFile,'settings-preserved')
    [IO.File]::WriteAllText($historyFile,'encrypted-history-preserved')
    $digest = Get-Sha256 $newExe
    $oldDigest = Get-Sha256 $oldExe
    $worker = Join-Path $workspaceRoot 'desktop/update-worker.ps1'
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$worker`" -ParentId 2147483647 -Package `"$newExe`" -Target `"$target`" -Digest $digest -Portable"
    $process = Start-Process -FilePath powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(20000) -or $process.ExitCode -ne 0) { throw 'Portable update worker failed.' }
    $marker = [IO.Path]::ChangeExtension($target,'.started')
    for ($i=0; $i -lt 50 -and !(Test-Path -LiteralPath $marker); $i++) { Start-Sleep -Milliseconds 100 }
    if (!(Test-Path -LiteralPath $marker)) { throw 'Updated executable did not restart.' }
    if ((Get-Sha256 $target) -ne $digest) { throw 'New executable mismatch.' }
    if ((Get-Sha256 ($target+'.previous')) -ne $oldDigest) { throw 'Rollback copy mismatch.' }
    if ([IO.File]::ReadAllText($settingsFile) -ne 'settings-preserved' -or [IO.File]::ReadAllText($historyFile) -ne 'encrypted-history-preserved') { throw 'Update touched profile data.' }
    Write-Output 'Portable worker replaced the executable, retained the previous version, restarted successfully and preserved settings/history.'
} finally {
    if (!$testRoot.StartsWith($workspaceRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup target.' }
    Remove-Item -LiteralPath $testRoot -Recurse -Force
}

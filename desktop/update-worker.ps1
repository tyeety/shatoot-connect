param([int]$ParentId, [string]$Package, [string]$Target, [string]$Digest, [switch]$Portable)
$ErrorActionPreference = 'Stop'
try {
    if ((Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest) { throw 'Update integrity check failed.' }
    $parentProcess = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
    if ($parentProcess -and !$parentProcess.WaitForExit(30000)) { throw 'The application did not close. Please retry the update.' }
    Start-Sleep -Seconds 2
    if ($Portable) {
        $backup = $Target + '.previous'
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
        Move-Item -LiteralPath $Target -Destination $backup
        try { Copy-Item -LiteralPath $Package -Destination $Target; Start-Process -FilePath $Target -WorkingDirectory (Split-Path -LiteralPath $Target) }
        catch { if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }; Move-Item -LiteralPath $backup -Destination $Target; throw }
    } else {
        $destination = Split-Path -LiteralPath $Target
        $setup = Start-Process -FilePath $Package -ArgumentList "/S /D=$destination" -PassThru -Wait
        if ($setup.ExitCode -ne 0) { throw "Setup returned $($setup.ExitCode). The existing profile was retained." }
        Start-Process -FilePath $Target -WorkingDirectory $destination
    }
    Remove-Item -LiteralPath $Package -Force -ErrorAction SilentlyContinue
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Shatoot Connect update', 'OK', 'Error') | Out-Null
    if (Test-Path -LiteralPath $Target) { Start-Process -FilePath $Target -ArgumentList '--update-failed' }
    exit 1
}

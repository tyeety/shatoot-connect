param([string]$Favorite, [switch]$StartInTray)
$ErrorActionPreference='Stop'
try {
    $record=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $target=[IO.Path]::GetFullPath($record.target)
    if (![IO.File]::Exists($target) -or [IO.Path]::GetExtension($target) -ne '.exe') { throw 'The application was moved. Open the current Shatoot Connect executable once to repair its shortcuts.' }
    $arguments=@()
    if ($Favorite) { if ($Favorite -notmatch '^[a-f0-9-]{36}$') { throw 'Invalid saved computer.' }; $arguments+="--connect-saved=$Favorite" }
    if ($StartInTray) { $arguments+='--start-in-tray' }
    if ($arguments.Count) { Start-Process -FilePath $target -ArgumentList $arguments -WorkingDirectory ([IO.Path]::GetDirectoryName($target)) -WindowStyle Hidden }
    else { Start-Process -FilePath $target -WorkingDirectory ([IO.Path]::GetDirectoryName($target)) -WindowStyle Hidden }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Shatoot Connect','OK','Error') | Out-Null
    exit 1
}

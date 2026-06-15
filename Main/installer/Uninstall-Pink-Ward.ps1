$ErrorActionPreference = "Stop"

$installRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Pink Ward.lnk"
$startMenuFolder = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Pink Ward"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PinkWard"

Get-Process -Name "Pink Ward" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $startMenuFolder -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue

$escapedInstallRoot = $installRoot.Replace("'", "''")
$cleanupScript = Join-Path $env:TEMP "pink-ward-uninstall-$([guid]::NewGuid().ToString('N')).ps1"
@"
Start-Sleep -Seconds 2
Remove-Item -LiteralPath '$escapedInstallRoot' -Recurse -Force
Remove-Item -LiteralPath `$PSCommandPath -Force
"@ | Set-Content -LiteralPath $cleanupScript -Encoding utf8

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$cleanupScript`""
)

Write-Host "Pink Ward was uninstalled. Project data was kept in AppData."

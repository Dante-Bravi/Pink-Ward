$ErrorActionPreference = "Stop"

function Set-Shortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath,
    [string]$WorkingDirectory
  )

  $shortcutDirectory = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = "$TargetPath,0"
  $shortcut.Description = "Pink Ward"
  $shortcut.Save()
}

$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$sevenZipPath = Join-Path $packageRoot "7za.exe"
$archive = Get-ChildItem -LiteralPath $packageRoot -Filter "Pink-Ward-*-Windows-x64.7z" -File |
  Select-Object -First 1

if (-not (Test-Path -LiteralPath $sevenZipPath)) {
  throw "The installer is missing 7za.exe. Extract the complete installer ZIP first."
}

if (-not $archive) {
  throw "The installer is missing the Pink Ward application archive."
}

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\Pink Ward"
$stagingRoot = "$installRoot.installing"
$executablePath = Join-Path $installRoot "Pink Ward.exe"

Get-Process -Name "Pink Ward" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
& $sevenZipPath x $archive.FullName "-o$stagingRoot" -y
if ($LASTEXITCODE -ne 0) {
  throw "Could not extract the Pink Ward application archive."
}

if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot "Pink Ward.exe"))) {
  throw "The extracted package does not contain Pink Ward.exe."
}

if (Test-Path -LiteralPath $installRoot) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}

Move-Item -LiteralPath $stagingRoot -Destination $installRoot

foreach ($scriptName in @("Uninstall-Pink-Ward.cmd", "Uninstall-Pink-Ward.ps1")) {
  Copy-Item -LiteralPath (Join-Path $packageRoot $scriptName) -Destination $installRoot
}

$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Pink Ward.lnk"
$startMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Pink Ward\Pink Ward.lnk"
Set-Shortcut -ShortcutPath $desktopShortcut -TargetPath $executablePath -WorkingDirectory $installRoot
Set-Shortcut -ShortcutPath $startMenuShortcut -TargetPath $executablePath -WorkingDirectory $installRoot

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PinkWard"
$estimatedSize = [math]::Ceiling(
  ((Get-ChildItem -LiteralPath $installRoot -Recurse -File | Measure-Object Length -Sum).Sum) / 1KB
)
New-Item -Path $uninstallKey -Force | Out-Null
Set-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "Pink Ward"
Set-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value "__PINK_WARD_VERSION__"
Set-ItemProperty -Path $uninstallKey -Name "Publisher" -Value "Pink Ward"
Set-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $installRoot
Set-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $executablePath
Set-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value "`"$installRoot\Uninstall-Pink-Ward.cmd`""
Set-ItemProperty -Path $uninstallKey -Name "EstimatedSize" -Value ([int]$estimatedSize) -Type DWord
Set-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -Type DWord

Write-Host "Pink Ward was installed to $installRoot"
Start-Process -FilePath $executablePath -WorkingDirectory $installRoot

param(
  [string]$PythonExecutable = "python",
  [string]$OutputDirectory = "",
  [string]$TorchVersion = "2.12.0",
  [string]$TorchvisionVersion = "0.27.0",
  [string]$UltralyticsVersion = "8.4.53",
  [string]$LapVersion = "0.5.13"
)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "runtime"))

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $runtimeRoot "python"
}

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$runtimePrefix = $runtimeRoot.TrimEnd("\") + "\"

if (-not $outputPath.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "The runtime output must stay inside $runtimeRoot"
}

$pythonInfoJson = & $PythonExecutable -c "import json, platform, sys; print(json.dumps({'executable': sys.executable, 'basePrefix': sys.base_prefix, 'version': platform.python_version(), 'bits': 64 if sys.maxsize > 2**32 else 32}))"
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect the bootstrap Python interpreter."
}

$pythonInfo = $pythonInfoJson | ConvertFrom-Json
if ($pythonInfo.bits -ne 64) {
  throw "Pink Ward requires a 64-bit Python bootstrap interpreter."
}

if (-not $pythonInfo.version.StartsWith("3.12.")) {
  throw "Pink Ward's packaged runtime currently requires Python 3.12.x. Found $($pythonInfo.version)."
}

$sourceRoot = [System.IO.Path]::GetFullPath($pythonInfo.basePrefix)
if ($sourceRoot.Equals($outputPath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "The bootstrap Python cannot be the same directory as the runtime output."
}

if (Test-Path -LiteralPath $outputPath) {
  Remove-Item -LiteralPath $outputPath -Recurse -Force
}

New-Item -ItemType Directory -Path $outputPath | Out-Null

Get-ChildItem -LiteralPath $sourceRoot -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $outputPath
}

foreach ($directoryName in @("DLLs", "Lib")) {
  $sourceDirectory = Join-Path $sourceRoot $directoryName
  if (-not (Test-Path -LiteralPath $sourceDirectory)) {
    throw "The bootstrap Python is missing $sourceDirectory"
  }

  $destinationDirectory = Join-Path $outputPath $directoryName
  $robocopyArgs = @(
    $sourceDirectory,
    $destinationDirectory,
    "/E",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD",
    (Join-Path $sourceDirectory "site-packages"),
    "__pycache__",
    "/XF",
    "*.pyc",
    "*.pyo"
  )

  & robocopy.exe @robocopyArgs | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed while copying $directoryName with exit code $LASTEXITCODE."
  }
}

$runtimePython = Join-Path $outputPath "python.exe"
if (-not (Test-Path -LiteralPath $runtimePython)) {
  throw "The copied runtime does not contain python.exe."
}

& $runtimePython -m ensurepip --upgrade
if ($LASTEXITCODE -ne 0) {
  throw "Could not bootstrap pip in the packaged runtime."
}

& $runtimePython -m pip install --disable-pip-version-check --no-warn-script-location --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) {
  throw "Could not update pip tooling in the packaged runtime."
}

& $runtimePython -m pip install `
  --disable-pip-version-check `
  --no-warn-script-location `
  --index-url "https://download.pytorch.org/whl/cu126" `
  "torch==$TorchVersion" `
  "torchvision==$TorchvisionVersion"
if ($LASTEXITCODE -ne 0) {
  throw "Could not install the CUDA 12.6 PyTorch runtime."
}

& $runtimePython -m pip install `
  --disable-pip-version-check `
  --no-warn-script-location `
  "ultralytics==$UltralyticsVersion" `
  "lap==$LapVersion"
if ($LASTEXITCODE -ne 0) {
  throw "Could not install Pink Ward's YOLO dependencies."
}

Get-ChildItem -LiteralPath $outputPath -Recurse -Directory -Filter "__pycache__" |
  Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $outputPath -Recurse -File -Include "*.pyc", "*.pyo" |
  Remove-Item -Force

$torchInclude = Join-Path $outputPath "Lib\site-packages\torch\include"
if (Test-Path -LiteralPath $torchInclude) {
  Remove-Item -LiteralPath $torchInclude -Recurse -Force
}

Get-ChildItem -LiteralPath (Join-Path $outputPath "Lib\site-packages\torch\lib") -Filter "*.lib" -File -ErrorAction SilentlyContinue |
  Remove-Item -Force

$manifestScript = @"
import json
import platform
import cv2
import numpy
import torch
import torchvision
import ultralytics

if not torch.version.cuda:
    raise RuntimeError("The packaged PyTorch runtime is not CUDA-enabled.")

print(json.dumps({
    "python": platform.python_version(),
    "architecture": platform.machine(),
    "torch": torch.__version__,
    "torchvision": torchvision.__version__,
    "ultralytics": ultralytics.__version__,
    "opencv": cv2.__version__,
    "numpy": numpy.__version__,
    "cudaBundled": True,
    "cudaVersion": torch.version.cuda,
}, indent=2))
"@

$manifest = & $runtimePython -c $manifestScript
if ($LASTEXITCODE -ne 0) {
  throw "The packaged Python runtime failed its import smoke test."
}

$manifestPath = Join-Path $outputPath "pink-ward-runtime.json"
$manifest | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Host "Pink Ward Python runtime created at $outputPath"
Write-Host $manifest

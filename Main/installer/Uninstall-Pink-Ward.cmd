@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-Pink-Ward.ps1"
if errorlevel 1 (
  echo.
  echo Pink Ward uninstall failed.
  pause
  exit /b 1
)
endlocal

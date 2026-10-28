@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1
where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo Sayumi requires Windows 10 or newer and Windows PowerShell 5.1.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launcher.ps1" %*
if errorlevel 1 (
  echo Sayumi could not complete the operation. See the error above.
  pause
  exit /b 1
)
exit /b 0

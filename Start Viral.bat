@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-viral.ps1"
if errorlevel 1 (
  echo.
  echo Viral launcher stopped with an error. See the messages above.
  pause
)

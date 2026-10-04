@echo off
REM Double-click this file to start Local AI Chat on Windows.
REM The first time, it downloads Python and Ollama for you (nothing else to install).
cd /d "%~dp0"
if not exist "%~dp0launcher\start-windows.ps1" (
  echo.
  echo  Please extract the zip file first.
  echo  Right-click the zip, choose "Extract All...", then open the new folder
  echo  and double-click "Start Local AI Chat - Windows" again.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start-windows.ps1"
if errorlevel 1 pause

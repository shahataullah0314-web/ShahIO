@echo off
cd /d "%~dp0"
if exist "dist\win-unpacked\ShahIO.exe" (
  start "" "dist\win-unpacked\ShahIO.exe"
  exit /b
)
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b
)
echo ShahIO dependencies are missing. Run npm ci in this folder first.
pause

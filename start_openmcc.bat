@echo off
setlocal
cd /d "%~dp0"

echo [OpenMCC] Starting local server on http://localhost:8000/

where py >nul 2>nul
if %errorlevel%==0 (
    start "OpenMCC Server" /min cmd /c "cd /d \"%~dp0\" && py -m http.server 8000"
    goto :launch
)

where python >nul 2>nul
if %errorlevel%==0 (
    start "OpenMCC Server" /min cmd /c "cd /d \"%~dp0\" && python -m http.server 8000"
    goto :launch
)

echo [OpenMCC] Python was not found. Using built-in PowerShell fallback.

if not exist "%~dp0openmcc_server.ps1" (
    echo [OpenMCC] openmcc_server.ps1 was not found.
    pause
    exit /b 1
)

start "OpenMCC Server" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0openmcc_server.ps1" -Port 8000

:launch
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/"

endlocal

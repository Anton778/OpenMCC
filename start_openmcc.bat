@echo off
setlocal
cd /d "%~dp0"

set "OPENMCC_PORT=8765"

if not exist "%~dp0index.html" (
    echo [OpenMCC] ERROR: index.html was not found.
    echo [OpenMCC] Run this file from the OpenMCC repository folder.
    pause
    exit /b 1
)

where py >nul 2>nul
if %errorlevel%==0 (
    start "OpenMCC Server" /min py -3 -m http.server %OPENMCC_PORT% --bind 127.0.0.1
    goto :launch
)

where python >nul 2>nul
if %errorlevel%==0 (
    start "OpenMCC Server" /min python -m http.server %OPENMCC_PORT% --bind 127.0.0.1
    goto :launch
)

if not exist "%~dp0openmcc_server.ps1" (
    echo [OpenMCC] ERROR: Python and openmcc_server.ps1 were not found.
    pause
    exit /b 1
)

start "OpenMCC Server" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0openmcc_server.ps1" -Port %OPENMCC_PORT%

:launch
timeout /t 2 /nobreak >nul
start "" "http://localhost:%OPENMCC_PORT%/"

echo [OpenMCC] The interface is available at http://localhost:%OPENMCC_PORT%/
echo [OpenMCC] If the browser does not open, enter this address manually.
endlocal

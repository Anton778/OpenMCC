@echo off
setlocal
cd /d "%~dp0"

echo [OpenMCC] Starting local server on http://localhost:8000/

where py >nul 2>nul
if %errorlevel%==0 (
    start "OpenMCC Server" /min cmd /c "cd /d \"%~dp0\" && py -m http.server 8000"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        start "OpenMCC Server" /min cmd /c "cd /d \"%~dp0\" && python -m http.server 8000"
    ) else (
        echo Python was not found.
        echo Install Python 3 or start another local HTTP server manually.
        pause
        exit /b 1
    )
)

timeout /t 1 /nobreak >nul
start "" "http://localhost:8000/"

endlocal

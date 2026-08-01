@echo off
echo ========================================================
echo Starting Financial Transaction Visualizer Local Server
echo ========================================================
echo.

:: Check for python3
python3 --version >nul 2>&1
if %errorlevel% == 0 (
    echo Using Python 3...
    start http://localhost:8000
    python3 -m http.server 8000
    goto :end
)

:: Check for python
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Using Python...
    start http://localhost:8000
    python -m http.server 8000
    goto :end
)

echo Python is not installed or not in PATH.
echo.
echo If you have Node.js installed, you can try:
echo npx serve
echo.
echo Alternatively, you can just open index.html directly in your browser.
pause

:end

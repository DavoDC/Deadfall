@echo off
REM Starts the Vite dev server and opens the browser to it, similar to
REM Constellation's scripts\launch.bat. Port is fixed in config\vite.config.js.
set START_TIME=%TIME%
set PORT=5199
set LAUNCH_URL=http://localhost:%PORT%
cd /d "%~dp0.."

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found - install Node.js 18 or newer from https://nodejs.org
    if not "%1"=="--no-pause" cmd /k
    exit /b 1
)

if not exist "node_modules" (
    echo First run: installing dependencies with npm install ...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        if not "%1"=="--no-pause" cmd /k
        exit /b 1
    )
)

start "Deadfall Dev Server" cmd /c "npm run dev"

timeout /t 2 /nobreak >nul

REM Prefer Brave; falls back to the system default when Brave isn't found.
set BRAVE_EXE=
if exist "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" set BRAVE_EXE=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe
if exist "%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe" set BRAVE_EXE=%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe
if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" set BRAVE_EXE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe

if defined BRAVE_EXE (
    start "" "%BRAVE_EXE%" "%LAUNCH_URL%"
) else (
    start "" "%LAUNCH_URL%"
)

echo.
echo ============================================================
echo [DONE] Deadfall launched. Start: %START_TIME%  End: %TIME%
echo   Dev server: %LAUNCH_URL%
echo ============================================================
echo.
if not "%1"=="--no-pause" cmd /k

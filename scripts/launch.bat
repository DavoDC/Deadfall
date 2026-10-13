@echo off
setlocal EnableDelayedExpansion
REM Deadfall launcher: double-click to play. Safe to run again and again.
REM It installs Node.js and the game's packages only when they are missing,
REM starts the game server (once) and opens the game in your browser.
REM Flags: --no-pause (do not wait for a key at the end), --dry-run (print what
REM would be installed, change nothing). The port is fixed in app\config\vite.config.js.
set "START_TIME=%TIME%"
set "PORT=5199"
set "LAUNCH_URL=http://localhost:%PORT%"
set "APP=%~dp0..\app"
set "STAMP=%APP%\node_modules\.deadfall-install-stamp"
set "NOPAUSE="
set "DRYRUN="
for %%A in (%*) do (
    if /i "%%A"=="--no-pause" set "NOPAUSE=1"
    if /i "%%A"=="--dry-run" set "DRYRUN=1"
)

echo.
echo  ==============================
echo    DEADFALL  -  getting ready
echo  ==============================
echo.

if not exist "%APP%\package.json" (
    echo [PROBLEM] I cannot find the game files next to this launcher.
    echo Please unzip the whole Deadfall folder first, then open scripts\launch.bat from inside it.
    goto :fail
)

REM ---------- Step 1: Node.js ----------
echo [1/3] Checking Node.js...
call :check_node
if "%NODE_OK%"=="1" goto :node_ready

if defined DRYRUN (
    echo [DRY RUN] Node.js 18 or newer is missing here. I would now run:
    echo [DRY RUN]   winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    goto :end_ok
)

where winget >nul 2>nul
if errorlevel 1 (
    echo.
    echo [PROBLEM] This game needs Node.js, and I could not install it for you automatically.
    echo Please install it yourself: open https://nodejs.org , click the big green LTS button,
    echo run the installer, then double-click launch.bat again.
    goto :fail
)

echo       Installing Node.js (Windows may ask permission; click Yes).
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
call :refresh_path
call :check_node
if not "%NODE_OK%"=="1" (
    echo.
    echo [PROBLEM] Node.js was installed but this window cannot see it yet.
    echo Please close this window and double-click launch.bat again. That fixes it.
    goto :fail
)
echo       Node.js installed.

:node_ready
echo       Node.js %NODE_VER% OK.

REM ---------- Step 2: game packages ----------
echo [2/3] Checking game files...
set "NEED_INSTALL="
if not exist "%APP%\node_modules" set "NEED_INSTALL=1"
if not exist "%STAMP%" set "NEED_INSTALL=1"
if not defined NEED_INSTALL (
    powershell -NoProfile -Command "if ((Get-Item -LiteralPath ($env:APP + '\package-lock.json')).LastWriteTime -gt (Get-Item -LiteralPath $env:STAMP).LastWriteTime) { exit 1 }" >nul 2>nul
    if errorlevel 1 set "NEED_INSTALL=1"
)
if defined NEED_INSTALL (
    echo       First-time setup, a minute or two...
    REM Remove the stamp first so an interrupted install is always redone on the next run.
    del "%STAMP%" >nul 2>nul
    pushd "%APP%"
    call npm install --no-audit --no-fund --loglevel=error
    set "NPM_RC=!errorlevel!"
    popd
    if not "!NPM_RC!"=="0" (
        echo.
        echo [PROBLEM] The game's packages did not install. Check your internet connection and try again.
        goto :fail
    )
    echo installed %DATE% %TIME%> "%STAMP%"
) else (
    echo       Already set up.
)

REM ---------- Step 3: start the game ----------
echo [3/3] Starting the game...
call :server_up
if "%SERVER_UP%"=="1" goto :already_running
start "Deadfall Dev Server" /D "%APP%" cmd /c "npm run dev"
set "WAITED=0"
:wait_loop
call :server_up
if "%SERVER_UP%"=="1" goto :open_browser
if %WAITED% GEQ 40 goto :server_slow
"%SystemRoot%\System32\timeout.exe" /t 1 /nobreak >nul
set /a WAITED+=1
goto :wait_loop
:server_slow
echo       Slow start; opening your browser anyway.
goto :open_browser
:already_running
echo       Already running; opening it.

:open_browser
REM Prefer Brave; falls back to the system default browser when Brave isn't found.
set "BRAVE_EXE="
if exist "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" set "BRAVE_EXE=%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe" set "BRAVE_EXE=%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe"
if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" set "BRAVE_EXE=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
if defined BRAVE_EXE (
    start "" "%BRAVE_EXE%" "%LAUNCH_URL%"
) else (
    start "" "%LAUNCH_URL%"
)

:end_ok
echo.
echo ============================================================
echo Deadfall is opening in your browser (a few seconds): %LAUNCH_URL%
echo Close the black "Deadfall Dev Server" window to quit.
echo ============================================================
echo.
if not defined NOPAUSE pause
exit /b 0

:fail
echo.
if not defined NOPAUSE (
    echo Press any key to close this window.
    pause >nul
)
exit /b 1

REM ---------- helpers ----------
:check_node
set "NODE_OK=0"
set "NODE_VER="
where node >nul 2>nul || exit /b 0
where npm >nul 2>nul || exit /b 0
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
if not defined NODE_VER exit /b 0
set "NODE_MAJOR=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%m in ("%NODE_MAJOR%") do set "NODE_MAJOR=%%m"
set "NODE_VER=%NODE_VER:v=%"
if %NODE_MAJOR% GEQ 18 set "NODE_OK=1"
exit /b 0

:refresh_path
REM A fresh Node.js install is not on this window's PATH yet: re-read it from the registry and probe the default folder.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p;%PATH%"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
exit /b 0

:server_up
set "SERVER_UP=0"
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 set "SERVER_UP=1"
exit /b 0

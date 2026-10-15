@echo off
setlocal EnableDelayedExpansion
REM Deadfall launcher: double-click to play. Safe to run again and again.
REM It installs Node.js and the game's packages only when they are missing,
REM starts the game server (once, fully hidden, no extra window) and opens the game in your browser.
REM The game has a Quit button that stops the server. Logs: app\logs (launch-<date>.log = this script, server.log = the game server), process id: app\logs\server.pid.
REM Flags: --no-pause (do not wait at the end), --no-browser (start the server but do not open a browser; for tests), --dry-run (print what
REM would be installed, change nothing). The port is fixed in app\config\vite.config.js.
REM Clean-machine rule: only built-in Windows tools plus Node. Never assume git, bash or python.
REM The Windows folders go first on PATH so a same-named tool elsewhere can never shadow them.
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
REM Logging: the first run wraps itself so everything printed is also saved to app\logs\<name>-<date>.log (docs\Guides\LaunchAndUpdate.md).
if defined DF_LOGGED goto :logging_ready
if not exist "%~dp0..\app\src\tools\runlog.ps1" goto :logging_ready
set "DF_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\app\src\tools\runlog.ps1" -Name launch -Script "%~f0" -Root "%~dp0.."
exit /b %errorlevel%
:logging_ready
set "START_TIME=%TIME%"
set "PORT=5199"
if defined DEADFALL_PORT set "PORT=%DEADFALL_PORT%"
set "LAUNCH_URL=http://localhost:%PORT%"
for %%I in ("%~dp0..\app") do set "APP=%%~fI"
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "VERTOOL=%APP%\src\tools\version.ps1"
set "STAMP=%APP%\node_modules\.deadfall-install-stamp"
REM Output of npm and winget goes here, not on screen: the console shows short tidy lines only.
set "TOOLLOG=%APP%\logs\setup-tools.log"
set "NOPAUSE="
set "DRYRUN="
set "NOBROWSER="
for %%A in (%*) do (
    if /i "%%A"=="--no-pause" set "NOPAUSE=1"
    if /i "%%A"=="--dry-run" set "DRYRUN=1"
    if /i "%%A"=="--no-browser" set "NOBROWSER=1"
)

echo.
echo   ========================================
echo          DEADFALL  -  getting ready
echo   ========================================
echo.

REM Version (commit id + date): see docs\Guides\LaunchAndUpdate.md. A ZIP copy has it stamped in app\VERSION.
set "DF_SHA=unknown"
set "DF_DATE="
if exist "%VERTOOL%" (
    for /f "tokens=1,2" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%VERTOOL%" -Root "%ROOT%" 2^>nul') do (
        set "DF_SHA=%%a"
        set "DF_DATE=%%b"
    )
)
if "!DF_SHA!"=="unknown" (
    echo   Version: unknown ^(not a release copy^)
) else (
    echo   Version: !DF_SHA:~0,7! ^(!DF_DATE:~0,10!^)
)
echo.
call :dflog "[launch] version !DF_SHA! !DF_DATE!, port %PORT%"

if not exist "%APP%\package.json" (
    echo   [PROBLEM] I cannot find the game files next to this launcher.
    echo             Please unzip the whole Deadfall folder first, then open scripts\launch.bat from inside it.
    goto :fail
)

REM ---------- Step 1: Node.js ----------
echo   [1/3] Checking Node.js...
call :check_node
if "%NODE_OK%"=="1" goto :node_ready

if defined DRYRUN (
    echo   [DRY RUN] Node.js 18 or newer is missing here. I would now run:
    echo   [DRY RUN]   winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    echo.
    echo   Dry run only: nothing was installed or started.
    exit /b 0
)

where winget >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [PROBLEM] This game needs Node.js, and I could not install it for you automatically.
    echo             Please install it yourself: open https://nodejs.org , click the big green LTS button,
    echo             run the installer, then double-click launch.bat again.
    goto :fail
)

echo         Installing Node.js (Windows may ask permission; click Yes).
if not exist "%APP%\logs" mkdir "%APP%\logs" >nul 2>nul
>> "%TOOLLOG%" echo [%DATE% %TIME%] winget install Node.js
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements >> "%TOOLLOG%" 2>&1
call :refresh_path
call :check_node
if not "%NODE_OK%"=="1" (
    echo.
    echo   [PROBLEM] Node.js was installed but this window cannot see it yet.
    echo             Please close this window and double-click launch.bat again. That fixes it.
    goto :fail
)
echo         Node.js installed.

:node_ready
echo         Node.js %NODE_VER% OK.
call :dflog "[launch] Node.js %NODE_VER% ok"

REM ---------- Step 2: game packages ----------
echo   [2/3] Checking game files...
set "NEED_INSTALL="
if not exist "%APP%\node_modules" set "NEED_INSTALL=1"
if not exist "%STAMP%" set "NEED_INSTALL=1"
if not defined NEED_INSTALL (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Item -LiteralPath ($env:APP + '\package-lock.json')).LastWriteTime -gt (Get-Item -LiteralPath $env:STAMP).LastWriteTime) { exit 1 }" >nul 2>nul
    if errorlevel 1 set "NEED_INSTALL=1"
)
if defined NEED_INSTALL (
    echo         First-time setup, a minute or two...
    REM Remove the stamp first so an interrupted install is always redone on the next run.
    del "%STAMP%" >nul 2>nul
    pushd "%APP%"
    if not exist "%APP%\logs" mkdir "%APP%\logs" >nul 2>nul
    >> "%TOOLLOG%" echo [%DATE% %TIME%] npm install ^(game packages^)
    call npm install --no-fund --no-audit --loglevel=error --progress=false >> "%TOOLLOG%" 2>&1
    set "NPM_RC=!errorlevel!"
    popd
    if not "!NPM_RC!"=="0" (
        echo.
        echo   [PROBLEM] The game's packages did not install. Check your internet connection and try again.
        echo             The details are in: !TOOLLOG!
        goto :fail
    )
    echo installed %DATE% %TIME%> "%STAMP%"
    echo         Done.
) else (
    echo         Already set up.
)

REM Player mode (the default, app\config\launcher.json developerMode false) builds the game once and serves the built bundle;
REM developer mode runs the Vite dev server with hot reload. See docs\Guides\LaunchAndUpdate.md.
set "DEVMODE="
findstr /r /c:"\"developerMode\" *: *true" "%APP%\config\launcher.json" >nul 2>nul
if not errorlevel 1 set "DEVMODE=1"
if defined DEVMODE (call :dflog "[launch] mode: developer") else call :dflog "[launch] mode: player"
if not defined DEVMODE call :ensure_build
if "%BUILD_FAILED%"=="1" goto :fail

REM ---------- Step 3: start the game ----------
REM The server runs completely hidden (no black window) and stops with the Quit button in the game.
echo.
echo   [3/3] Starting the game...
call :server_up
if "%SERVER_UP%"=="1" goto :already_running
if not exist "%APP%\logs" mkdir "%APP%\logs" >nul 2>nul
>> "%APP%\logs\server.log" echo [%DATE% %TIME%] launch.bat starting the game server, version !DF_SHA! !DF_DATE!
set "VITE_CMD=preview"
if defined DEVMODE set "VITE_CMD="
set "DF_SERVER_ARGS=/c node node_modules\vite\bin\vite.js !VITE_CMD! --config config\vite.config.js >> logs\server.log 2>&1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:ComSpec -ArgumentList $env:DF_SERVER_ARGS -WorkingDirectory $env:APP -WindowStyle Hidden" >nul 2>nul
set "WAITED=0"
:wait_loop
call :server_up
if "%SERVER_UP%"=="1" goto :open_browser
if %WAITED% GEQ 30 goto :server_slow
REM ping is the wait: timeout.exe refuses to run when input is redirected.
"%SystemRoot%\System32\ping.exe" -n 2 127.0.0.1 >nul
set /a WAITED+=1
goto :wait_loop
:server_slow
echo.
echo   [PROBLEM] The game did not start within 30 seconds.
echo             Please double-click launch.bat again. If it keeps happening, the details are in:
echo             %APP%\logs\server.log
goto :fail
:already_running
echo         Already running; opening it.

:open_browser
if defined NOBROWSER goto :end_ok
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
call :dflog "[launch] server up: %SERVER_UP%, url %LAUNCH_URL%"
echo.
echo   ========================================
if defined NOBROWSER (
    echo     Deadfall is running at:
) else (
    echo     Deadfall is opening in your browser:
)
echo     %LAUNCH_URL%
echo.
echo     When you are done, press QUIT in the
echo     game. You can close this window now.
echo   ========================================
echo.
if not defined NOPAUSE (
    echo   Press any key to close this window.
    pause >nul
)
exit /b 0

:fail
call :dflog "[launch] stopped with a problem"
echo.
if not defined NOPAUSE (
    echo   Press any key to close this window.
    pause >nul
)
exit /b 1

REM ---------- helpers ----------
:dflog
REM Appends one detail line to the run log (set by runlog.ps1 in DF_LOGFILE); does nothing when run without the logger.
if not defined DF_LOGFILE exit /b 0
>> "%DF_LOGFILE%" echo %~1
exit /b 0

:ensure_build
REM Player mode: build the game only when there is no build yet or the sources are newer than the build stamp (update.bat deletes the stamp).
set "BUILD_FAILED=0"
set "BUILD_STAMP=%APP%\dist\.deadfall-build-stamp"
set "NEED_BUILD="
if not exist "%APP%\dist\index.html" set "NEED_BUILD=1"
if not exist "%BUILD_STAMP%" set "NEED_BUILD=1"
if not defined NEED_BUILD (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (Get-Item -LiteralPath $env:BUILD_STAMP).LastWriteTime; $n = @('index.html','package-lock.json','VERSION') | ForEach-Object { Get-Item -LiteralPath (Join-Path $env:APP $_) -ErrorAction SilentlyContinue }; $n += Get-ChildItem -LiteralPath (Join-Path $env:APP 'src'), (Join-Path $env:APP 'assets'), (Join-Path $env:APP 'config') -Recurse -File -ErrorAction SilentlyContinue; if (($n | Where-Object { $_.LastWriteTime -gt $s }).Count -gt 0) { exit 1 }" >nul 2>nul
    if errorlevel 1 set "NEED_BUILD=1"
)
if not defined NEED_BUILD exit /b 0
echo         Preparing the game, one moment...
del "%BUILD_STAMP%" >nul 2>nul
if not exist "%APP%\logs" mkdir "%APP%\logs" >nul 2>nul
>> "%TOOLLOG%" echo [%DATE% %TIME%] vite build ^(player mode^)
pushd "%APP%"
node node_modules\vite\bin\vite.js build --config config\vite.config.js >> "%TOOLLOG%" 2>&1
set "BUILD_RC=!errorlevel!"
popd
if not "!BUILD_RC!"=="0" (
    echo.
    echo   [PROBLEM] The game could not be prepared. Please run update.bat, then try again.
    echo             The details are in: !TOOLLOG!
    set "BUILD_FAILED=1"
    exit /b 0
)
echo built %DATE% %TIME%> "%BUILD_STAMP%"
echo         Done.
exit /b 0

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
for /f "usebackq delims=" %%p in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p;%PATH%"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
exit /b 0

:server_up
set "SERVER_UP=0"
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 set "SERVER_UP=1"
exit /b 0

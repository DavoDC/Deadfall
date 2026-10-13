@echo off
setlocal EnableDelayedExpansion
REM Deadfall updater: double-click to get the latest version of the game.
REM Works for a downloaded ZIP (downloads the newest ZIP and copies it over) and, for developers, a git clone (git pull, only if git is installed).
REM Your other files and the game's installed packages are never deleted.
REM Clean-machine rule: only built-in Windows tools plus Node. Never assume git, bash or python.
REM The Windows folders go first on PATH so a same-named tool elsewhere can never shadow them.
REM Flags: --no-pause (never wait for a key; questions default to No)
REM        --source "<folder>" (testing: copy the update from a local folder instead of GitHub; env DEADFALL_UPDATE_SOURCE does the same)
REM Safe self-update: this file copies itself to the temp folder and runs the copy, so it can be overwritten while "running".
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
REM Logging: the first run wraps itself so everything printed is also saved to app\logs\<name>-<date>.log (docs\Guides\LaunchAndUpdate.md).
if defined DF_LOGGED goto :logging_ready
if not exist "%~dp0..\app\src\tools\runlog.ps1" goto :logging_ready
set "DF_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\app\src\tools\runlog.ps1" -Name update -Script "%~f0" -Root "%~dp0.."
exit /b %errorlevel%
:logging_ready

if not "%DF_UPDATE_COPY%"=="1" (
    for %%I in ("%~dp0..") do set "DF_ROOT=%%~fI"
    set "DF_TMPRUN=%TEMP%\deadfall-update-run-%RANDOM%.bat"
    copy /y "%~f0" "!DF_TMPRUN!" >nul
    set "DF_UPDATE_COPY=1"
    call "!DF_TMPRUN!" %*
    set "DF_RC=!errorlevel!"
    del "!DF_TMPRUN!" >nul 2>nul
    exit /b !DF_RC!
)

set "ROOT=%DF_ROOT%"
set "NOPAUSE="
set "SRC=%DEADFALL_UPDATE_SOURCE%"
set "ZIPURL=https://github.com/DavoDC/Deadfall/archive/refs/heads/main.zip"
set "WORK=%TEMP%\deadfall-update"
set "STAMP=%ROOT%\app\node_modules\.deadfall-install-stamp"
set "LOCK=%ROOT%\app\package-lock.json"

:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--no-pause" set "NOPAUSE=1"
if /i "%~1"=="--source" (
    set "SRC=%~2"
    shift
)
shift
goto :parse_args
:args_done

echo.
echo   ========================================
echo             DEADFALL  -  updates
echo   ========================================
echo.

if not exist "%ROOT%\app\package.json" (
    echo   [PROBLEM] I cannot find the game files next to this updater.
    echo             Please open scripts\update.bat from inside the Deadfall folder.
    goto :fail
)

call :stop_server
if "%STOP_FAILED%"=="1" goto :fail
call :lock_hash
set "HASH_BEFORE=%LOCK_HASH%"
set "CHANGED_LINE="

if defined SRC goto :zip_mode
if not exist "%ROOT%\.git" goto :zip_mode
REM Git is optional (developers only). A friend's clean machine has none, so use the ZIP path then.
where git >nul 2>nul
if errorlevel 1 goto :zip_mode

REM ---------- git clone path ----------
echo   [1/3] Checking GitHub for the newest version...
for /f "delims=" %%h in ('git -C "%ROOT%" rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%h"
git -C "%ROOT%" pull --ff-only > "%TEMP%\deadfall-pull.txt" 2>&1
set "PULL_RC=%errorlevel%"
if not "%PULL_RC%"=="0" (
    type "%TEMP%\deadfall-pull.txt"
    del "%TEMP%\deadfall-pull.txt" >nul 2>nul
    echo.
    echo   I could not update in the usual way. This usually means files in this folder
    echo   were edited on this computer, or there is no internet connection.
    set "ASK=Download the newest ZIP and copy it over your files instead? (edited game files will be replaced)"
    call :ask_yes_no
    if "!ANSWER!"=="Y" goto :zip_mode
    echo   OK, nothing was changed.
    goto :fail
)
del "%TEMP%\deadfall-pull.txt" >nul 2>nul
for /f "delims=" %%h in ('git -C "%ROOT%" rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%h"
if "%OLD_HEAD%"=="%NEW_HEAD%" (
    set "CHANGED_LINE=You are already up to date."
) else (
    for /f "delims=" %%s in ('git -C "%ROOT%" diff --shortstat %OLD_HEAD% %NEW_HEAD% 2^>nul') do set "CHANGED_LINE=Updated:%%s."
    if not defined CHANGED_LINE set "CHANGED_LINE=Updated to the newest version."
)
echo   [2/3] Got the newest version.
goto :after_update

REM ---------- zip path ----------
:zip_mode
if exist "%WORK%" rmdir /s /q "%WORK%" >nul 2>nul
mkdir "%WORK%\extract" >nul 2>nul
set "NEWDIR="
if defined SRC (
    echo   [1/3] Using the update files from:
    echo         !SRC!
    if not exist "!SRC!\app\package.json" (
        echo   [PROBLEM] That folder does not look like a Deadfall folder.
        goto :fail
    )
    set "NEWDIR=!SRC!"
    goto :zip_copy
)
echo   [1/3] Downloading the newest version (a minute or so, please wait)... 
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:ZIPURL -OutFile ($env:WORK + '\main.zip'); Expand-Archive -LiteralPath ($env:WORK + '\main.zip') -DestinationPath ($env:WORK + '\extract') -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo.
    echo   [PROBLEM] The download did not work. Check your internet connection and try again.
    echo             Nothing on your computer was changed.
    goto :fail
)
for /d %%d in ("%WORK%\extract\*") do if not defined NEWDIR set "NEWDIR=%%~fd"
if not defined NEWDIR (
    echo   [PROBLEM] The downloaded file was empty. Please try again later.
    goto :fail
)
if not exist "%NEWDIR%\app\package.json" (
    echo   [PROBLEM] The downloaded file does not look like Deadfall. Nothing was changed.
    goto :fail
)

:zip_copy
REM If the incoming package-lock differs, drop the install stamp BEFORE copying so an interrupted copy still triggers a reinstall.
set "KEEP_LOCK=%LOCK%"
set "LOCK=%NEWDIR%\app\package-lock.json"
call :lock_hash
set "LOCK=%KEEP_LOCK%"
if not "%LOCK_HASH%"=="%HASH_BEFORE%" del "%STAMP%" >nul 2>nul
echo   [2/3] Updating your files (your installed game stays put)...
robocopy "%NEWDIR%" "%ROOT%" /E /XD node_modules captures dist .git /NJH /NJS /NDL /NP /NC /NS /R:1 /W:1 > "%WORK%\robocopy.txt"
set "ROBO_RC=%errorlevel%"
if %ROBO_RC% GEQ 8 (
    type "%WORK%\robocopy.txt"
    echo.
    echo   [PROBLEM] Some files could not be copied. Close the game and try again.
    goto :fail
)
set "COUNT=0"
REM robocopy exit code bit 1 = at least one file was copied (0 = nothing to do); robust, unlike counting log lines.
set /a "COUNT=ROBO_RC & 1"
set "CHANGED_LINE=Updated to the newest version."
if "%COUNT%"=="0" set "CHANGED_LINE=You are already up to date."
rmdir /s /q "%WORK%" >nul 2>nul

:after_update
echo   [3/3] Finishing up...
REM Player mode serves a built bundle: drop its build stamp so the next launch rebuilds from the new files.
if not "%CHANGED_LINE%"=="You are already up to date." del "%ROOT%\app\dist\.deadfall-build-stamp" >nul 2>nul
call :show_version
call :lock_hash
if not "%HASH_BEFORE%"=="%LOCK_HASH%" (
    del "%STAMP%" >nul 2>nul
    echo         launch.bat will refresh the game files next time.
)
echo.
echo   ========================================
echo     %CHANGED_LINE%
if defined NOW_LINE echo     !NOW_LINE!
echo   ========================================
echo.
if defined NOPAUSE exit /b 0
set "ASK=Start Deadfall now?"
call :ask_yes_no
if "%ANSWER%"=="Y" start "" "%ROOT%\scripts\launch.bat"
exit /b 0

:fail
echo.
if not defined NOPAUSE (
    echo   Press any key to close this window.
    pause >nul
)
exit /b 1

REM ---------- helpers ----------
:show_version
REM Reads the version after the update: a ZIP copy has it stamped in the freshly copied app\VERSION, a clone asks git.
set "NOW_LINE="
set "VSHA=unknown"
set "VDATE="
if not exist "%ROOT%\app\src\tools\version.ps1" exit /b 0
for /f "tokens=1,2" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\app\src\tools\version.ps1" -Root "%ROOT%" 2^>nul') do (
    set "VSHA=%%a"
    set "VDATE=%%b"
)
if "!VSHA!"=="unknown" exit /b 0
set "NOW_LINE=Now on version !VSHA:~0,7! (!VDATE:~0,10!)"
exit /b 0

:stop_server
REM A running (hidden) game server would keep its files locked: close it first.
set "STOP_FAILED=0"
set "PORT=5199"
if defined DEADFALL_PORT set "PORT=%DEADFALL_PORT%"
set "PIDFILE=%ROOT%\app\logs\server.pid"
call :port_busy
if "%BUSY%"=="0" exit /b 0
echo   Deadfall is running, so I am closing it first. Your progress is saved in the browser.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri ('http://localhost:' + $env:PORT + '/api/quit') -TimeoutSec 5 | Out-Null } catch {}; Start-Sleep -Seconds 2; if (Test-Path -LiteralPath $env:PIDFILE) { $p = Get-Process -Id ([int](Get-Content -LiteralPath $env:PIDFILE)) -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }" >nul 2>nul
set "TRIES=0"
:stop_wait
call :port_busy
if "%BUSY%"=="0" exit /b 0
if %TRIES% GEQ 10 goto :stop_stuck
REM ping is the wait: timeout.exe refuses to run when input is redirected.
"%SystemRoot%\System32\ping.exe" -n 2 127.0.0.1 >nul
set /a TRIES+=1
goto :stop_wait
:stop_stuck
echo.
echo   [PROBLEM] I could not close the running game. Press QUIT in the game, then run update.bat again.
set "STOP_FAILED=1"
exit /b 0

:port_busy
set "BUSY=0"
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 set "BUSY=1"
exit /b 0

:ask_yes_no
set "ANSWER=N"
if defined NOPAUSE exit /b 0
echo.
echo   %ASK%
choice /c YN /n /m "  Press Y for yes or N for no: "
if errorlevel 2 exit /b 0
set "ANSWER=Y"
exit /b 0

:lock_hash
set "LOCK_HASH=none"
if not exist "%LOCK%" exit /b 0
for /f "delims=" %%h in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash -LiteralPath $env:LOCK -Algorithm SHA256).Hash"') do set "LOCK_HASH=%%h"
exit /b 0

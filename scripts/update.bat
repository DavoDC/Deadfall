@echo off
setlocal EnableDelayedExpansion
REM Deadfall updater: double-click to get the latest version of the game.
REM Works for a git clone (git pull) and for a downloaded ZIP (downloads the newest ZIP and copies it over).
REM Your other files and the game's installed packages are never deleted.
REM Flags: --no-pause (never wait for a key; questions default to No)
REM        --source "<folder>" (testing: copy the update from a local folder instead of GitHub; env DEADFALL_UPDATE_SOURCE does the same)
REM Safe self-update: this file copies itself to the temp folder and runs the copy, so it can be overwritten while "running".

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
echo  ==============================
echo    DEADFALL  -  checking for updates
echo  ==============================
echo.

if not exist "%ROOT%\app\package.json" (
    echo [PROBLEM] I cannot find the game files next to this updater.
    echo Please open scripts\update.bat from inside the Deadfall folder.
    goto :fail
)

call :lock_hash
set "HASH_BEFORE=%LOCK_HASH%"
set "CHANGED_LINE="

if defined SRC goto :zip_mode
if not exist "%ROOT%\.git" goto :zip_mode

REM ---------- git clone path ----------
echo [1/3] Your copy came from GitHub with git; asking GitHub for the newest version...
where git >nul 2>nul
if errorlevel 1 (
    echo       Git is not installed on this computer.
    set "ASK=Install Git automatically (needs Windows 10/11 and a minute or two)?"
    call :ask_yes_no
    if "!ANSWER!"=="Y" (
        where winget >nul 2>nul
        if errorlevel 1 (
            echo       I cannot install Git automatically here, so I will download the ZIP instead.
            goto :zip_mode
        )
        winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
        call :refresh_path
        if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;!PATH!"
    )
    where git >nul 2>nul
    if errorlevel 1 (
        echo       I will download the newest ZIP instead of using git.
        goto :zip_mode
    )
)
for /f "delims=" %%h in ('git -C "%ROOT%" rev-parse HEAD 2^>nul') do set "OLD_HEAD=%%h"
git -C "%ROOT%" pull --ff-only > "%TEMP%\deadfall-pull.txt" 2>&1
set "PULL_RC=%errorlevel%"
if not "%PULL_RC%"=="0" (
    type "%TEMP%\deadfall-pull.txt"
    del "%TEMP%\deadfall-pull.txt" >nul 2>nul
    echo.
    echo       I could not update in the usual way. This usually means files in this folder
    echo       were edited on this computer, or there is no internet connection.
    set "ASK=Download the newest ZIP and copy it over your files instead? (edited game files will be replaced)"
    call :ask_yes_no
    if "!ANSWER!"=="Y" goto :zip_mode
    echo       OK, nothing was changed.
    goto :fail
)
del "%TEMP%\deadfall-pull.txt" >nul 2>nul
for /f "delims=" %%h in ('git -C "%ROOT%" rev-parse HEAD 2^>nul') do set "NEW_HEAD=%%h"
if "%OLD_HEAD%"=="%NEW_HEAD%" (
    set "CHANGED_LINE=You already have the newest version."
) else (
    for /f "delims=" %%s in ('git -C "%ROOT%" diff --shortstat %OLD_HEAD% %NEW_HEAD% 2^>nul') do set "CHANGED_LINE=Updated:%%s."
    if not defined CHANGED_LINE set "CHANGED_LINE=Updated to the newest version."
)
echo [2/3] Downloaded the newest version with git.
goto :after_update

REM ---------- zip path ----------
:zip_mode
if exist "%WORK%" rmdir /s /q "%WORK%" >nul 2>nul
mkdir "%WORK%\extract" >nul 2>nul
set "NEWDIR="
if defined SRC (
    echo [1/3] Using the update files from: %SRC%
    if not exist "%SRC%\app\package.json" (
        echo [PROBLEM] That folder does not look like a Deadfall folder.
        goto :fail
    )
    set "NEWDIR=%SRC%"
    goto :zip_copy
)
echo [1/3] Downloading the newest version from GitHub...
powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:ZIPURL -OutFile ($env:WORK + '\main.zip'); Expand-Archive -LiteralPath ($env:WORK + '\main.zip') -DestinationPath ($env:WORK + '\extract') -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
    echo.
    echo [PROBLEM] The download did not work. Check your internet connection and try again.
    echo Nothing on your computer was changed.
    goto :fail
)
for /d %%d in ("%WORK%\extract\*") do if not defined NEWDIR set "NEWDIR=%%~fd"
if not defined NEWDIR (
    echo [PROBLEM] The downloaded file was empty. Please try again later.
    goto :fail
)
if not exist "%NEWDIR%\app\package.json" (
    echo [PROBLEM] The downloaded file does not look like Deadfall. Nothing was changed.
    goto :fail
)

:zip_copy
echo [2/3] Copying the new files in ^(your other files and installed packages are left alone^)...
robocopy "%NEWDIR%" "%ROOT%" /E /XD node_modules captures dist .git /NJH /NJS /NDL /NP /NC /NS /R:1 /W:1 > "%WORK%\robocopy.txt"
set "ROBO_RC=%errorlevel%"
if %ROBO_RC% GEQ 8 (
    type "%WORK%\robocopy.txt"
    echo.
    echo [PROBLEM] Some files could not be copied. Close the game and try again.
    goto :fail
)
set "COUNT=0"
for /f %%n in ('findstr /R /C:"[A-Za-z0-9]" "%WORK%\robocopy.txt" ^| find /c /v ""') do set "COUNT=%%n"
set "CHANGED_LINE=Updated: %COUNT% game files refreshed from the newest version."
if "%COUNT%"=="0" set "CHANGED_LINE=You already have the newest version."
rmdir /s /q "%WORK%" >nul 2>nul

:after_update
echo [3/3] Finishing up...
call :lock_hash
if not "%HASH_BEFORE%"=="%LOCK_HASH%" (
    del "%STAMP%" >nul 2>nul
    echo       The game's packages changed; launch.bat will refresh them on its next start.
)
echo.
echo ============================================================
echo [DONE] %CHANGED_LINE%
echo ============================================================
echo.
if defined NOPAUSE exit /b 0
set "ASK=Start Deadfall now?"
call :ask_yes_no
if "%ANSWER%"=="Y" start "" "%ROOT%\scripts\launch.bat"
exit /b 0

:fail
echo.
if not defined NOPAUSE (
    echo Press any key to close this window.
    pause >nul
)
exit /b 1

REM ---------- helpers ----------
:ask_yes_no
set "ANSWER=N"
if defined NOPAUSE exit /b 0
echo.
echo %ASK%
choice /c YN /n /m "Press Y for yes or N for no: "
if errorlevel 2 exit /b 0
set "ANSWER=Y"
exit /b 0

:lock_hash
set "LOCK_HASH=none"
if not exist "%LOCK%" exit /b 0
for /f "delims=" %%h in ('powershell -NoProfile -Command "(Get-FileHash -LiteralPath $env:LOCK -Algorithm SHA256).Hash"') do set "LOCK_HASH=%%h"
exit /b 0

:refresh_path
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%p;%PATH%"
exit /b 0

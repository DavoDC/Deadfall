@echo off
setlocal EnableDelayedExpansion
REM Deadfall log saver: double-click to put one ZIP of logs on your Desktop to send to the game's owner.
REM It only reads files on this computer and writes one new ZIP; it never sends anything anywhere and never changes the game.
REM Each run makes a new dated ZIP. The work is done by app\src\tools\save-logs.ps1 (it scrubs your user name and user folder path).
REM Flags: --no-pause (do not wait at the end). Env for tests only: DEADFALL_NO_EXPLORER=1 (do not open Explorer).
REM Clean-machine rule: only built-in Windows tools plus Node. Never assume git, bash or python.
REM The Windows folders go first on PATH so a same-named tool elsewhere can never shadow them.
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
REM Logging: the first run wraps itself so everything printed is also saved to app\logs\<name>-<date>.log (docs\Guides\LaunchAndUpdate.md).
if defined DF_LOGGED goto :logging_ready
if not exist "%~dp0..\app\src\tools\runlog.ps1" goto :logging_ready
set "DF_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\app\src\tools\runlog.ps1" -Name save-logs -Script "%~f0" -Root "%~dp0.."
exit /b %errorlevel%
:logging_ready
set "NOPAUSE="
for %%A in (%*) do (
    if /i "%%A"=="--no-pause" set "NOPAUSE=1"
)
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "TOOL=%ROOT%\app\src\tools\save-logs.ps1"

echo.
echo   ========================================
echo           DEADFALL  -  saving logs
echo   ========================================
echo.

if not exist "%TOOL%" goto :nofiles

echo   Collecting these into one ZIP:
echo         - which version of the game you have
echo         - your Windows version, graphics card and screen size
echo         - the game's log and your recent play sessions
echo         Your user name and user folder are removed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TOOL%" -Root "%ROOT%"
if errorlevel 1 goto :failed

echo.
echo   ========================================
echo     Saved to your Desktop. Nothing was
echo     sent anywhere. Please send me this file.
echo   ========================================
echo.
if not defined NOPAUSE (
    echo   Press any key to close this window.
    pause >nul
)
exit /b 0

:nofiles
echo   [PROBLEM] I cannot find the game files next to this script.
echo             Please open scripts\save-logs.bat from inside the Deadfall folder.
goto :fail

:failed
echo.
echo   [PROBLEM] I could not make the ZIP. Please tell me what this window says.

:fail
echo.
if not defined NOPAUSE (
    echo   Press any key to close this window.
    pause >nul
)
exit /b 1

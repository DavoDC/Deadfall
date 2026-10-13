# Launch and update

How the two Windows launchers in `scripts/` work, and how to test them by hand. Both are written for non-technical players.

## Player steps

Windows only (the launchers are `.bat` files). Requirements: Windows 10 or 11, a modern browser (Brave, Chrome, Edge or Firefox), and Node.js 18 or newer (`launch.bat` installs Node for you through winget if it is missing). The README deliberately says only "Windows 10 or 11 and a modern browser".

1. Click the green Code button, choose Download ZIP, and unzip it anywhere.
2. Double-click `scripts\launch.bat`. First run installs what the game needs (a minute or two), then it starts the game and opens it in your browser. Next time it starts straight away.

Windows may show an "unknown publisher" (SmartScreen) warning on a downloaded `.bat`: click More info, then Run anyway (the README keeps this one line). The game server runs hidden: there is no black window to keep open or close. Press QUIT in the game (title screen or ESC menu) when you are done.

Updating: double-click `scripts\update.bat` in the same folder. Game progress lives in the browser (local storage), so do not update mid-round: the dev server reloads on file changes and could interrupt a run. Players are never asked to install git or clone; a git clone is a developer route only.

## Works on a clean Windows machine

Both scripts use only built-in Windows tools plus Node.js (which `launch.bat` installs through winget): never assume git, bash or python. Each script puts `%SystemRoot%\System32`, `%SystemRoot%` and `%SystemRoot%\System32\WindowsPowerShell\v1.0` first on its own `PATH`, so a same-named tool elsewhere cannot shadow `findstr`, `netstat`, `robocopy`, `choice`, `where` or `powershell`. Every `powershell` call passes `-NoProfile -ExecutionPolicy Bypass` and sticks to PowerShell 5.1 syntax. Waiting uses `ping.exe` because `timeout.exe` refuses to run when input is redirected. Install folders with spaces and parentheses (such as `Deadfall-main (2)`) work: paths are always quoted, and text inside `if (...)` blocks uses `!VAR!` rather than `%VAR%`. Git is optional: update.bat uses it only if `where git` finds it and a `.git` folder exists.

Tested (2026-10-13) with `PATH` reduced to `C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Program Files\nodejs` (no git or bash directories) in copies without `.git` named `Deadfall-main (2) test` and `Deadfall main spaced test`, started from `C:\Windows` as the working directory: `launch.bat --no-pause` installed packages and served HTTP 200 on 5199, a second run said "Already set up" and "Already running", `update.bat --no-pause` closed the running server and then did a real ZIP download, extract and copy (exit 0), and `update.bat --no-pause --source "<folder with (3) in its name>"` printed "You are already up to date." With `node` missing from `PATH`, `launch.bat --dry-run` printed the winget command. SmartScreen and antivirus prompts cannot be controlled by the scripts.

## launch.bat

Safe to run repeatedly. Steps, in order:

1. Node.js: needs version 18 or newer. If `node`/`npm` is missing or too old it runs `winget install --id OpenJS.NodeJS.LTS`, then refreshes `PATH` from the registry (and probes `%ProgramFiles%\nodejs`). If Node is still invisible it tells the player to close the window and double-click again. With no winget it points to https://nodejs.org.
2. Packages: `npm install` runs only when `app\node_modules` is missing, the stamp file is missing, or `app\package-lock.json` is newer than the stamp. The stamp is `app\node_modules\.deadfall-install-stamp`, written after a successful install. Fast path (already set up) skips all of this.
3. Server and browser: if something already listens on port 5199 the server is not started a second time; otherwise the Vite server is started fully hidden (`powershell Start-Process` of a hidden `cmd /c node node_modules\vite\bin\vite.js ...`, stdout and stderr appended to `app\captures\launcher.log`), it polls up to 30 s for the port, opens the browser (Brave if present, else the default) and closes its own window. If the server never answers it stays open with a plain-English message and the log path.

Flags: `--no-pause` (no waiting for a key) and `--dry-run` (if Node is missing, print the winget command instead of running it).

## Hidden server, Quit and idle exit

- The server writes its own PID to `app\captures\server.pid` (node process, removed on exit) and lifecycle lines (listening, quit requested, idle exit) to stdout, which the launcher redirects to `app\captures\logs\server.log`. Both are gitignored.
- The page pings GET /api/ping every 30 s (not logged). POST /api/quit (the Quit button) answers 204 and then the process exits; it only accepts loopback sockets with a localhost Host and Origin (403 otherwise). Both endpoints are in the lifecycle plugin in app/config/vite.config.js, for the dev and the preview server, and are skipped under vitest.
- Idle exit: if no page pings for DEADFALL_IDLE_MINUTES (default 10, fractions allowed) the server exits itself, so a closed tab never leaves an orphan. A developer running npm run dev gets the same behaviour.
- Stuck server by hand: run `curl.exe -X POST http://localhost:5199/api/quit`, or kill the node process whose id is in server.pid (`taskkill /F /PID <id>`).
- update.bat closes a running server first (asks /api/quit, falls back to the PID file, checks port 5199 is free) so files are not locked.

## update.bat

Runs from a temp copy of itself so overwriting `scripts\update.bat` mid-run is safe.

- Git clone (repo has `.git` and `git` exists): `git pull --ff-only`. If git is missing (the normal case for players) it goes straight to the ZIP path, never asking to install anything. If the pull is blocked (local edits, no network) it explains in plain English and uses the ZIP path only after an explicit Y.
- Downloaded ZIP (no `.git`): downloads `https://github.com/DavoDC/Deadfall/archive/refs/heads/main.zip` with PowerShell (TLS 1.2), extracts to a temp folder, and copies over the repo root with `robocopy /E`. Nothing is deleted, and `node_modules`, `captures`, `dist` and `.git` are never touched. The temp folder is removed afterwards.
- If `app\package-lock.json` changed, the install stamp is deleted so the next `launch.bat` reinstalls packages.
- Flags: `--no-pause` (questions default to No, nothing is started), `--source "<folder>"` or the `DEADFALL_UPDATE_SOURCE` environment variable (copy from a local folder instead of GitHub, for testing).

## Idempotency

Both scripts are safe to run any number of times. A rerun when nothing needs doing changes nothing and ends cleanly.

- `launch.bat` checks: Node.js 18 or newer is on `PATH` (installs only if not); `app\node_modules` and the stamp exist and the stamp is newer than `app\package-lock.json` (runs `npm install` only if not); something already listens on port 5199 (starts a server only if not). A rerun therefore just opens the browser.
- The stamp `app\node_modules\.deadfall-install-stamp` is deleted before `npm install` and written only after it succeeds, so a killed install leaves no stamp and the next run redoes it.
- `update.bat` is a no-op when already current: git says "Already up to date", and the ZIP path copies only files that differ (robocopy skips same size and time). It then prints "You are already up to date." If the incoming `package-lock.json` differs, the stamp is deleted before copying, so an interrupted copy is completed by a rerun and packages are reinstalled by the next `launch.bat`.
- The ZIP path decides "changed or not" from the robocopy exit code (bit 1 = a file was copied), not from counting log lines: robocopy also lists identical files, so line counting never reports 0.
- Verified evidence (2026-10-13): in a fresh clone `update.bat --no-pause` twice printed "already up to date" with a clean `git status`; in a ZIP-style copy (no `.git`) with `--source`, run 1 printed "Updated to the newest version." and run 2 "You are already up to date." with the `node_modules`, `captures` and `dist` marker files untouched; a real download of the main ZIP extracted to the `Deadfall-main` top folder and copied in (the download plus extract takes tens of seconds); in the fresh clone `launch.bat` run 1 installed packages and started the server (HTTP 200 on 5199), run 2 took under a second, printed "Already set up" and "Already running", left the stamp mtime unchanged, started no second listener and changed no file hash outside `node_modules`.
- Rule for changes: keep this contract, and re-verify any script change by running it twice and comparing `git status` plus a file-hash listing.

## Saving logs and versions

Playtesters double-click `scripts\save-logs.bat` and send back one file. It never touches the network, never changes the game, and each run writes a new `Deadfall-logs-<yyyy-MM-dd_HHmm>.zip` (a `-2`, `-3` suffix if the minute is taken) to the real Desktop (OneDrive redirection is handled; the repo folder is the fallback), then opens Explorer with it selected. With no playtest data yet it still saves the system info and says so. Flags: `--no-pause`; for tests only the environment variable `DEADFALL_NO_EXPLORER=1` skips Explorer and `DEADFALL_LOGS_MAX_MB` overrides the 25 MB cap. The batch file is a thin wrapper; the work is `app\src\tools\save-logs.ps1` (PowerShell 5.1, .NET zip, no extra tools).

What is in the ZIP:

- `VERSION.txt`: commit sha and date, or "unknown (not a release copy)".
- `system.txt`: Windows version and build, CPU, RAM, GPU name(s) with driver and resolution, screens, default browser id, Node.js version, locale, time zone. No user name, machine name, IP, MAC, serial or paths.
- `logs\`: every `*.log` in `app\captures\logs\` (see "Central logs" below), the last 5000 lines of each, scrubbed.
- `telemetry\session-*.json` and `telemetry\frames\<startedAt>\*.jpg`: at most the newest 10 sessions, newest first, with their screenshots, until the size cap (default 25 MB) is reached. Older sessions and extra frames are skipped and the counts are written to `README.txt`. `latest.json` is a duplicate and is left out.
- `README.txt`: explains each file.

Privacy scrubbing is done on copies in a temp folder (removed afterwards), never on the originals: a case-insensitive replace of the user profile path (backslash, slash and JSON-escaped forms) with `%USERPROFILE%`, then of the user name and computer name with `<removed>`. Names shorter than 3 characters are not replaced on their own (they would shred ordinary words); the profile path replacement still covers them inside paths.

### Central logs

`launch.bat`, `update.bat` and `save-logs.bat` each wrap themselves in `app\src\tools\runlog.ps1` (the first run only; `DF_LOGGED=1` stops a second wrap), which shows the output live and also appends it to `app\captures\logs\<script>-<yyyy-MM-dd>.log`. Every run starts with a timestamped header (script, arguments, version, Windows, PowerShell, Node.js) and ends with `exit code N`; on a non-zero exit the window prints `The details were saved to: <path>`. Any log in the folder over about 1 MB is trimmed to its newest half at the start of the next run. The hidden game server writes `server.log` in the same folder. Only built-in tools are used, nothing touches the network, and the folder is gitignored (it lives under `captures`). If PowerShell cannot start the wrapper the scripts still run, just unlogged.

### Version stamping

The version is the commit sha. `app\VERSION` is tracked with the content `$Format:%H %cI$` and `.gitattributes` has `app/VERSION export-subst`, so GitHub's Download ZIP (which runs `git archive`) expands it to `<40-hex sha> <commit date>`. A git clone or dev checkout keeps the literal placeholder. The reader (`app/src/server/version.js` for the server, `app/src/tools/version.ps1` for the .bat scripts, kept in step by tests) uses the stamped sha when present, otherwise `git rev-parse HEAD` and `git log -1 --format=%cI` if git exists, otherwise "unknown (not a release copy)".

It shows up in: the `Version: <short sha> (<date>)` line under the launch.bat banner and a version line in `server.log`; the server's startup log line; `GET /api/version` (JSON `sha, date, short, label, source`, computed once at server start, on the dev and preview servers); the browser console line `[deadfall] version <sha> <date>`; a dim footer on the title screen; the `gameVersion` field of every telemetry session JSON (`version` there is already the schema number); and the "Now on version <short sha>" line at the end of update.bat. A ZIP-mode update on a git clone would overwrite the placeholder with a stamped file and show as a local change; use `git pull` there.

### How the owner reads a zip

Unzip it and read `VERSION.txt` first (does the sha match the build you expect?), then `system.txt` for hardware, `launcher.log` for start-up trouble, and the session JSON with `app/src/tools/analyse-telemetry.mjs` (copy the files into `app/captures/telemetry/` of a scratch checkout). The screenshots sit next to the session id they belong to.

## Manual test checklist

1. Fresh clone: run `scripts\launch.bat --no-pause`; confirm packages install, the stamp appears, `http://localhost:5199` answers. Run it again: no install, no second server. Stop the server afterwards.
2. ZIP folder (no `.git`): run `scripts\update.bat --no-pause --source <folder>`, then once without `--source` in a throwaway scripts-only copy; confirm `node_modules` and `captures` survive.
3. Clone: run `scripts\update.bat --no-pause`; confirm a friendly "newest version" or "Updated" line.
4. Missing Node: with `PATH` reduced to the Windows folders, run `scripts\launch.bat --no-pause --dry-run`; it should print the winget command.

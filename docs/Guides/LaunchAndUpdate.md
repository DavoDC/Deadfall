# Launch and update

How the two Windows launchers in `scripts/` work, and how to test them by hand. Both are written for non-technical players.

## Player steps

Windows only (the launchers are `.bat` files). Requirements: Windows 10 or 11, a modern browser (Brave, Chrome, Edge or Firefox), and Node.js 18 or newer (`launch.bat` installs Node for you through winget if it is missing). The README deliberately says only "Windows 10 or 11 and a modern browser".

1. Click the green Code button, choose Download ZIP, and unzip it anywhere.
2. Double-click `scripts\launch.bat`. First run installs what the game needs (a minute or two), then it starts the game and opens it in your browser. Next time it starts straight away.

Windows may show an "unknown publisher" (SmartScreen) warning on a downloaded `.bat`: click More info, then Run anyway (the README keeps this one line). The browser tab can stay blank for a few seconds while the server starts, and closing the black "Deadfall Dev Server" window quits the game; `launch.bat` prints both hints on screen.

Updating: double-click `scripts\update.bat` in the same folder. Game progress lives in the browser (local storage), so do not update mid-round: the dev server reloads on file changes and could interrupt a run. Players are never asked to install git or clone; a git clone is a developer route only.

## launch.bat

Safe to run repeatedly. Steps, in order:

1. Node.js: needs version 18 or newer. If `node`/`npm` is missing or too old it runs `winget install --id OpenJS.NodeJS.LTS`, then refreshes `PATH` from the registry (and probes `%ProgramFiles%\nodejs`). If Node is still invisible it tells the player to close the window and double-click again. With no winget it points to https://nodejs.org.
2. Packages: `npm install` runs only when `app\node_modules` is missing, the stamp file is missing, or `app\package-lock.json` is newer than the stamp. The stamp is `app\node_modules\.deadfall-install-stamp`, written after a successful install. Fast path (already set up) skips all of this.
3. Server and browser: if something already listens on port 5199 the server is not started a second time; the browser (Brave if present, else the default) is just opened.

Flags: `--no-pause` (no waiting for a key) and `--dry-run` (if Node is missing, print the winget command instead of running it).

## update.bat

Runs from a temp copy of itself so overwriting `scripts\update.bat` mid-run is safe.

- Git clone (repo has `.git` and `git` exists): `git pull --ff-only`. If git is missing it offers to install it with winget (`Git.Git`), else it falls back to the ZIP path. If the pull is blocked (local edits, no network) it explains in plain English and uses the ZIP path only after an explicit Y.
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

## Manual test checklist

1. Fresh clone: run `scripts\launch.bat --no-pause`; confirm packages install, the stamp appears, `http://localhost:5199` answers. Run it again: no install, no second server. Stop the server afterwards.
2. ZIP folder (no `.git`): run `scripts\update.bat --no-pause --source <folder>`, then once without `--source` in a throwaway scripts-only copy; confirm `node_modules` and `captures` survive.
3. Clone: run `scripts\update.bat --no-pause`; confirm a friendly "newest version" or "Updated" line.
4. Missing Node: with `PATH` reduced to the Windows folders, run `scripts\launch.bat --no-pause --dry-run`; it should print the winget command.

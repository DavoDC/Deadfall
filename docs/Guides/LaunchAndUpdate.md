# Launch and update

How the two Windows launchers in `scripts/` work, and how to test them by hand. Both are written for non-technical players.

## Player steps

Requirements: Windows 10 or 11, a modern browser (Brave, Chrome, Edge or Firefox), and Node.js 18 or newer (`launch.bat` installs Node for you if it is missing).

1. Download this repo: click the green `<> Code` button at the top of the GitHub page, then **Download ZIP**, and unzip it anywhere (right-click, Extract All).
2. Double-click `scripts\launch.bat`. First run installs what the game needs (a minute or two), then it starts the game and opens it in your browser. Next time it starts straight away.

Windows may show an "unknown publisher" warning on a downloaded `.bat`: click **More info**, then **Run anyway**. The browser tab can stay blank for a few seconds while the server starts. To quit, close the black launcher window.

Updating: download the ZIP again, or double-click `scripts\update.bat`. Game progress lives in the browser, so updating never loses it. Players are never asked to install git or clone; a git clone is a developer route only.
How the two Windows launchers in `scripts/` work, and how to test them by hand. Both are written for non-technical players: double-click, read friendly status lines, done.

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

## Manual test checklist

1. Fresh clone: run `scripts\launch.bat --no-pause`; confirm packages install, the stamp appears, `http://localhost:5199` answers. Run it again: no install, no second server. Stop the server afterwards.
2. ZIP folder (no `.git`): run `scripts\update.bat --no-pause --source <folder>`, then once without `--source` in a throwaway scripts-only copy; confirm `node_modules` and `captures` survive.
3. Clone: run `scripts\update.bat --no-pause`; confirm a friendly "newest version" or "Updated" line.
4. Missing Node: with `PATH` reduced to the Windows folders, run `scripts\launch.bat --no-pause --dry-run`; it should print the winget command.

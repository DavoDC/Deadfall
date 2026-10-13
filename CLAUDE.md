# Deadfall

Browser first-person PVE extraction shooter. Vanilla JS, Three.js, Vite, vitest. Needs [Node.js](https://nodejs.org) 18 or newer.

## Commands

The npm project lives in `app/`; run everything from there.

- Any platform: `cd app`, `npm install` once, then `npm run dev` (opens http://localhost:5199), `npm run build`, `npm test` (the unit suite)
- Windows: double-click `scripts\launch.bat` (idempotent: installs Node.js via winget and npm packages only when needed). `scripts\update.bat` fetches the latest (git pull for a clone, ZIP download otherwise). The server runs hidden (log app\captures\launcher.log, PID app\captures\server.pid); the in-game Quit button (POST /api/quit) stops it, and it exits itself after 10 idle minutes. update.bat stops it first. Players use the ZIP route; git clone is a developer route.
- Headless bot: `node src/tools/playtest.mjs --runs 1`
- Critic sweep: `node src/tools/critic.mjs` (reports land in gitignored `app/captures/critic/`)

Scripts are idempotent: safe to rerun; keep it that way, changes must be re-verified by running twice. Clean-machine rule: scripts use only built-in Windows tools plus Node; never assume git, bash, python.

## Folder map

- Repo root: `.gitignore`, `LICENSE`, `README.md`, `CLAUDE.md`, `docs/`, `scripts/`, `app/` only
- `app/`: `package.json`, `index.html`, `config/` (Vite and vitest config), `assets/` (Vite publicDir), `src/` (game code, `src/tools/` dev tools), `tests/`
- `scripts/` end-user `launch.bat` and `update.bat` only; `docs/Guides|References|Images` documentation

## Docs

- [docs/References/DevContext.md](docs/References/DevContext.md): index of every doc, folder map, how to run tests, rules and invariants.
- [docs/Guides/LaunchAndUpdate.md](docs/Guides/LaunchAndUpdate.md): how launch.bat and update.bat work and how to test them.
- [docs/Guides/HeadlessPlaytest.md](docs/Guides/HeadlessPlaytest.md): the headless bot and the `window.__deadfall` API.
- [docs/Guides/ScreenshotRig.md](docs/Guides/ScreenshotRig.md): deterministic before/after screenshots for art changes.
- [docs/References/Engineering.md](docs/References/Engineering.md): how the game is built.
- [docs/References/GameFeatures.md](docs/References/GameFeatures.md): everything in the jungle.

## Invariants

- `app/src/game/sim.js` has zero DOM, GPU or audio dependencies; it must run in plain Node.
- The level is one seeded analytic height function; unit tests pin the no-straight-line rules.
- `app/tests/layout.test.js` pins the layout and doc naming conventions.
- Docs: capitalised single-word folders, PascalCase file names, no em or en dashes, one paragraph per line.
- Generated output goes in gitignored `app/captures/`.
- Change code, tests and docs together in one commit.

*Built with Claude: round 1 (2026-07-11) was one autonomous session; later rounds answered human playtests with real challenge, FPS feel, the fever-dream look, the headless tooling, physical geography, the Miremother, live weather, the deception layer and the trip.*

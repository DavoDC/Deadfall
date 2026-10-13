# Deadfall

Browser first-person PVE extraction shooter. Vanilla JS, Three.js, Vite, vitest.

## Commands

- `npm install` once, then `npm run dev` (http://localhost:5199), `npm run build`, `npm test`
- Headless bot: `node src/tools/playtest.mjs --runs 1`
- Critic sweep: `node src/tools/critic.mjs` (reports land in gitignored `captures/critic/`)

## Folder map

- `config/` Vite and vitest config, `assets/` static files (Vite publicDir)
- `src/` game code, `src/tools/` dev tools (`once_off/`, `textures/` inside)
- `scripts/` end-user `launch.bat` only
- `tests/` vitest, `docs/Guides|References|Images` documentation
- Full index and rules: `docs/References/DevContext.md`

## Invariants

- `src/game/sim.js` has zero DOM, GPU or audio dependencies; it must run in plain Node.
- The level is one seeded analytic height function; unit tests pin the no-straight-line rules.
- Repo root stays minimal; `tests/layout.test.js` pins the layout and doc naming conventions.
- Docs: capitalised single-word folders, PascalCase file names, no em or en dashes, one paragraph per line.
- Generated output goes in gitignored `captures/`.
- Change code, tests and docs together in one commit.

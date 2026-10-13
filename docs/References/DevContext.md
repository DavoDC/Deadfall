# Developer context

Orientation for anyone working on Deadfall: where things live, how to run them, and the rules that keep the codebase honest.

## Doc index

| File | What it holds |
|---|---|
| [../../README.md](../../README.md) | Player-facing overview: how to play, controls, difficulties |
| [../../CLAUDE.md](../../CLAUDE.md) | Short developer orientation for AI coding assistants |
| [GameFeatures.md](GameFeatures.md) | The full tour of what is in the jungle: geography, boss, weather, hunters, director, arsenal |
| [Engineering.md](Engineering.md) | How the game is built: height function, sim/presentation split, instancing, audio |
| [TelemetryV2Spec.md](TelemetryV2Spec.md) | Spec of the playtest flight recorder (input, game state, visual channels) |
| [DevContext.md](DevContext.md) | This file: doc index, folder map, commands, invariants |
| [../Guides/HeadlessPlaytest.md](../Guides/HeadlessPlaytest.md) | Running the bot headlessly and the `window.__deadfall` API |
| [../Guides/ScreenshotRig.md](../Guides/ScreenshotRig.md) | Deterministic screenshots for before/after art grading |
| [../../assets/textures/CREDITS.md](../../assets/textures/CREDITS.md) | CC0 texture provenance |

## Folder map

| Path | Purpose |
|---|---|
| `index.html` | Vite entry page |
| `config/` | Vite and vitest configuration (`vite.config.js`) |
| `assets/` | Static files served at the site root (Vite `publicDir`), currently the CC0 textures |
| `scripts/` | End-user launcher only (`launch.bat`) |
| `src/` | Game code: `audio`, `capture`, `core`, `enemies`, `game`, `player`, `render`, `server`, `weapons`, `world` |
| `src/tools/` | Developer tools: `playtest.mjs`, `critic.mjs`, `analyse-telemetry.mjs`; `once_off/` debug scripts; `textures/` Python texture helpers |
| `tests/` | Vitest suite, including `layout.test.js` which pins the repo conventions |
| `docs/Guides/` | Procedures a person follows |
| `docs/References/` | Facts and reasoning |
| `docs/Images/` | Images used by the docs and README |
| `captures/` | Gitignored output of playtests, telemetry and screenshots |

## Commands

```
npm install                                  # once
npm run dev                                  # dev server on http://localhost:5199
npm run build                                # production build into dist/
npm test                                     # full vitest suite
node src/tools/playtest.mjs --runs 1         # headless bot, all routes
node src/tools/critic.mjs --runs 2           # the game critic, writes reports under captures/critic/
node src/tools/analyse-telemetry.mjs         # digest of captures/telemetry
```

## Rules and invariants

- `src/game/sim.js` has zero DOM, GPU or audio dependencies. It must keep running in plain Node.
- The level is one seeded analytic height function; the no-straight-line invariants are unit tests.
- Simulation consumes input intents and entities are plain serializable state.
- Keep `scripts/` to `launch.bat` only; tools go under `src/tools/`.
- Doc folders are single capitalised words, doc files are PascalCase with acronyms fully capitalised. `tests/layout.test.js` enforces this.
- No em or en dashes and no absolute user paths in docs.
- Generated output goes in gitignored `captures/`, never in the repo root.
- Change code, tests and docs in the same commit.

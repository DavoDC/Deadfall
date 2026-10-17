# Engineering

Geometry, creatures and audio are synthesized at runtime (the only binary assets are six CC0 PBR texture sets):

- One seeded analytic height function IS the level - gorge, crossings, mesa and all. Ground collision anywhere is an exact function sample; the no-straight-line invariants are unit tests.
- Sim/presentation split: the same `createSim` drives the browser game, the in-page bot, and plain-Node headless runs at ~1000x real time.
- Tens of thousands of plants as a handful of `InstancedMesh` draw calls; wind sway injected into the standard material's vertex shader; measured 180fps in Brave with the full jungle rendering.
- All audio is WebAudio synthesis: gunshots, explosions, creature calls per species, positional panning, and a reactive ambience mixed against danger.
- Multiplayer-shaped: simulation consumes input intents, entities are plain serializable state, so a future P2P co-op layer drops in without a rewrite.

- Spawns are two layers: the reactive threat director (time, noise, progress north) and authored route encounter slots (`src/game/routeEncounters.js`, per-difficulty counts as data) that guarantee every hunter type appears along any main route. `node src/tools/routeCoverage.mjs` walks each route headlessly with seeded randomness and tabulates, per type, how many enemies come within 40 m and 70 m and at what percent of the route each is first met; `tests/routeCoverage.test.js` asserts the guarantee.

Vanilla JS + Three.js + Vite. `npm test` for the unit suite.
- The FALLEN GIANT trunk (ridge crossing) is solid: `fallenGiantColliders` in app/src/world/props.js lays vertical collider cylinders along its hull, the open flank beside it stays passable (tests/props.test.js), and its bark material is double-sided so it never vanishes from inside.
- Startup profile (dev only): open the game on the Vite dev server or with `?bootprofile` on a preview build and the console prints `[deadfall] boot profile` (also `window.__bootProfile`), the milliseconds per boot step from `app/src/game/bootTiming.js`: module load, renderer and sky, terrain mesh, water, vegetation, props, water env map, sim and the first frame's render (shader compile). Measured in headless Chrome with software GL on 2026-10-17: terrain mesh about 650 ms and vegetation about 460 ms of main-thread CPU, imports about 180 ms, renderer and sky about 270 ms; the env map and first render were GPU-bound there (seconds) so measure those in a real browser before changing them.

# Engineering

Geometry, creatures and audio are synthesized at runtime (the only binary assets are six CC0 PBR texture sets):

- One seeded analytic height function IS the level - gorge, crossings, mesa and all. Ground collision anywhere is an exact function sample; the no-straight-line invariants are unit tests.
- Sim/presentation split: the same `createSim` drives the browser game, the in-page bot, and plain-Node headless runs at ~1000x real time.
- Tens of thousands of plants as a handful of `InstancedMesh` draw calls; wind sway injected into the standard material's vertex shader; measured 180fps in Brave with the full jungle rendering.
- All audio is WebAudio synthesis: gunshots, explosions, creature calls per species, positional panning, and a reactive ambience mixed against danger.
- Multiplayer-shaped: simulation consumes input intents, entities are plain serializable state, so a future P2P co-op layer drops in without a rewrite.

Vanilla JS + Three.js + Vite. `npm test` for the unit suite.

# Deadfall

**A first-person PVE extraction shooter in an Amazonian fever-dream that hunts
you back - in your browser.**

One run, one question: which way north? Insert at the southern treeline and
pick your way through a world that is all walls and choices - a mountain
Palisade with three gates, a flooded razorfin gorge with three sills, a
highlands cliff with two ways up - while storms, fog banks and the threat
director hunt you. At the end, a flooded moat, the thing that lives in it,
and one drowned stair to the extraction beacon. Die or extract - either way
the run is a complete story.

## Play

```
npm install
npm run dev        # opens on http://localhost:5199
```

WASD move · mouse look · **RMB aim down sights** · Shift sprint · LMB fire ·
R reload · 1/2/3/Q weapons · G grenade (hold to arc, release to throw) ·
V machete · Space jump · ESC pause

Three difficulties: **RECRUIT** (learn the jungle), **HUNTER** (the intended
run), **DEADFALL** (extraction is a rumour).

## What's in the jungle

- **Geography is the antagonist.** THE PALISADE - an unclimbable mountain
  wall - crosses the south, pierced only at the Howling Gate, Rivergate
  Canyon and the Skyreach Saddle. The flooded gorge cuts the middle (three
  sills; razorfins eat swimmers). THE FRACTURE steps the north up 9m of
  cliff, passable at Bonebridge (a colossal ribcage) or the Scree. Walls of
  strangler thicket stagger every lane. The straight line is not risky - it
  is physically impossible, and that is a unit test.
- **THE MIREMOTHER.** The extraction butte is ringed by cliffs; its single
  drowned stair climbs out of the Sunken Maw - the flooded moat where the
  apex serpent waits. Her hood opens before she strikes: the tell is the
  crit window. At 66% and 33% she dives, and a foam wake hunts you. Kill
  her for a feast, or sprint the stair past her and live with the venom.
- **Live weather that plays.** Storms swallow your gunfire (the director
  barely hears shots under thunder), fog banks ruin the hunters' tracking,
  lightning walks the canopy. Weather rolls DURING the run.
- **A deceptive jungle.** Viperblossoms - flowers until you stand next to
  them. Snapjaw bone traps seeded beside tempting loot. Dart totems wired
  across the very corridors the geography forces you through. Trust
  nothing pretty.
- **Six hunters + the fauna's tells:** Prowlers flank in pairs, Spitters
  SWELL as you wound them, Stingerwing swarms, Canopy Shrikes (dangerous
  only airborne), Bloomcallers scream reinforcements in, the Juggernaut's
  bone plate deflects - shoot the boil on its back. Orange hitmarkers mean
  you found a weakpoint.
- **A threat director**, not spawn timers - escalates with time, noise and
  PROGRESS; garrisons whichever gate, sill or way you approach; throttles
  itself during the boss fight so the fight IS the fight; and answers your
  extraction call with waves pouring up the stair.
- **An arsenal with opinions, held by alien hands.** Auto carbine, pump
  breacher (watch the off-hand work the pump), and the LONGARM - carried
  empty; its ammo is loot, and it auto-chambers the first find. Real ADS,
  frag grenades with an arc preview, a machete that never runs dry.
- **Ayahuasca is a real trip.** Drink the vine: the world warps and
  breathes, the jungle writhes, and every creature GLOWS THROUGH the
  foliage - x-ray perception, 25 seconds, on top of speed and healing.
- **Named ground.** The Rapids, Cinder Fang, Bonebridge, the Sunken Maw -
  location reveals as you discover them, and an ember-tipped spire you can
  navigate by from anywhere in the north.
- **The birds know first.** Birdsong thins as something closes in; below it
  a drone swells. The silence is the warning.

## Headless playtest API

The whole game runs without a browser - `src/game/sim.js` is the complete
simulation with zero DOM/GPU/audio dependencies, and the playtest bot is a
competent artificial player (ADS at range, engagement triage, medkit runs,
dodges committed charges).

```
node scripts/playtest.mjs                          # bot runs, all routes
node scripts/playtest.mjs --route ridge --difficulty hard --runs 3
node scripts/playtest.mjs --matrix --runs 4        # routes x difficulties
node scripts/playtest.mjs --matrix --out TEMP/balance.json
```

Each run reports outcome, time, kills, shots, grenades, ammo economy, an hp
timeline, a position trail, and **damage by source** - balance is tuned with
numbers, not vibes. A 36-run matrix takes ~13 seconds.

In the browser, the same surface hangs off `window.__deadfall`:

| Call | What it does |
|---|---|
| `setDifficulty('easy'\|'normal'\|'hard')` | select difficulty |
| `startRun()` / `startSimRun()` | full presentation run / silent sim-only run |
| `step(intent, dt)` | advance the sim one intent-driven step (no pointer lock needed) |
| `teleport(x, z)` | drop the player anywhere |
| `god(true)` / `give('ammo'\|'grenade')` | invincibility / supplies |
| `snapshot()` | full dynamic state as compact JSON |
| `runBot(route, {difficulty})` | complete autonomous run, returns the metrics report |

### Screenshot rig (before/after grading for art changes)

The `shots` API captures pixel-perfect deterministic screenshots of eight canonical vantage points across all three moods (bloom, gold, violet). All non-deterministic elements are frozen (wind sway, weather RNG, particles, HUD, effects) so two runs are identical except for art/lighting changes. Use this to grade major overhauls objectively.

```
// In the browser console:
window.__deadfall.shots.captureShots()                          # all 3 moods x 8 vantages
window.__deadfall.shots.captureShots({ mood: 'bloom' })         # single mood
await window.__deadfall.shots.downloadShots(shots)              # save PNG + contact sheet

// Or via URL param (auto-boots, captures, downloads):
http://localhost:5199?shots=1
```

Vantages cover: insertion beach, dense jungle (west), river crossing, gorge lip, ridge vista, mountain peak (Cinder Fang), boss basin (Sunken Maw), and extraction mesa. Contact sheet tiles all vantages with labels for quick visual review.

## Engineering

Everything is synthesized at runtime - **zero art or audio assets**:

- One seeded analytic height function IS the level - gorge, crossings, mesa
  and all. Ground collision anywhere is an exact function sample; the
  no-straight-line invariants are unit tests.
- Sim/presentation split: the same `createSim` drives the browser game, the
  in-page bot, and plain-Node headless runs at ~1000x real time.
- Tens of thousands of plants as a handful of `InstancedMesh` draw calls;
  wind sway injected into the standard material's vertex shader; measured
  180fps in Brave with the full jungle rendering.
- All audio is WebAudio synthesis: gunshots, explosions, creature calls per
  species, positional panning, and a reactive ambience mixed against danger.
- Multiplayer-shaped: simulation consumes input intents, entities are plain
  serializable state, so a future P2P co-op layer drops in without a rewrite.

Vanilla JS + Three.js + Vite. `npm test` for the unit suite.

*Round 1 built the game in one autonomous Claude (Fable 5) session
(2026-07-11); round 2 (2026-07-12) answered the human playtest - real
challenge, real FPS feel, the fever-dream look, and the headless tooling.
Round 3 (2026-07-13, the Fable finale) rebuilt the world as physical
geography, added the Miremother, live weather, the deception layer and the
trip - with Sonnet subagents building to Fable's specs in parallel.
See `docs/HISTORY.md` for the evidence.*

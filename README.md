# Deadfall

**A first-person PVE extraction shooter in an Amazonian fever-dream that hunts
you back - in your browser.**

One run, one question: which way across the gorge? Insert at the southern
treeline, push north through a vibrant hostile jungle, cross the razorfin
rift at one of three garrisoned sills, and climb the mesa to hold the
extraction beacon while everything the jungle has left comes for you. Die or
extract - either way the run is a complete story.

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

- **The gorge.** A flooded rift cuts the whole map. Three crossings - the
  root causeway (swamp), the rapids (river), the fallen giant (ridge) - and
  the director garrisons the one you approach. The blood-red water is not a
  warning, it is a promise: razorfins eat swimmers. There is no straight
  line to extraction.
- **Six hunters** with readable tells: Prowlers (indigo shadow-cats that
  flank in pairs), Spitters (acid sacs brighten before the lob - and they
  visibly SWELL and speed up as you wound them: end fights fast),
  Stingerwings (glass wasps, a blizzard in numbers), Canopy Shrikes (only
  dangerous airborne - sidestep the pounce, punish the landing),
  Bloomcallers (walking orchids that scream reinforcements down on you;
  their core is exposed only mid-scream), and the Juggernaut (bone face
  plate DEFLECTS - bait the charge and shoot the amber boil on its back).
- **Weakpoints matter.** Sacs, boils, blooming cores - orange hitmarkers
  mean you found one.
- **A threat director**, not spawn timers. The jungle escalates with time,
  with noise, and with PROGRESS - the deep north is hot no matter how
  quietly you got there. Calling extraction commits you to a melee surge
  you cannot un-ring.
- **An arsenal with opinions.** Auto carbine, pump breacher, and the LONGARM
  marksman rifle - carried empty; its ammunition is loot at the watchful
  places. Real ADS on every gun (the LONGARM aims through glass), frag
  grenades with a physics arc preview, and a machete that never runs dry.
- **Ayahuasca at the shrines.** Drink the vine: twenty seconds of speed,
  free sprint, knitting flesh, and a world that saturates and breathes.
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
challenge, real FPS feel, the fever-dream look, and this headless tooling.
See `docs/HISTORY.md` for the evidence.*

# Headless playtest API

The whole game runs without a browser - `src/game/sim.js` is the complete simulation with zero DOM/GPU/audio dependencies, and the playtest bot is a competent artificial player (ADS at range, engagement triage, medkit runs, dodges committed charges).

```
node src/tools/playtest.mjs                          # bot runs, all routes
node src/tools/playtest.mjs --route ridge --difficulty hard --runs 3
node src/tools/playtest.mjs --matrix --runs 4        # routes x difficulties
node src/tools/playtest.mjs --matrix --out TEMP/balance.json
```

Run these from `app/` (`cd app` first).

Each run reports outcome, time, kills, shots, grenades, ammo economy, an hp timeline, a position trail, and **damage by source** - balance is tuned with numbers, not vibes. A 36-run matrix takes ~13 seconds.

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

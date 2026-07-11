# Deadfall

**A first-person PVE extraction shooter in a jungle that hunts you back - in your browser.**

One run, a few minutes, one question: do you take the exposed riverbed, the
high ridge, or the drowned swamp? Insert at the southern treeline, push north
through dense hostile jungle, and hold the extraction beacon while everything
the jungle has left comes for you. Die or extract - either way the run is a
complete story.

## Play

```
npm install
npm run dev        # opens on http://localhost:5199
```

WASD move · mouse look · Shift sprint · LMB fire · R reload · 1/2/Q swap weapon · Space jump

## What's in the jungle

- **Three viable routes** to the beacon: the river (fast, open, exposed), the
  eastern ridge (high ground, long sightlines, thin cover), the western swamp
  (slow, dark, rich in supplies). The whole map is walkable - these are just
  the shapes the terrain suggests.
- **Three hunters** with readable tells: Prowlers (fast, zigzag, lunge - you
  hear the growl first), Spitters (their glowing acid sacs brighten before
  they fire - dodge the arc), and the Juggernaut (bone face plate in the fog,
  a charge you can bait into a tree to stun it).
- **A threat director**, not spawn timers. The jungle escalates with time and
  with noise - every shot you fire is a decision. Calling extraction commits
  you to a surge you cannot un-ring.
- **The birds know first.** Ambient birdsong thins out as something closes in;
  below it a drone swells. The silence is the warning.
- **Scarcity that bites.** Two weapons (auto carbine, pump shotgun with
  shell-by-shell interruptible reload), finite ammo, medkits you'll wish you'd
  saved. Looting the risky places is the economy.

## Engineering

Everything is synthesized at runtime - **zero art or audio assets**:

- One seeded analytic height function IS the level: ground collision anywhere
  is an exact function sample. No physics engine, no navmesh - and the whole
  map fits in a unit test.
- ~50k plants as a handful of `InstancedMesh` draw calls; wind sway injected
  into the standard material's vertex shader; whole scene renders in ~1ms CPU.
- All audio is WebAudio synthesis: gunshots, reload foley, creature calls,
  positional 3D panning, and a reactive ambience mixed live against danger.
- An autonomous playtest bot (`window.__deadfall.runBot('ridge')`) plays real
  runs through the public game systems - route completability and balance are
  regression-tested with numbers, not vibes.
- Multiplayer-shaped: simulation consumes input intents, entities are plain
  serializable state, so a future P2P co-op layer drops in without a rewrite.

Vanilla JS + Three.js + Vite. `npm test` for the unit suite.

*Built in a single autonomous Claude (Fable 5) session, 2026-07-11 - see
`docs/HISTORY.md` for what shipped and the honest verdict, `docs/fable-brief.md`
for the brief it was built against.*

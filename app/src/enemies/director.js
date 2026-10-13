// The threat director - the invisible antagonist. Threat rises with time
// (the reason to hurry), with PROGRESS NORTH (the deep jungle does not care
// how quietly you got there), and with noise (every gunshot is a decision).
// It buys squad recipes from a budget and places them ahead of and flanking
// the player, outside line of sight, so contact always feels like an ambush.
// Gorge crossings get garrisoned when you approach - the sills are the
// jungle's tollgates.

import { hasLOS } from '../world/colliders.js';
import {
  terrainHeight, gorgeZ, palisadeZ, fractureZ, isThicket, WORLD,
} from '../world/heightmap.js';
import { clamp, lerp } from '../core/noise.js';
import { slotsCrossed, slotAt, slotGroup, slotFlora } from '../game/routeEncounters.js';

// Every place the world forces you through is a tollgate the jungle can
// garrison: gorge sills (round 2), plus the round-3 gates and fracture ways.
const CHOKEPOINTS = [
  ...WORLD.crossings.map((c) => ({ x: c.x, z: () => gorgeZ(c.x), name: c.name })),
  ...WORLD.gates.map((g) => ({ x: g.x, z: () => palisadeZ(g.x), name: g.name })),
  { x: WORLD.bonebridge.x, z: () => fractureZ(WORLD.bonebridge.x), name: WORLD.bonebridge.name },
  { x: WORLD.scree.x, z: () => fractureZ(WORLD.scree.x), name: WORLD.scree.name },
];

const COSTS = {
  prowler: 1, stingerwing: 0.6, spitter: 2, shrike: 2, bloomcaller: 3, juggernaut: 5,
};

// Extraction surge: the final stand is a WAVE, not a siege. Melee-weighted
// recipes - you can fight a horde off the beacon; you cannot out-stand
// artillery you are forced to hold still inside.
const SURGE_SQUADS = [
  { min: 0, recipe: [['prowler', 2]] },
  { min: 0, recipe: [['stingerwing', 4]] },
  { min: 0, recipe: [['prowler', 1], ['stingerwing', 3]] },
  { min: 0.5, recipe: [['shrike', 2]] },
  { min: 0.6, recipe: [['juggernaut', 1]] },
  { min: 0.7, recipe: [['prowler', 2], ['shrike', 1]] },
];

// Squad recipes unlock by threat tier. The director prefers the freshest
// unlocked recipes so fights change texture as the run deepens.
const SQUADS = [
  { min: 0.0, recipe: [['prowler', 1]] },
  { min: 0.12, recipe: [['prowler', 2]] },
  { min: 0.22, recipe: [['stingerwing', 5]] },
  { min: 0.3, recipe: [['spitter', 1], ['prowler', 1]] },
  { min: 0.4, recipe: [['shrike', 1], ['prowler', 1]] },
  { min: 0.5, recipe: [['bloomcaller', 1], ['prowler', 1]] },
  { min: 0.58, recipe: [['juggernaut', 1]] },
  { min: 0.68, recipe: [['spitter', 2], ['stingerwing', 3]] },
  { min: 0.78, recipe: [['shrike', 2], ['spitter', 1]] },
  { min: 0.88, recipe: [['juggernaut', 1], ['stingerwing', 4]] },
];

// Directional wave telegraph (root cause 4): a spawn is never IN the
// player's view (the universal `if (hasLOS...) continue` a few lines
// down), so the fix is not to make ambushes visible - it is to tell the
// player WHICH WAY one is coming from, so first contact reads as "brace,
// incoming from the north" instead of "deleted from offscreen." World
// convention: -Z is north (WORLD.insertion.z is large positive, the south
// start; WORLD.extraction.z is deep negative, the north end), +X is east.
// Pure and exported so it is unit-tested directly.
export function compassBearing(dx, dz) {
  const ang = Math.atan2(dx, -dz);
  const deg = ((ang * 180 / Math.PI) + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export function createDirector(enemyMgr, playerHelpers, opts = {}) {
  const { furthestNorthPlayer, nearestPlayer } = playerHelpers;
  const onWave = opts.onWave || (() => {});
  const onForeshadow = opts.onForeshadow || (() => {});
  let lastSpawnPos = null;
  const d = {
    time: 0,
    heat: 0,          // noise-driven, decays
    surge: false,     // extraction channel active
    tickT: 18,        // opening grace - let the jungle breathe first
    budget: 1,
    spawned: {},
    diff: null,       // difficulty object, set via setDifficulty
    // 0..1, how far through the extraction hold the player has survived -
    // fed by sim.js (updateExtraction) every frame while committed. This is
    // the in-hold escalation ramp (extraction-hold design notes,
    // root cause 2/3): the final stand BUILDS across the hold instead of
    // slamming to its ceiling the instant the player commits.
    holdProgress: 0,
    // authored route encounters (game/routeEncounters.js): highest progress
    // seen so far, slots waiting for a valid spawn spot, and what has fired
    slotProgress: 0,
    slotQueue: [],
    slotsFired: [],
  };

  function setDifficulty(diff) {
    d.diff = diff;
  }

  function setHoldProgress(frac) {
    d.holdProgress = clamp(frac, 0, 1);
  }

  let weatherRef = null;
  function setWeather(weather) {
    weatherRef = weather;
  }

  function progressNorth() {
    const a = WORLD.insertion.z;
    const b = WORLD.extraction.z;
    const pz = furthestNorthPlayer().pos.z;
    return clamp((a - pz) / (a - b), 0, 1);
  }

  function threat() {
    const rampTime = d.diff ? d.diff.rampTime : 330;
    const timeRamp = clamp(d.time / rampTime, 0, 1);
    // deep north is hot no matter how fast you got there
    const base = Math.max(timeRamp, progressNorth() * 0.82);
    // the surge bonus now BUILDS across the hold (0.08 -> 0.4) instead of
    // slamming in at a flat +0.35 the instant extraction is committed -
    // root cause 2: base alone is already ~0.7-0.8 the moment the player
    // reaches the beacon (progressNorth is maxed), so the old flat bonus
    // pinned threat at its ceiling on frame one. This mainly nudges cap()
    // and the budget-regen rate (see below); WHICH squads are available is
    // gated separately by surgeIntensity(), not this raw threat value.
    const surgeBonus = d.surge ? lerp(0.08, 0.4, d.holdProgress) : 0;
    return clamp(base * 0.85 + d.heat + surgeBonus, 0, 1.3);
  }

  // Gates WHICH surge squads are purchasable, independent of world threat.
  // Early hold = light contact only (prowler/stingerwing skirmishes, min 0
  // in SURGE_SQUADS); the melee-weighted and juggernaut recipes (min
  // 0.5-0.7) only unlock as the player survives further into the hold, so
  // the danger MIX escalates toward the climax instead of the full recipe
  // book being available the instant the surge starts (root cause 2/3).
  function surgeIntensity() {
    if (!d.surge) return 0;
    return clamp(0.1 + d.holdProgress * 0.9, 0, 1);
  }

  function onShot() {
    // noise nudges the jungle, it does not command it - and a storm
    // swallows most of it (weather is a mechanic, not just a mood)
    const gain = d.diff ? d.diff.heatGain : 1;
    const wMult = weatherRef ? weatherRef.mods().heatMult : 1;
    d.heat = Math.min(0.18, d.heat + 0.008 * gain * wMult);
  }

  function cap() {
    const t = threat();
    const bonus = d.diff ? d.diff.capBonus : 0;
    // while the apex hunts you in her moat, the jungle holds its breath -
    // the boss fight is the fight (trash trickles, not floods)
    const bossCut = d.bossFight ? 2 : 0;
    return Math.max(1, Math.round(2 + t * (d.surge ? 7 : 4.5)) + bonus - bossCut);
  }

  // The chokepoint the player is currently approaching from the south, if
  // any - the far side gets garrisoned. Gates, sills and fracture ways are
  // all tollgates now.
  function approachedCrossing() {
    const pp = furthestNorthPlayer().pos;
    let best = null;
    let bestD = 75;
    for (const c of CHOKEPOINTS) {
      const cz = c.z();
      if (pp.z < cz + 8) continue; // already through (north of it)
      const dd = Math.hypot(pp.x - c.x, pp.z - cz);
      if (dd < bestD) {
        bestD = dd;
        best = { x: c.x, cz };
      }
    }
    return best;
  }

  // find a spawn point: ring around player, biased toward their heading,
  // no line of sight, on land, inside the playable area. When the player
  // approaches a gorge crossing, the far bank gets garrisoned.
  function findSpawnPos() {
    const pdata = furthestNorthPlayer();
    const pp = pdata.pos;
    const yaw = pdata.yaw;
    const crossing = approachedCrossing();
    for (let i = 0; i < 16; i++) {
      let x;
      let z;
      if (crossing && Math.random() < 0.45) {
        // hold the far side of the chokepoint they are heading for
        x = crossing.x + (Math.random() - 0.5) * 26;
        z = crossing.cz - 12 - Math.random() * 18;
      } else if (d.surge && Math.random() < 0.6) {
        // the final stand: waves pour UP THE STAIR toward the beacon, so
        // they actually arrive (spawning under the mesa cliffs would strand
        // them). Spawn along the stair-wedge azimuth from the mesa centre.
        const ex = WORLD.extraction;
        const stairAz = Math.atan2(WORLD.maw.x - ex.x, WORLD.maw.z - ex.z)
          + (Math.random() - 0.5) * 0.9;
        const r = 26 + Math.random() * 26;
        x = ex.x + Math.sin(stairAz) * r;
        z = ex.z + Math.cos(stairAz) * r;
      } else {
        const biasAhead = Math.random() < 0.6;
        const ang = biasAhead
          ? yaw + Math.PI + (Math.random() - 0.5) * 2.4
          : Math.random() * Math.PI * 2;
        const t = threat();
        const base = d.surge ? 18 : lerp(40, 25, t);
        const r = base + Math.random() * 16;
        x = pp.x - Math.sin(ang) * r;
        z = pp.z - Math.cos(ang) * r;
      }
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable - 6) continue;
      const h = terrainHeight(x, z);
      if (h < WORLD.waterLevel - 0.5) continue;
      if (isThicket(x, z)) continue; // nothing hunts from inside the walls
      // don't strand ground squads on the wrong side of a cliff band:
      // when the player holds high ground, spawn at comparable height or
      // on the stair side (flyers get placed by the branches above anyway)
      if (d.surge && terrainHeight(pp.x, pp.z) - h > 10 && Math.random() < 0.7) continue;
      // never spawn in view
      if (hasLOS(pp.x, pp.y, pp.z, x, h + 1.4, z)) continue;
      return { x, z };
    }
    return null;
  }

  function spawnOne(type) {
    const pos = findSpawnPos();
    if (!pos) return false;
    enemyMgr.spawn(type, pos.x, pos.z);
    d.budget -= COSTS[type];
    d.spawned[type] = (d.spawned[type] || 0) + 1;
    lastSpawnPos = pos;
    return true;
  }

  function trySpend() {
    const t = threat();
    const alive = enemyMgr.aliveCount();
    if (alive >= cap()) return;

    const pool = d.surge ? SURGE_SQUADS : SQUADS;
    // surge recipe selection is gated by the hold-progress ramp
    // (surgeIntensity), not raw world threat - see threat()'s comment
    const gate = d.surge ? surgeIntensity() : t;
    const unlocked = pool.filter((s) => gate >= s.min);
    if (unlocked.length === 0) return;
    // prefer the freshest recipes: pick among the last few unlocked
    const window = d.surge ? unlocked : unlocked.slice(-4);
    const squad = window[Math.floor(Math.random() * window.length)];

    let spawnedAny = false;
    outer:
    for (const [type, count] of squad.recipe) {
      for (let i = 0; i < count; i++) {
        if (d.budget < COSTS[type]) break outer;
        // juggernauts stay rare
        if (type === 'juggernaut') {
          const jAlive = enemyMgr.aliveList().filter((e) => e.type === 'juggernaut').length;
          if (jAlive >= (t > 0.85 ? 2 : 1)) continue;
        }
        if (enemyMgr.aliveCount() >= cap() + 2) break outer;
        if (!spawnOne(type)) break outer;
        spawnedAny = true;
      }
    }
    // Directional wave telegraph (root cause 4) - one cue per squad
    // purchase during a surge, using the real spawn point's bearing from
    // the beacon. Never fires for ordinary (non-surge) patrol spawns - the
    // extraction hold is the moment this matters. Browser-only payoff
    // (HUD/audio via sim.js's U.onSurgeWave); onWave defaults to a no-op,
    // so this is inert - and unverifiable - in the headless critic.
    if (d.surge && spawnedAny && lastSpawnPos) {
      const ex = WORLD.extraction;
      onWave(compassBearing(lastSpawnPos.x - ex.x, lastSpawnPos.z - ex.z), squad.recipe[0][0]);
    }
  }

  // Bloomcaller assist: the flower screams and the jungle answers. Spawns
  // near the CALLER (not the player), at a budget discount - killing the
  // caller fast is how you stop the bleeding.
  function assistSpawn(pos, t) {
    // the call is loud, not limitless: reinforcements respect the cap
    if (enemyMgr.aliveCount() >= cap() + 1) return 0;
    const want = t > 0.6 ? 2 : 1;
    let spawned = 0;
    for (let i = 0; i < 6 && spawned < want; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 10;
      const x = pos.x + Math.cos(a) * r;
      const z = pos.z + Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable - 6) continue;
      if (terrainHeight(x, z) < WORLD.waterLevel - 0.5) continue;
      if (isThicket(x, z)) continue;
      enemyMgr.spawn('prowler', x, z);
      spawned++;
    }
    d.heat = Math.min(0.18, d.heat + 0.03);
    return spawned;
  }

  // ---- authored route encounters (game/routeEncounters.js) ----
  // A spot AHEAD of the player (along their heading, or their look direction
  // when standing still), on land, out of sight, at a height they could
  // plausibly reach. Flora wants gentle ground. Returns null if none found.
  function findAheadPos(minR, maxR, flora) {
    const pdata = furthestNorthPlayer();
    const pp = pdata.pos;
    const v = pdata.vel;
    const moving = v && Math.hypot(v.x, v.z) > 1.5;
    const heading = moving ? Math.atan2(-v.x, -v.z) : pdata.yaw;
    const groundH = terrainHeight(pp.x, pp.z);
    for (let i = 0; i < 40; i++) {
      const cone = i < 24 ? 0.7 : 1.5;
      const ang = heading + (Math.random() - 0.5) * 2 * cone;
      const r = minR + Math.random() * (maxR - minR);
      const x = pp.x - Math.sin(ang) * r;
      const z = pp.z - Math.cos(ang) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable - 6) continue;
      const h = terrainHeight(x, z);
      if (h < WORLD.waterLevel + (flora ? 0.3 : -0.5)) continue;
      if (isThicket(x, z)) continue;
      if (Math.abs(h - groundH) > 11) continue; // across a cliff band
      if (!flora && hasLOS(pp.x, pp.y, pp.z, x, h + 1.4, z)) continue;
      return { x, z };
    }
    return null;
  }

  function fireSlot(slot) {
    const diffKey = d.diff ? d.diff.key : 'normal';
    d.slotsFired.push(slot.id);
    if (slot.foreshadow) {
      onForeshadow(slot.foreshadow);
      return;
    }
    d.slotQueue.push({
      slot,
      expires: slotAt(slot, diffKey) + 0.1,
      want: slotGroup(slot, diffKey).map(([type, n]) => [type, n]),
      flora: slotFlora(slot, diffKey),
    });
  }

  function runSlotQueue() {
    if (d.slotQueue.length === 0) return;
    const prog = d.slotProgress;
    for (const job of d.slotQueue) {
      // spawn the group in one go, but not on top of a crowd: authored
      // groups may exceed the cap a little, never run away from it
      for (const entry of job.want) {
        while (entry[1] > 0 && enemyMgr.aliveCount() < cap() + 5) {
          const pos = findAheadPos(36, 62, false);
          if (!pos) break;
          enemyMgr.spawn(entry[0], pos.x, pos.z);
          d.spawned[entry[0]] = (d.spawned[entry[0]] || 0) + 1;
          entry[1] -= 1;
        }
      }
      while (job.flora > 0) {
        const pos = findAheadPos(16, 34, true);
        if (!pos) break;
        enemyMgr.spawn('viperblossom', pos.x, pos.z);
        job.flora -= 1;
      }
    }
    d.slotQueue = d.slotQueue.filter((job) => prog < job.expires
      && (job.flora > 0 || job.want.some((e) => e[1] > 0)));
  }

  function updateRouteSlots() {
    const diffKey = d.diff ? d.diff.key : 'normal';
    const p = progressNorth();
    if (p > d.slotProgress) {
      const crossed = slotsCrossed(d.slotProgress, p, diffKey);
      for (const slot of crossed) fireSlot(slot);
      d.slotProgress = p;
      return crossed.length > 0;
    }
    return false;
  }

  let slotRetryT = 0;
  function update(dt) {
    d.time += dt;
    d.heat = Math.max(0, d.heat - dt * 0.012);
    if (!d.surge) {
      const fired = updateRouteSlots();
      slotRetryT -= dt;
      if (fired || slotRetryT <= 0) {
        slotRetryT = 0.5;
        runSlotQueue();
      }
    }
    d.tickT -= dt;
    if (d.tickT <= 0) {
      const t = threat();
      const tickScale = d.diff ? d.diff.tickScale : 1;
      const budgetRate = d.diff ? d.diff.budgetRate : 1;
      // squad cadence: one purchase decision, then a real pause. During a
      // surge this now paces off the SAME hold-progress ramp as recipe
      // selection (surgeIntensity), not raw threat, so the cadence itself
      // quickens toward the climax instead of being uniformly fast from
      // the first tick.
      d.tickT = (d.surge ? lerp(7, 3, surgeIntensity()) : lerp(24, 9, t)) * tickScale;
      // budget regen saturates at full threat - the overdrive band (>1)
      // sharpens cadence and cap, not spawn volume, or the surge becomes
      // an unwinnable faucet on hard
      const bossMult = d.bossFight ? 0.35 : 1;
      d.budget = Math.min(12, d.budget + lerp(0.9, 3, Math.min(t, 1)) * budgetRate * bossMult);
      trySpend();
    }
  }

  function startSurge() {
    d.surge = true;
    d.holdProgress = 0;
    // a small OPENING BEAT, not the whole wave dumped on commit frame (was
    // +6 budget / 0.1s tick - root cause 3). The escalation now comes from
    // holdProgress ramping through surgeIntensity()/threat() as the hold
    // continues, not from a single instant injection.
    d.budget += 2;
    d.tickT = 0.6;
  }

  function stopSurge() {
    d.surge = false;
  }

  function reset() {
    d.time = 0;
    d.heat = 0;
    d.surge = false;
    d.tickT = d.diff ? d.diff.grace : 14;
    d.budget = 1.5;
    d.spawned = {};
    d.holdProgress = 0;
    d.slotProgress = 0;
    d.slotQueue = [];
    d.slotsFired = [];
    slotRetryT = 0;
  }

  return {
    update, onShot, startSurge, stopSurge, reset, threat, setDifficulty,
    setWeather, assistSpawn, progressNorth, setHoldProgress, surgeIntensity,
    state: d,
  };
}

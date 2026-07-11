// The threat director - the invisible antagonist. Threat rises with time
// (the reason to hurry), with PROGRESS NORTH (the deep jungle does not care
// how quietly you got there), and with noise (every gunshot is a decision).
// It buys squad recipes from a budget and places them ahead of and flanking
// the player, outside line of sight, so contact always feels like an ambush.
// Gorge crossings get garrisoned when you approach - the sills are the
// jungle's tollgates.

import { hasLOS } from '../world/colliders.js';
import { terrainHeight, gorgeZ, WORLD } from '../world/heightmap.js';
import { clamp, lerp } from '../core/noise.js';

const COSTS = {
  prowler: 1, stingerwing: 0.6, spitter: 2, shrike: 2, bloomcaller: 3, juggernaut: 5,
};

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

export function createDirector(enemyMgr, playerRef, opts = {}) {
  const d = {
    time: 0,
    heat: 0,          // noise-driven, decays
    surge: false,     // extraction channel active
    tickT: 18,        // opening grace - let the jungle breathe first
    budget: 1,
    spawned: {},
    diff: null,       // difficulty object, set via setDifficulty
  };

  function setDifficulty(diff) {
    d.diff = diff;
  }

  function progressNorth() {
    const a = WORLD.insertion.z;
    const b = WORLD.extraction.z;
    return clamp((a - playerRef.p.pos.z) / (a - b), 0, 1);
  }

  function threat() {
    const rampTime = d.diff ? d.diff.rampTime : 330;
    const timeRamp = clamp(d.time / rampTime, 0, 1);
    // deep north is hot no matter how fast you got there
    const base = Math.max(timeRamp, progressNorth() * 0.82);
    return clamp(base * 0.85 + d.heat + (d.surge ? 0.35 : 0), 0, 1.3);
  }

  function onShot() {
    // noise nudges the jungle, it does not command it
    const gain = d.diff ? d.diff.heatGain : 1;
    d.heat = Math.min(0.18, d.heat + 0.008 * gain);
  }

  function cap() {
    const t = threat();
    const bonus = d.diff ? d.diff.capBonus : 0;
    return Math.round(2 + t * (d.surge ? 8.5 : 4.5)) + bonus;
  }

  // The crossing the player is currently approaching from the south, if any.
  function approachedCrossing() {
    const pp = playerRef.p.pos;
    const zg = gorgeZ(pp.x);
    if (pp.z < zg + 8) return null; // already across (north)
    let best = null;
    let bestD = 75;
    for (const c of WORLD.crossings) {
      const cz = gorgeZ(c.x);
      const dd = Math.hypot(pp.x - c.x, pp.z - cz);
      if (dd < bestD) {
        bestD = dd;
        best = c;
      }
    }
    return best;
  }

  // find a spawn point: ring around player, biased toward their heading,
  // no line of sight, on land, inside the playable area. When the player
  // approaches a gorge crossing, the far bank gets garrisoned.
  function findSpawnPos() {
    const pp = playerRef.p.pos;
    const yaw = playerRef.p.yaw;
    const crossing = approachedCrossing();
    for (let i = 0; i < 16; i++) {
      let x;
      let z;
      if (crossing && Math.random() < 0.45) {
        // hold the far bank of the sill they are heading for
        const cz = gorgeZ(crossing.x);
        x = crossing.x + (Math.random() - 0.5) * 26;
        z = cz - 12 - Math.random() * 18;
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
    return true;
  }

  function trySpend() {
    const t = threat();
    const alive = enemyMgr.aliveCount();
    if (alive >= cap()) return;

    const unlocked = SQUADS.filter((s) => t >= s.min);
    if (unlocked.length === 0) return;
    // prefer the freshest recipes: pick among the last few unlocked
    const window = unlocked.slice(-4);
    const squad = window[Math.floor(Math.random() * window.length)];

    for (const [type, count] of squad.recipe) {
      for (let i = 0; i < count; i++) {
        if (d.budget < COSTS[type]) return;
        // juggernauts stay rare
        if (type === 'juggernaut') {
          const jAlive = enemyMgr.aliveList().filter((e) => e.type === 'juggernaut').length;
          if (jAlive >= (t > 0.85 ? 2 : 1)) continue;
        }
        if (enemyMgr.aliveCount() >= cap() + 2) return;
        if (!spawnOne(type)) return;
      }
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
      enemyMgr.spawn('prowler', x, z);
      spawned++;
    }
    d.heat = Math.min(0.18, d.heat + 0.03);
    return spawned;
  }

  function update(dt) {
    d.time += dt;
    d.heat = Math.max(0, d.heat - dt * 0.012);
    d.tickT -= dt;
    if (d.tickT <= 0) {
      const t = threat();
      const tickScale = d.diff ? d.diff.tickScale : 1;
      const budgetRate = d.diff ? d.diff.budgetRate : 1;
      // squad cadence: one purchase decision, then a real pause
      d.tickT = (d.surge ? lerp(6, 3.4, t) : lerp(24, 9, t)) * tickScale;
      d.budget = Math.min(12, d.budget + lerp(0.9, 3, t) * budgetRate);
      trySpend();
    }
  }

  function startSurge() {
    d.surge = true;
    d.budget += 6;
    d.tickT = 0.1;
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
  }

  return {
    update, onShot, startSurge, stopSurge, reset, threat, setDifficulty,
    assistSpawn, progressNorth, state: d,
  };
}

// The threat director - the invisible antagonist. Threat rises with time
// (the reason to hurry) and with noise (every gunshot is a decision).
// It buys enemies from a budget and places them ahead of and flanking the
// player, outside line of sight, so contact always feels like an ambush.

import { hasLOS } from '../world/colliders.js';
import { terrainHeight, WORLD } from '../world/heightmap.js';
import { clamp, lerp } from '../core/noise.js';

const RAMP_TIME = 400;         // seconds to reach full baseline threat
const TICK = 4;                // seconds between spend decisions
const COSTS = { prowler: 1, spitter: 2, juggernaut: 5 };

export function createDirector(enemyMgr, playerRef) {
  const d = {
    time: 0,
    heat: 0,          // noise-driven, decays
    surge: false,     // extraction channel active
    tickT: 2.5,       // first contact comes early but light
    budget: 1.2,
    spawned: { prowler: 0, spitter: 0, juggernaut: 0 },
  };

  function threat() {
    const base = clamp(d.time / RAMP_TIME, 0, 1);
    return clamp(base * 0.75 + d.heat + (d.surge ? 0.3 : 0), 0, 1.25);
  }

  function onShot() {
    d.heat = Math.min(0.45, d.heat + 0.018);
  }

  function cap() {
    const t = threat();
    return Math.round(2 + t * (d.surge ? 10 : 7));
  }

  // find a spawn point: ring around player, biased toward their heading,
  // no line of sight, on land, inside the playable area
  function findSpawnPos() {
    const pp = playerRef.p.pos;
    const yaw = playerRef.p.yaw;
    for (let i = 0; i < 14; i++) {
      const biasAhead = Math.random() < 0.6;
      const ang = biasAhead
        ? yaw + Math.PI + (Math.random() - 0.5) * 2.4   // ahead of camera (-z is yaw+PI in world atan2 terms)
        : Math.random() * Math.PI * 2;
      const r = d.surge ? 26 + Math.random() * 22 : 34 + Math.random() * 26;
      const x = pp.x - Math.sin(ang) * r;
      const z = pp.z - Math.cos(ang) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable - 6) continue;
      const h = terrainHeight(x, z);
      if (h < WORLD.waterLevel - 0.5) continue;
      // never spawn in view
      if (hasLOS(pp.x, pp.y, pp.z, x, h + 1.4, z)) continue;
      return { x, z };
    }
    return null;
  }

  function trySpend() {
    const t = threat();
    const alive = enemyMgr.aliveCount();
    if (alive >= cap()) return;

    // what can we afford / what does the moment need?
    const wants = [];
    if (t > 0.42 && d.spawned.juggernaut * 9 < t * 10 - 3) wants.push('juggernaut');
    if (t > 0.18 && Math.random() < 0.45) wants.push('spitter');
    wants.push('prowler');

    for (const type of wants) {
      const cost = COSTS[type];
      if (d.budget < cost) continue;
      // juggernauts stay rare
      if (type === 'juggernaut') {
        const jAlive = enemyMgr.aliveList().filter((e) => e.type === 'juggernaut').length;
        if (jAlive >= (t > 0.85 ? 2 : 1)) continue;
      }
      const pos = findSpawnPos();
      if (!pos) return;
      enemyMgr.spawn(type, pos.x, pos.z);
      d.budget -= cost;
      d.spawned[type] += 1;
      // prowlers hunt in pairs at higher threat
      if (type === 'prowler' && t > 0.35 && d.budget >= 1 && Math.random() < 0.55) {
        const pos2 = findSpawnPos();
        if (pos2) {
          enemyMgr.spawn('prowler', pos2.x, pos2.z);
          d.budget -= 1;
          d.spawned.prowler += 1;
        }
      }
      return; // one purchase decision per tick
    }
  }

  function update(dt) {
    d.time += dt;
    d.heat = Math.max(0, d.heat - dt * 0.008);
    d.tickT -= dt;
    if (d.tickT <= 0) {
      d.tickT = d.surge ? TICK * 0.45 : TICK;
      const t = threat();
      d.budget = Math.min(10, d.budget + lerp(0.8, 3.4, t));
      trySpend();
    }
  }

  function startSurge() {
    d.surge = true;
    d.budget += 5;
    d.tickT = 0.1;
  }

  function stopSurge() {
    d.surge = false;
  }

  function reset() {
    d.time = 0;
    d.heat = 0;
    d.surge = false;
    d.tickT = 2.5;
    d.budget = 1.2;
    d.spawned = { prowler: 0, spitter: 0, juggernaut: 0 };
  }

  return { update, onShot, startSurge, stopSurge, reset, threat, state: d };
}

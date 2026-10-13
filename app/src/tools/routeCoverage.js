// Route coverage harness: which enemy types does a player following a main
// route actually meet, and how far along the route do they first meet them?
//
// Pure Node, no rendering, seeded. A scripted walker moves along the route
// waypoints (autotest.routeWaypoints) at a fixed pace while the REAL sim runs
// (director, enemy manager, traps). The walker keeps its hp topped up and
// kills anything that closes inside KILL_RANGE, like a competent player
// clearing contacts, so the director's population cap keeps cycling the way
// it does in a real run. Used by the CLI (routeCoverage.mjs) and by
// tests/routeCoverage.test.js so the variety guarantee cannot regress.

import * as THREE from 'three';
import { WORLD, terrainHeight } from '../world/heightmap.js';
import { buildVegetation } from '../world/vegetation.js';
import { buildProps } from '../world/props.js';
import { buildRoosts } from '../world/roosts.js';
import { createSim } from '../game/sim.js';
import { routeWaypoints } from '../game/autotest.js';
import { mulberry32 } from '../core/rng.js';

export const ROUTES = ['swamp', 'river', 'ridge'];
export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard'];
export const HUNTERS = ['prowler', 'stingerwing', 'spitter', 'shrike', 'bloomcaller', 'juggernaut'];
export const NEAR = 40;
export const FAR = 70;
const WALK_SPEED = 3;    // m/s, a cautious pace (the owner's real run averaged about 2.6)
const KILL_RANGE = 20;   // the walker clears contacts inside this
const DT = 1 / 30;

let simCache = null;
let foreshadowHook = null;

function getSim() {
  if (!simCache) {
    const scene = new THREE.Scene();
    buildVegetation(scene, { collidersOnly: true });
    buildProps(scene);
    buildRoosts(scene, { collidersOnly: true });
    const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
    const effects = { spawnTracer() {}, burst() {}, update() {} };
    simCache = createSim({ scene, camera, effects, ui: { onForeshadow: () => foreshadowHook && foreshadowHook() } });
  }
  return simCache;
}

// polyline with cumulative lengths
export function buildPath(route) {
  const pts = [{ x: WORLD.insertion.x, z: WORLD.insertion.z }, ...routeWaypoints(route)];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

export function pointAt(path, s) {
  const { pts, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = Math.min(1, (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1));
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
    z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t,
    yaw: Math.atan2(-(pts[i].x - pts[i - 1].x), -(pts[i].z - pts[i - 1].z)),
  };
}

// distance from a point to the polyline
export function distToPath(path, x, z) {
  let best = Infinity;
  for (let i = 1; i < path.pts.length; i++) {
    const a = path.pts[i - 1];
    const b = path.pts[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}

function emptyType() {
  return { near: 0, far: 0, firstFar: null, firstNear: null, spawned: 0 };
}

export function measureCoverage({ route, difficulty, seed }) {
  const sim = getSim();
  const realRandom = Math.random;
  Math.random = mulberry32(seed * 7919 + 17);
  const path = buildPath(route);
  const types = {};
  const records = new Map(); // enemy object -> { type, minD, firstFar, firstNear }
  const realSpawn = sim.enemyMgr.spawn;
  let s = 0;
  const contactEvents = []; // { type, pct } the first time each spawned enemy comes within FAR
  let foreshadowPct = null;
  foreshadowHook = () => { foreshadowPct = Math.round((s / path.length) * 100); };
  sim.enemyMgr.spawn = (type, x, z) => {
    const e = realSpawn(type, x, z);
    records.set(e, { type, minD: Infinity, firstFar: undefined, firstNear: undefined });
    types[type] = types[type] || emptyType();
    types[type].spawned++;
    return e;
  };
  let peak = 0;
  let peakStepMs = 0;
  let stepMsTotal = 0;
  let steps = 0;
  try {
    sim.setDifficulty(difficulty);
    sim.resetRun();
    const p = sim.player.p;
    while (s < path.length && sim.game.state === 'RUNNING' && sim.game.time < 1500) {
      const pt = pointAt(path, s);
      p.pos.set(pt.x, terrainHeight(pt.x, pt.z) + 1.66, pt.z);
      p.vel.set(0, 0, 0);
      p.yaw = pt.yaw;
      p.hp = p.maxHp;
      const t0 = performance.now();
      sim.step({ moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0 }, DT);
      const ms = performance.now() - t0;
      stepMsTotal += ms;
      steps++;
      if (ms > peakStepMs) peakStepMs = ms;
      s += WALK_SPEED * DT;
      peak = Math.max(peak, sim.enemyMgr.aliveCount());
      for (const e of sim.enemyMgr.aliveList()) {
        const rec = records.get(e);
        if (!rec) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < rec.minD) rec.minD = d;
        const tt = types[rec.type];
        if (d <= FAR && rec.firstFar === undefined) {
          rec.firstFar = s;
          contactEvents.push({ type: rec.type, pct: Math.round((s / path.length) * 100) });
          if (tt.firstFar === null || s < tt.firstFar) tt.firstFar = s;
        }
        if (d <= NEAR && rec.firstNear === undefined) {
          rec.firstNear = s;
          if (tt.firstNear === null || s < tt.firstNear) tt.firstNear = s;
        }
        if (d < KILL_RANGE && rec.type !== 'viperblossom' && rec.type !== 'miremother') {
          sim.enemyMgr.applyDamage(e, 99999, false, e.pos, false);
        }
      }
    }
    for (const rec of records.values()) {
      if (rec.minD <= FAR) types[rec.type].far++;
      if (rec.minD <= NEAR) types[rec.type].near++;
    }
  } finally {
    sim.enemyMgr.spawn = realSpawn;
    foreshadowHook = null;
    Math.random = realRandom;
  }
  const out = {};
  for (const [k, v] of Object.entries(types)) {
    out[k] = {
      near: v.near,
      far: v.far,
      spawned: v.spawned,
      firstFarPct: v.firstFar === null ? null : Math.round((v.firstFar / path.length) * 100),
      firstNearPct: v.firstNear === null ? null : Math.round((v.firstNear / path.length) * 100),
    };
  }
  // route percent of every non-flora first contact within 70 m, sorted
  const contacts = contactEvents.filter((c) => c.type !== 'viperblossom' && c.type !== 'miremother')
    .map((c) => c.pct).sort((x, y) => x - y);
  return {
    route, difficulty, seed, routeLength: Math.round(path.length), types: out, contacts,
    peakAlive: peak, avgStepMs: +(stepMsTotal / Math.max(1, steps)).toFixed(3),
    peakStepMs: +peakStepMs.toFixed(2), foreshadowPct,
    traps: trapCoverage(sim, path),
  };
}

function trapCoverage(sim, path) {
  const res = { snapjaw: { near: 0, far: 0 }, dartTotem: { near: 0, far: 0 } };
  for (const t of sim.traps.traps.snapjaws) {
    const d = distToPath(path, t.x, t.z);
    if (d <= NEAR) res.snapjaw.near++;
    if (d <= FAR) res.snapjaw.far++;
  }
  for (const t of sim.traps.traps.dartTotems) {
    const d = distToPath(path, t.x, t.z);
    if (d <= NEAR) res.dartTotem.near++;
    if (d <= FAR) res.dartTotem.far++;
  }
  return res;
}

// Merge contacts that arrive within `gap` percent of each other into one
// encounter group; returns the route percent where each group starts.
export function encounterGroups(contacts, gap = 4) {
  const groups = [];
  for (const c of contacts) {
    if (groups.length === 0 || c - groups[groups.length - 1].last > gap) groups.push({ start: c, last: c });
    else groups[groups.length - 1].last = c;
  }
  return groups.map((g) => g.start);
}

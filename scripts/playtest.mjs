#!/usr/bin/env node
// Headless playtest runner - the whole game, no browser, no GPU, no DOM.
// Builds the world's colliders, assembles the real sim (src/game/sim.js),
// and lets the bot play complete runs at full simulation fidelity. This is
// how balance gets tuned with numbers instead of vibes, and how cheap
// follow-up sessions verify changes without ever opening Chrome.
//
// Usage:
//   node scripts/playtest.mjs                            # normal, all routes
//   node scripts/playtest.mjs --route ridge --runs 3
//   node scripts/playtest.mjs --difficulty hard --route river
//   node scripts/playtest.mjs --matrix                   # routes x difficulties
//   node scripts/playtest.mjs --matrix --runs 2 --out TEMP/balance.json
//
// Output: one line per run + a summary table + optional JSON dump.

import * as THREE from 'three';
import { WORLD } from '../src/world/heightmap.js';
import { buildVegetation } from '../src/world/vegetation.js';
import { buildProps } from '../src/world/props.js';
import { colliderCount } from '../src/world/colliders.js';
import { createSim } from '../src/game/sim.js';
import { createBot } from '../src/game/autotest.js';
import { DIFFICULTIES } from '../src/game/difficulty.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---- args ----
const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const flag = (name) => args.includes('--' + name);

const isCoopTest = flag('coop');
const routes = isCoopTest ? ['river', 'ridge', 'swamp'] : (arg('route') ? [arg('route')] : ['river', 'ridge', 'swamp']);
const difficulties = isCoopTest ? ['easy'] : (flag('matrix')
  ? Object.keys(DIFFICULTIES)
  : [arg('difficulty', 'normal')]);
const runsPer = parseInt(arg('runs', '1'), 10);
const outPath = arg('out');

// ---- build the world (colliders only - no meshes, no renderer) ----
const t0 = Date.now();
const scene = new THREE.Scene();
const veg = buildVegetation(scene, { collidersOnly: true });
buildProps(scene); // beacon/ruin colliders + landmark colliders
console.log(`[world] seed ${WORLD.seed}, ${colliderCount()} colliders, veg scatter ${veg.ms}ms`);

// ---- assemble the real sim ----
const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
const fxStub = { spawnTracer() {}, burst() {}, update() {} };
const sim = createSim({ scene, camera, effects: fxStub, ui: {} });
const bot = createBot({ sim, startRun: () => sim.resetRun() });

// ---- run the matrix ----
const results = [];
if (isCoopTest) {
  console.log('[coop] Running dual-bot co-op tests');
  // Co-op: test different route combinations
  const routePairs = [
    ['river', 'ridge'],
    ['ridge', 'swamp'],
    ['swamp', 'river']
  ];
  for (const [r1, r2] of routePairs) {
    const tRun = Date.now();
    const rep = await bot.runDualBots(r1, r2, { difficulty: 'easy' });
    rep.wallMs = Date.now() - tRun;
    results.push(rep);
    console.log(
      `[coop] routes ${r1.padEnd(6)} + ${r2.padEnd(6)} -> ${String(rep.result).padEnd(20)}`
      + ` [${(rep.wallMs / 1000).toFixed(1)}s wall]`
    );
  }
} else {
  for (const difficulty of difficulties) {
    for (const route of routes) {
      for (let r = 0; r < runsPer; r++) {
        const tRun = Date.now();
        const rep = await bot.runBot(route, { difficulty });
        rep.wallMs = Date.now() - tRun;
        results.push(rep);
        console.log(
          `[run] ${difficulty.padEnd(6)} ${route.padEnd(6)} -> ${String(rep.result).padEnd(7)}`
          + ` t=${fmtTime(rep.timeSec)} kills=${String(rep.kills).padStart(2)}`
          + ` dmg=${String(Math.round(rep.dmgTaken)).padStart(3)} hp=${String(rep.endHp).padStart(3)}`
          + ` shots=${rep.shots} nades=${rep.grenadesThrown}`
          + ` ammo(r/s/l)=${rep.ammoLeft.rifle}/${rep.ammoLeft.shells}/${rep.ammoLeft.long}`
          + (rep.stuck ? ` STUCK@${JSON.stringify(rep.stuckAt)}` : '')
          + ` [${(rep.wallMs / 1000).toFixed(1)}s wall]`
        );
        const srcs = Object.entries(rep.dmgBySource || {}).sort((a, b) => b[1] - a[1]);
        if (srcs.length) {
          console.log(`      hurt by: ${srcs.map(([k, v]) => `${k} ${v}`).join(', ')}`);
        }
        if (rep.stuck) {
          const tail = rep.posTrail.slice(-10).map((p) => `${p.x},${p.z}`).join(' > ');
          console.log(`      trail: ${tail}`);
        }
      }
    }
  }
}

// ---- summary ----
function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
console.log('\n=== SUMMARY ===');
for (const difficulty of difficulties) {
  for (const route of routes) {
    const rs = results.filter((x) => x.difficulty === difficulty && x.route === route);
    if (!rs.length) continue;
    const wins = rs.filter((x) => x.result === 'WIN').length;
    const avg = (f) => Math.round(rs.reduce((a, x) => a + f(x), 0) / rs.length);
    console.log(
      `${difficulty.padEnd(7)} ${route.padEnd(6)} win ${wins}/${rs.length}`
      + `  avgTime ${fmtTime(avg((x) => x.timeSec))}  avgKills ${avg((x) => x.kills)}`
      + `  avgDmg ${avg((x) => x.dmgTaken)}  avgEndHp ${avg((x) => x.endHp)}`
    );
  }
}
const totalWins = results.filter((x) => x.result === 'WIN').length;
console.log(`\n${totalWins}/${results.length} extracted · total wall time ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`[out] wrote ${outPath}`);
}

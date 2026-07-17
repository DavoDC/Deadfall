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
import { buildRoosts } from '../src/world/roosts.js';
import { colliderCount } from '../src/world/colliders.js';
import { createSim } from '../src/game/sim.js';
import { createBot, createCoopSync } from '../src/game/autotest.js';
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
buildRoosts(scene, { collidersOnly: true }); // flood-retreat platforms (round 5)
console.log(`[world] seed ${WORLD.seed}, ${colliderCount()} colliders, veg scatter ${veg.ms}ms`);

// ---- assemble the real sim ----
const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
const fxStub = { spawnTracer() {}, burst() {}, update() {} };
const sim = createSim({ scene, camera, effects: fxStub, ui: {} });
const bot = createBot({ sim, startRun: () => sim.resetRun() });

// ---- run the matrix ----
const results = [];
if (isCoopTest) {
  // True lockstep coop: TWO calls into the same parameterized runBot(),
  // sharing one sim + one frame barrier (createCoopSync) so every frame
  // is exactly one sim.step([intent0, intent1], dt) call - not two
  // sequential single-player runs. Replaces the old runDualBots, which
  // drove a second, dumber, duplicate AI instead of reusing runBot.
  console.log('[coop] Running two-bot co-op tests (shared sim, lockstep frame barrier)');
  const dt = 1 / 60;
  const camera2 = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
  if (sim.players.length < 2) sim.addPlayer(camera2);

  function summarize(r1, r2, rep1, rep2, wallMs) {
    const bothExtracted = rep1.result === 'WIN' && rep2.result === 'WIN';
    return {
      route1: r1, route2: r2, difficulty: 'easy',
      result: bothExtracted ? 'BOTH_EXTRACTED' : 'FAILED',
      reason: bothExtracted ? null : `bot1=${rep1.result} bot2=${rep2.result}`,
      frameCt: Math.round(Math.max(rep1.timeSec, rep2.timeSec) * 60),
      bot1: { route: r1, alive: rep1.endHp > 0 ? 1 : 0, extracted: rep1.result === 'WIN', result: rep1.result },
      bot2: { route: r2, alive: rep2.endHp > 0 ? 1 : 0, extracted: rep2.result === 'WIN', result: rep2.result },
      wallMs,
    };
  }
  function logCoop(rep) {
    const reasonStr = rep.reason ? ` (${rep.reason})` : '';
    const frameCt = rep.frameCt ? ` frames=${rep.frameCt}` : '';
    const bot1alive = rep.bot1 ? `bot1.alive=${rep.bot1.alive}` : '';
    const bot2alive = rep.bot2 ? `bot2.alive=${rep.bot2.alive}` : '';
    console.log(
      `[coop] routes ${rep.route1.padEnd(6)} + ${rep.route2.padEnd(6)} -> ${String(rep.result).padEnd(20)}`
      + `${reasonStr}${frameCt} [${bot1alive} ${bot2alive}] [${(rep.wallMs / 1000).toFixed(1)}s wall]`
    );
    results.push(rep);
  }

  const routePairs = [
    ['river', 'ridge'],
    ['ridge', 'swamp'],
    ['swamp', 'river'],
  ];
  for (const [r1, r2] of routePairs) {
    sim.resetRun();
    const coopSync = createCoopSync(sim, 2, dt);
    const tRun = Date.now();
    const [rep1, rep2] = await Promise.all([
      bot.runBot(r1, { difficulty: 'easy', coopSync, skipStartRun: true }, 0),
      bot.runBot(r2, { difficulty: 'easy', coopSync, skipStartRun: true }, 1),
    ]);
    logCoop(summarize(r1, r2, rep1, rep2, Date.now() - tRun));
  }

  // Down-and-revive gate: force player 0 into bleedout early via the
  // real sim.damagePlayer() (not organic RNG combat, which is proven
  // unreliable to trigger deterministically - see PART A findings), then
  // verify player 1's runBot revive-seeking logic actually reaches them
  // and completes the revive, and both go on to extract.
  // river+ridge is the pairing already proven above to reliably reach
  // BOTH_EXTRACTED without any revive intervention, so a failure to
  // extract here would isolate to the revive mechanic itself rather than
  // the known pre-existing route-pathing STUCK quirk (present on river+
  // river, unrelated to coop/revive - see PART A findings).
  console.log('[coop] Running down-and-revive gate (river/ridge, forced bleedout at frame 300)');
  {
    sim.resetRun();
    const coopSync = createCoopSync(sim, 2, dt);
    let forcedDown = false;
    let wentDown = false;
    let revivedAfter = false;
    const tRun = Date.now();
    const [rep1, rep2] = await Promise.all([
      bot.runBot('river', {
        difficulty: 'easy', coopSync, skipStartRun: true,
        debugHook(i, p) {
          if (process.env.DFDEBUG && i % 600 === 0) console.log(`[DBG p0] f${i} alive=${p.p.alive} bleedoutT=${p.p.bleedoutT.toFixed(1)} pos=(${p.p.pos.x.toFixed(1)},${p.p.pos.z.toFixed(1)})`);
          if (!forcedDown && i === 300 && p.p.alive) {
            forcedDown = true;
            sim.damagePlayer(9999, p.p.pos, 'test-forced-down', sim.players[0]);
            return;
          }
          if (forcedDown && !wentDown && !p.p.alive && p.p.bleedoutT > 0) {
            wentDown = true; // confirmed bleedout state entered
          }
          if (wentDown && !revivedAfter && p.p.alive && p.p.bleedoutT === 0) {
            revivedAfter = true; // confirmed sim.js revived them (alive again)
            if (process.env.DFDEBUG) console.log(`[DBG] revivedAfter at f${i} pos=(${p.p.pos.x.toFixed(1)},${p.p.pos.z.toFixed(1)})`);
          }
        },
      }, 0),
      bot.runBot('ridge', { difficulty: 'easy', coopSync, skipStartRun: true }, 1),
    ]);
    const wallMs = Date.now() - tRun;
    const rep = summarize('river', 'ridge', rep1, rep2, wallMs);
    rep.revived = forcedDown && wentDown && revivedAfter;
    logCoop(rep);
    console.log(`[coop] revive gate: forcedDown=${forcedDown} wentDown=${wentDown} revivedAfter=${revivedAfter} -> revived=${rep.revived}`);
    if (process.env.DFDEBUG) {
      if (rep1.stuck) console.log('[DBG] bot0(river) stuckAt', rep1.stuckAt, 'trail', rep1.posTrail.slice(-8));
      if (rep2.stuck) console.log('[DBG] bot1(ridge) stuckAt', rep2.stuckAt, 'trail', rep2.posTrail.slice(-8));
    }
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

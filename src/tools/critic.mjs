#!/usr/bin/env node
// THE GAME CRITIC - autonomous playtester that judges the game, not just
// scores it (the design notes). Increment 3: the orchestrator.
//
// Runs a headless sweep of the bot across routes x difficulties x N (like
// src/tools/playtest.mjs), but wires src/game/critiqueRig.js into the sim's
// existing ui.onHurt/onDeath hooks and autotest.js's existing debugHook so
// every run comes back enriched with a fine-grained death record, damage
// timeline, and threat/enemiesNear ticks - not just WIN/DEAD/kills/dmg.
// Feeds the result to src/game/critique.js (pure, independently tested)
// and writes:
//   - captures/critic/critic-report-<YYYY-MM-DD>.md   human-readable, ranked, evidence-backed
//   - captures/critic/findings.json         machine-readable (gitignored)
//
// Legibility (checkLegibility()) needs a renderer, so it cannot run
// headless here - see the brief's browser/secondary channel. Pass
// --legibility-json <path> with a previously-captured checkLegibility()
// result (e.g. from window.__deadfall.checkLegibility() in the browser,
// saved to disk) to fold it into this run's findings; otherwise the report
// notes legibility was not re-measured this round.
//
// Usage:
//   node src/tools/critic.mjs                                  # all routes x all difficulties, 5 runs each
//   node src/tools/critic.mjs --runs 8
//   node src/tools/critic.mjs --route river --difficulty hard --runs 10
//   node src/tools/critic.mjs --legibility-json TEMP/legibility.json
//   node src/tools/critic.mjs --out-dir captures/critic --findings-out captures/critic/findings.json

import * as THREE from 'three';
import { WORLD } from '../world/heightmap.js';
import { buildVegetation } from '../world/vegetation.js';
import { buildProps } from '../world/props.js';
import { buildRoosts } from '../world/roosts.js';
import { colliderCount, hasLOS } from '../world/colliders.js';
import { createSim } from '../game/sim.js';
import { createBot } from '../game/autotest.js';
import { createRig } from '../game/critiqueRig.js';
import { critique, SEVERITY_LABEL } from '../game/critique.js';
import { DIFFICULTIES } from '../game/difficulty.js';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// ---- args ----
const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const routes = arg('route') ? [arg('route')] : ['river', 'ridge', 'swamp'];
const difficulties = arg('difficulty') ? [arg('difficulty')] : Object.keys(DIFFICULTIES);
const runsPer = parseInt(arg('runs', '5'), 10);
const outDir = arg('out-dir', 'captures/critic');
const findingsOut = arg('findings-out', 'captures/critic/findings.json');
const legibilityJsonPath = arg('legibility-json');
const today = new Date().toISOString().slice(0, 10);
const reportPath = arg('report-out', `${outDir}/critic-report-${today}.md`);

console.log(`[critic] sweep: routes=${routes.join(',')} difficulties=${difficulties.join(',')} runs=${runsPer} (${routes.length * difficulties.length * runsPer} total runs)`);

// ---- build the world (colliders only - no meshes, no renderer), same as playtest.mjs ----
const tStart = Date.now();
const scene = new THREE.Scene();
const veg = buildVegetation(scene, { collidersOnly: true });
buildProps(scene);
buildRoosts(scene, { collidersOnly: true });
console.log(`[world] seed ${WORLD.seed}, ${colliderCount()} colliders, veg scatter ${veg.ms}ms`);

// ---- assemble the sim, with the critic's rig wired into its EXISTING ui
// hooks (sim.js:156,168) instead of playtest.mjs's `ui: {}` no-op. Nothing
// about sim.js or autotest.js changes - only which callbacks are supplied. ----
const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
const fxStub = { spawnTracer() {}, burst() {}, update() {} };
let rig; // assigned below; ui hooks close over the `rig` binding, not a value
const sim = createSim({
  scene, camera, effects: fxStub,
  ui: {
    onHurt: (amount, srcPos, source) => rig.onHurt(amount, srcPos, source),
    onDeath: () => rig.onDeath(),
  },
});
rig = createRig(sim, { hasLOS });
const bot = createBot({ sim, startRun: () => sim.resetRun() });

// ---- run the sweep ----
const runs = [];
for (const difficulty of difficulties) {
  for (const route of routes) {
    for (let r = 0; r < runsPer; r++) {
      const tRun = Date.now();
      rig.begin(route, difficulty);
      const report = await bot.runBot(route, { difficulty, debugHook: rig.debugHook });
      const rigRecord = rig.current();
      const wallMs = Date.now() - tRun;
      runs.push({ ...report, ...rigRecord, wallMs });
      console.log(
        `[run] ${difficulty.padEnd(6)} ${route.padEnd(6)} -> ${String(report.result).padEnd(7)}`
        + ` t=${report.timeSec}s dmgEvents=${rigRecord.damageEvents.length} ticks=${rigRecord.ticks.length}`
        + (rigRecord.deathRecord && !rigRecord.deathRecord.unknown
          ? ` died-of=${rigRecord.deathRecord.source}` : '')
        + ` [${(wallMs / 1000).toFixed(1)}s wall]`
      );
    }
  }
}

// ---- legibility (optional, browser-captured, merged in) ----
let legibilityResult = null;
if (legibilityJsonPath) {
  if (existsSync(legibilityJsonPath)) {
    legibilityResult = JSON.parse(readFileSync(legibilityJsonPath, 'utf8'));
    console.log(`[legibility] merged from ${legibilityJsonPath}: min=${legibilityResult.minContrast} mean=${legibilityResult.meanContrast}`);
  } else {
    console.warn(`[legibility] --legibility-json ${legibilityJsonPath} not found, skipping`);
  }
}

// ---- critique ----
const { findings, summary } = critique(runs, { legibilityResult });
console.log(`\n[critic] ${findings.length} findings across ${summary.totalRuns} runs `
  + `(${summary.wins} win, ${summary.deaths} dead, ${summary.stuck} stuck, ${summary.timeout} timeout)`);
for (const f of findings) {
  console.log(`  [${f.id}] ${SEVERITY_LABEL[f.severity]} (${f.confidence}) - ${f.title}`);
}

// ---- write findings.json (machine-readable, gitignored under captures/) ----
mkdirSync(dirname(findingsOut), { recursive: true });
const findingsPayload = {
  generatedAt: new Date().toISOString(),
  args: { routes, difficulties, runsPer },
  summary,
  findings,
};
writeFileSync(findingsOut, JSON.stringify(findingsPayload, null, 2));
console.log(`[out] wrote ${findingsOut}`);

// ---- write the human-readable report ----
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, renderReport({ runs, findings, summary, routes, difficulties, runsPer, legibilityResult, today }));
console.log(`[out] wrote ${reportPath}`);

console.log(`\n[done] ${((Date.now() - tStart) / 1000).toFixed(1)}s wall, ${runs.length} runs, ${findings.length} findings`);

// ---------------------------------------------------------------------
// report rendering (pure string building, kept in this file - it is
// presentation over the critique() output, not a separate testable unit
// the way critique.js's judgment logic is)
// ---------------------------------------------------------------------

function fmtPct(n, d) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : 'n/a';
}

function renderFinding(f) {
  const lines = [];
  lines.push(`### [${f.id}] ${SEVERITY_LABEL[f.severity].toUpperCase()} (${f.confidence} confidence) - ${f.title}`);
  lines.push('');
  lines.push(`**Kind:** ${f.kind}`);
  lines.push('');
  lines.push('**Evidence:**');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(f.evidence, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`**Fix hypothesis:** ${f.fixHypothesis}`);
  lines.push('');
  return lines.join('\n');
}

function renderReport({ runs, findings, summary, routes, difficulties, runsPer, legibilityResult, today }) {
  const lines = [];
  lines.push(`# Deadfall Critic Report - ${today}`);
  lines.push('');
  lines.push('Autonomous headless critique (the design notes). The bot plays the '
    + 'real simulation (no cheats, no rendering) dozens of times; this report ranks what went '
    + 'wrong by how much it costs the player - blocks-fun first, then unfair, then dull, then cosmetic.');
  lines.push('');
  lines.push('## Sweep');
  lines.push('');
  lines.push(`- Routes: ${routes.join(', ')}`);
  lines.push(`- Difficulties: ${difficulties.join(', ')}`);
  lines.push(`- Runs per route/difficulty: ${runsPer}`);
  lines.push(`- Total runs: ${summary.totalRuns}`);
  lines.push(`- Result mix: WIN ${summary.wins} (${fmtPct(summary.wins, summary.totalRuns)}), `
    + `DEAD ${summary.deaths} (${fmtPct(summary.deaths, summary.totalRuns)}), `
    + `STUCK ${summary.stuck} (${fmtPct(summary.stuck, summary.totalRuns)}), `
    + `TIMEOUT ${summary.timeout} (${fmtPct(summary.timeout, summary.totalRuns)})`);
  lines.push('');
  lines.push('## Per-cell win rate');
  lines.push('');
  lines.push('| difficulty | route | win | dead | stuck | timeout | avg time |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const difficulty of difficulties) {
    for (const route of routes) {
      const cell = runs.filter((r) => r.difficulty === difficulty && r.route === route);
      if (cell.length === 0) continue;
      const w = cell.filter((r) => r.result === 'WIN').length;
      const d = cell.filter((r) => r.result === 'DEAD').length;
      const s = cell.filter((r) => r.result === 'STUCK').length;
      const to = cell.filter((r) => r.result === 'TIMEOUT').length;
      const avgT = Math.round(cell.reduce((a, r) => a + r.timeSec, 0) / cell.length);
      lines.push(`| ${difficulty} | ${route} | ${w}/${cell.length} | ${d}/${cell.length} | ${s}/${cell.length} | ${to}/${cell.length} | ${avgT}s |`);
    }
  }
  lines.push('');

  if (!legibilityResult) {
    lines.push('## Legibility');
    lines.push('');
    lines.push('Not re-measured this round (checkLegibility() needs a renderer - browser-only). '
      + 'Gates from the design notes: minContrast >= 17.5, meanContrast >= 47.0. '
      + 'Re-run with `--legibility-json <path>` (a saved window.__deadfall.checkLegibility() result) to fold it in.');
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');
  if (findings.length === 0) {
    lines.push('No findings this sweep - every heuristic came back clean against the runs above.');
  } else {
    lines.push(`${findings.length} findings, ranked blocks-fun > unfair > dull > cosmetic, then by confidence.`);
    lines.push('');
    for (const sevLabel of ['blocks-fun', 'unfair', 'dull', 'cosmetic']) {
      const group = findings.filter((f) => SEVERITY_LABEL[f.severity] === sevLabel);
      if (group.length === 0) continue;
      lines.push(`## ${sevLabel.toUpperCase()} (${group.length})`);
      lines.push('');
      for (const f of group) lines.push(renderFinding(f));
    }
  }

  lines.push('## Known out-of-scope defects (not fixed here, per the critic brief)');
  lines.push('');
  lines.push('- Human telemetry is broken (main.js:548 pointer-lock gate starving tick/burst '
    + 'flush; null outcome/endedAt; hp pinned at 100) - this critic is headless and does not '
    + 'depend on it, but any human-session telemetry read elsewhere should be treated as '
    + 'untrustworthy until that is fixed.');
  lines.push('- src/capture/recorder.js and src/game/shots.js\'s downloadShots() both write to '
    + 'the OS Downloads folder, violating the repo\'s "never Downloads" capture rule. Flagged, '
    + 'not fixed - this report and its reel use viewer.js\'s grab()/save()/sheet() path instead, '
    + 'which correctly lands in gitignored captures/.');
  lines.push('');

  return lines.join('\n');
}

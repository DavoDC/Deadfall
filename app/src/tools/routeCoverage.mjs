#!/usr/bin/env node
// CLI for the route coverage harness (see routeCoverage.js).
//   node src/tools/routeCoverage.mjs [--seeds 5] [--routes swamp,river,ridge] [--difficulty easy]
// Prints, per difficulty and route, the mean over seeds of: enemies of each
// type within 40 m / 70 m of the route (near/far) and the route percent at
// which each type is first met within 70 m.
import { measureCoverage, encounterGroups, ROUTES, DIFFICULTY_KEYS, HUNTERS } from './routeCoverage.js';

const args = process.argv.slice(2);
const arg = (n, f) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : f; };
const seeds = parseInt(arg('seeds', '5'), 10);
const routes = arg('routes', ROUTES.join(',')).split(',');
const diffs = arg('difficulty', DIFFICULTY_KEYS.join(',')).split(',');
const ALL = [...HUNTERS, 'viperblossom', 'miremother'];
for (const difficulty of diffs) {
  for (const route of routes) {
    const runs = [];
    for (let seed = 1; seed <= seeds; seed++) runs.push(measureCoverage({ route, difficulty, seed }));
    console.log(`\n## ${difficulty} / ${route} (route ${runs[0].routeLength} m, ${seeds} seeds)`);
    console.log('type          near40  far70  firstSeen% (within 70 m, per seed)');
    for (const t of ALL) {
      const near = runs.reduce((a, r) => a + (r.types[t]?.near || 0), 0) / seeds;
      const far = runs.reduce((a, r) => a + (r.types[t]?.far || 0), 0) / seeds;
      const first = runs.map((r) => r.types[t]?.firstFarPct ?? '-').join(',');
      console.log(`${t.padEnd(13)} ${near.toFixed(1).padStart(5)} ${far.toFixed(1).padStart(6)}  ${first}`);
    }
    const tot = runs.reduce((a, r) => a + Object.entries(r.types)
      .filter(([k]) => k !== 'viperblossom' && k !== 'miremother')
      .reduce((b, [, v]) => b + v.far, 0), 0) / seeds;
    const avgMs = runs.reduce((a, r) => a + r.avgStepMs, 0) / seeds;
    console.log(`hunters within 70m (no flora/apex): ${tot.toFixed(1)}; peak alive ${Math.max(...runs.map((r) => r.peakAlive))}; avg sim step ${avgMs.toFixed(2)} ms; first contact% ${runs.map((r) => r.contacts[0] ?? '-').join(',')}; apex cue at% ${runs.map((r) => r.foreshadowPct ?? '-').join(',')}`);
    console.log(`encounter groups at% (seed 1): ${encounterGroups(runs[0].contacts).join(',')}`);
    console.log(`traps within 70m: snapjaw ${runs[0].traps.snapjaw.far}, dartTotem ${runs[0].traps.dartTotem.far}`);
  }
}

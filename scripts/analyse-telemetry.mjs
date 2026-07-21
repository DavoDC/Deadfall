#!/usr/bin/env node
// Deadfall telemetry analyser - reads session JSON files off disk and prints a
// human-readable digest (outcome, damage-by-source, deaths, waypoints, events,
// which v2 channels actually have data, and hp/stamina/speed/fps ranges).
// Built 2026-07-19 to analyse David's real human playtests; graduated from
// workspace TEMP into the repo 2026-07-21.
//
// Usage:
//   node scripts/analyse-telemetry.mjs                 # reads captures/telemetry
//   node scripts/analyse-telemetry.mjs <dir>           # reads a specific dir
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = process.argv[2] || join(process.cwd(), 'captures', 'telemetry');

const files = readdirSync(DIR)
  .filter((f) => f.startsWith('session-') && f.endsWith('.json'))
  .sort();

const fmt = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

for (const f of files) {
  let log;
  try {
    log = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  } catch (e) {
    console.log(`\n${f}: UNREADABLE (${e.message})`);
    continue;
  }
  const dur = log.endedAt ? Math.round((log.endedAt - log.startedAt) / 1000) : null;
  const size = readFileSync(join(DIR, f)).length;

  console.log(`\n=== ${f}  (${size} bytes) ===`);
  console.log(`  v${log.version} | difficulty=${log.difficulty} | outcome=${log.outcome ?? 'NONE (never ended)'} | duration=${dur ?? 'n/a'}s`);
  console.log(`  kills=${log.kills} deaths=${(log.deaths || []).length} shots=${log.shots?.fired ?? 0}/${log.shots?.hits ?? 0}`);

  const dmg = log.damageTakenBySource || {};
  const dmgTotal = Object.values(dmg).reduce((a, b) => a + b, 0);
  if (dmgTotal) {
    const parts = Object.entries(dmg)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${fmt(v)}`);
    console.log(`  DAMAGE TAKEN ${fmt(dmgTotal)} -> ${parts.join(', ')}`);
  }

  for (const d of log.deaths || []) {
    const p = d.pos || {};
    console.log(`  DEATH t=${fmt(d.time)}s cause=${d.cause} enemy=${d.enemy} at (${fmt(p.x)}, ${fmt(p.z)}) waypoint=${d.waypoint}`);
  }

  const wps = (log.waypoints || []).map((w) => `${w.name}@${fmt(w.time)}s`);
  if (wps.length) console.log(`  WAYPOINTS: ${wps.join(' -> ')}`);

  const ev = {};
  for (const e of log.events || []) ev[e.kind] = (ev[e.kind] || 0) + 1;
  if (Object.keys(ev).length) console.log(`  EVENTS: ${Object.entries(ev).map(([k, v]) => `${k}x${v}`).join(', ')}`);

  // richness check - which v2 channels actually have data
  const rich = {
    state: (log.state || []).length,
    inputEdges: (log.inputEdges || []).length,
    inputAggregates: (log.inputAggregates || []).length,
    bursts: (log.bursts || []).length,
    path: (log.path || []).length,
    fps: (log.fps || []).length,
  };
  console.log(`  CHANNELS: ${Object.entries(rich).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // stamina / speed sanity from state samples
  const st = log.state || [];
  if (st.length) {
    const hp = st.map((s) => s.hp).filter((n) => typeof n === 'number');
    const stam = st.map((s) => s.stamina).filter((n) => typeof n === 'number');
    const spd = st.map((s) => s.speedMps).filter((n) => typeof n === 'number');
    const fpsv = st.map((s) => s.fps).filter((n) => typeof n === 'number');
    const rng = (a) => (a.length ? `${fmt(Math.min(...a))}-${fmt(Math.max(...a))}` : 'n/a');
    console.log(`  RANGES: hp ${rng(hp)} | stamina ${rng(stam)} | speed ${rng(spd)} | fps ${rng(fpsv)}`);
    const last = st[st.length - 1];
    console.log(`  LAST SAMPLE t=${fmt(last.t)}s pos=(${fmt(last.pos?.x)}, ${fmt(last.pos?.z)}) hp=${fmt(last.hp)} enemiesNear=${JSON.stringify(last.enemiesNear)}`);
  }
}
console.log(`\n(${files.length} sessions)`);

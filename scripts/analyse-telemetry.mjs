#!/usr/bin/env node
// Deadfall telemetry analyser - reads session JSON files off disk and prints a
// human-readable digest (outcome, damage-by-source, deaths, waypoints, events,
// which v2 channels actually have data, and hp/stamina/speed/fps ranges).
// Built 2026-07-19 to analyse David's real human playtests; graduated from
// workspace TEMP into the repo 2026-07-21.
//
// TWO CLOCKS (broken-telemetry P0 follow-up, f158c0f, 2026-08-20): that fix
// moved telemetry.tick() onto a wall-clock time base so log.state/path/
// waypoints/events keep advancing through a pause/alt-tab. log.deaths/
// damageTaken/damageDealt stay on game.time (sim clock), which correctly
// freezes during a pause. After any pause the two are offset by the total
// time paused. computePausedSeconds() recovers that offset from the
// paused/resumed events (already wall-clock) and formatDigest() reports it
// plus labels which clock each printed timestamp family uses, so the two
// are never silently read as comparable.
//
// Usage:
//   node scripts/analyse-telemetry.mjs                 # reads captures/telemetry
//   node scripts/analyse-telemetry.mjs <dir>           # reads a specific dir
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const fmt = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

// Walks log.events for paused/resumed pairs (recorded via
// telemetry.recordEvent, wall-clock like the rest of that family) and
// returns the total seconds spent paused plus whether the log ends mid-pause.
//
// Edge cases handled:
//   - no pause events at all -> { totalPausedSec: 0, unterminated: false },
//     the common case, so callers can skip the PAUSED line entirely.
//   - a repeated/nested 'paused' while one is already open -> ignored, only
//     the first open pause's start counts (matches the fact that main.js
//     only records 'paused' on a locked->unlocked transition, so a second
//     one back-to-back would be a stray duplicate, not a real re-pause).
//   - a stray 'resumed' with no open 'paused' -> ignored.
//   - a trailing unmatched 'paused' (session ended, or log still running,
//     while paused) -> unterminated: true. If log.endedAt/startedAt are
//     both present (a finished session), the open span is counted through
//     to the session's wall-clock-elapsed end - (endedAt-startedAt)/1000,
//     both being real Date.now() epoch ms set at the same instant telemetry
//     started, so this lands in the same elapsed-seconds frame as the event
//     timestamps. If the log is still running (no endedAt), the open span's
//     duration is unknown and is left out of the total - only the
//     unterminated flag fires.
export function computePausedSeconds(log) {
  const events = log.events || [];
  let total = 0;
  let openPausedAt = null;

  for (const e of events) {
    if (e.kind === 'paused') {
      if (openPausedAt == null) openPausedAt = e.time;
    } else if (e.kind === 'resumed') {
      if (openPausedAt != null) {
        total += Math.max(0, e.time - openPausedAt);
        openPausedAt = null;
      }
    }
  }

  const unterminated = openPausedAt != null;
  if (unterminated && log.endedAt != null && log.startedAt != null) {
    const sessionEndElapsed = (log.endedAt - log.startedAt) / 1000;
    total += Math.max(0, sessionEndElapsed - openPausedAt);
  }

  return { totalPausedSec: total, unterminated };
}

// Builds the full per-session digest as one string (no console.log inside,
// so this is testable in isolation). meta: { filename, size }.
export function formatDigest(log, meta) {
  const lines = [];
  const dur = log.endedAt ? Math.round((log.endedAt - log.startedAt) / 1000) : null;

  lines.push(`\n=== ${meta.filename}  (${meta.size} bytes) ===`);
  lines.push(`  v${log.version} | difficulty=${log.difficulty} | outcome=${log.outcome ?? 'NONE (never ended)'} | duration=${dur ?? 'n/a'}s`);
  lines.push(`  kills=${log.kills} deaths=${(log.deaths || []).length} shots=${log.shots?.fired ?? 0}/${log.shots?.hits ?? 0}`);

  const paused = computePausedSeconds(log);
  if (paused.totalPausedSec > 0 || paused.unterminated) {
    const note = paused.unterminated ? ' (unterminated - still paused at session end)' : '';
    lines.push(`  PAUSED total=${fmt(paused.totalPausedSec)}s${note}`);
  }

  const dmg = log.damageTakenBySource || {};
  const dmgTotal = Object.values(dmg).reduce((a, b) => a + b, 0);
  if (dmgTotal) {
    const parts = Object.entries(dmg)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${fmt(v)}`);
    lines.push(`  DAMAGE TAKEN ${fmt(dmgTotal)} -> ${parts.join(', ')}`);
  }

  // sim clock: game.time, frozen during pause - see computePausedSeconds
  // above for recovering the offset against the wall-clock families below.
  for (const d of log.deaths || []) {
    const p = d.pos || {};
    lines.push(`  DEATH t=${fmt(d.time)}s (sim clock) cause=${d.cause} enemy=${d.enemy} at (${fmt(p.x)}, ${fmt(p.z)}) waypoint=${d.waypoint}`);
  }

  // wall clock: telemetryElapsedT, keeps running through a pause.
  const wps = (log.waypoints || []).map((w) => `${w.name}@${fmt(w.time)}s`);
  if (wps.length) lines.push(`  WAYPOINTS (wall clock): ${wps.join(' -> ')}`);

  const ev = {};
  for (const e of log.events || []) ev[e.kind] = (ev[e.kind] || 0) + 1;
  if (Object.keys(ev).length) lines.push(`  EVENTS (wall clock): ${Object.entries(ev).map(([k, v]) => `${k}x${v}`).join(', ')}`);

  // richness check - which v2 channels actually have data
  const rich = {
    state: (log.state || []).length,
    inputEdges: (log.inputEdges || []).length,
    inputAggregates: (log.inputAggregates || []).length,
    bursts: (log.bursts || []).length,
    path: (log.path || []).length,
    fps: (log.fps || []).length,
  };
  lines.push(`  CHANNELS: ${Object.entries(rich).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // stamina / speed sanity from state samples (wall clock, same family as
  // path/waypoints/events above).
  const st = log.state || [];
  if (st.length) {
    const hp = st.map((s) => s.hp).filter((n) => typeof n === 'number');
    const stam = st.map((s) => s.stamina).filter((n) => typeof n === 'number');
    const spd = st.map((s) => s.speedMps).filter((n) => typeof n === 'number');
    const fpsv = st.map((s) => s.fps).filter((n) => typeof n === 'number');
    const rng = (a) => (a.length ? `${fmt(Math.min(...a))}-${fmt(Math.max(...a))}` : 'n/a');
    lines.push(`  RANGES: hp ${rng(hp)} | stamina ${rng(stam)} | speed ${rng(spd)} | fps ${rng(fpsv)}`);
    const last = st[st.length - 1];
    lines.push(`  LAST SAMPLE t=${fmt(last.t)}s (wall clock) pos=(${fmt(last.pos?.x)}, ${fmt(last.pos?.z)}) hp=${fmt(last.hp)} enemiesNear=${JSON.stringify(last.enemiesNear)}`);
  }

  return lines.join('\n');
}

// --- CLI entrypoint - only runs when this file is executed directly, so
// importing computePausedSeconds/formatDigest for tests never touches fs. ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const DIR = process.argv[2] || join(process.cwd(), 'captures', 'telemetry');

  const files = readdirSync(DIR)
    .filter((f) => f.startsWith('session-') && f.endsWith('.json'))
    .sort();

  for (const f of files) {
    let log;
    try {
      log = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    } catch (e) {
      console.log(`\n${f}: UNREADABLE (${e.message})`);
      continue;
    }
    const size = readFileSync(join(DIR, f)).length;
    console.log(formatDigest(log, { filename: f, size }));
  }
  console.log(`\n(${files.length} sessions)`);
}

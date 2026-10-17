// One-page playtest report from a telemetry session. Plain node, no deps.
//
//   node src/tools/analyzeSession.mjs <session.json | folder | extracted save-logs folder>
//
// A folder is searched (and its telemetry/ subfolder) for session-*.json, and
// the newest file by name is used; latest.json is the fallback. Works on
// in-progress, abandoned and old-format files: every field is optional.
// How to read the result: docs/References/PlaytestAnalysis.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STALL_SECONDS = 4;     // standing still this long counts as a stall
export const STALL_RADIUS = 2;      // metres of drift still counted as standing
export const STALE_SECONDS = 30;    // in-progress file older than this = abandoned or crashed

const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '?');
const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '?');
const arr = (v) => (Array.isArray(v) ? v : []);

export function findSessionFile(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return target;
  for (const dir of [target, path.join(target, 'telemetry')]) {
    if (!fs.existsSync(dir)) continue;
    const names = fs.readdirSync(dir).filter((n) => /^session-.*\.json$/.test(n)).sort();
    if (names.length) return path.join(dir, names[names.length - 1]);
    if (fs.existsSync(path.join(dir, 'latest.json'))) return path.join(dir, 'latest.json');
  }
  return null;
}

// Paused ranges [{from, to}] from the paused and resumed events. A pause with no
// resume runs to endT. A resume with no pause (the one at the start of a run) is ignored.
export function pausedRanges(events, endT = Infinity) {
  const out = [];
  let from = null;
  for (const e of arr(events)) {
    if (e.kind === 'paused' && from == null) from = e.time;
    else if (e.kind === 'resumed' && from != null) { out.push({ from, to: e.time }); from = null; }
  }
  if (from != null && endT > from) out.push({ from, to: endT });
  return out;
}

const pausedBefore = (ranges, t) => ranges.reduce((a, r) => a + Math.max(0, Math.min(t, r.to) - r.from), 0);
const inPause = (ranges, t) => ranges.some((r) => t >= r.from && t < r.to);

// Stretches where the player stayed within STALL_RADIUS for STALL_SECONDS or more
// of PLAY time: points inside a pause are dropped and paused time is not counted,
// so a pause is never a stall. from and to stay wall-clock for the report.
export function findStalls(pathPoints, paused = []) {
  const stalls = [];
  const pts = arr(pathPoints)
    .filter((p) => !inPause(paused, p.time))
    .map((p) => ({ ...p, play: p.time - pausedBefore(paused, p.time) }));
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && Math.hypot(pts[j + 1].x - pts[i].x, pts[j + 1].z - pts[i].z) <= STALL_RADIUS) j++;
    if (pts[j].play - pts[i].play >= STALL_SECONDS) {
      stalls.push({ from: pts[i].time, to: pts[j].time, x: pts[i].x, z: pts[i].z });
      i = j + 1;
    } else i++;
  }
  return stalls;
}

export function pathLength(pathPoints) {
  const pts = arr(pathPoints);
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return d;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function analyse(s, { nowMs = Date.now() } = {}) {
  const pts = arr(s.path);
  const lastT = Math.max(0, pts.length ? pts[pts.length - 1].time : 0, ...arr(s.state).map((x) => x.t || 0));
  const outcome = s.outcome || (s.endedAt ? 'unknown' : 'unfinished (old format)');
  const wallSec = Number.isFinite(s.endedAt) && Number.isFinite(s.startedAt) ? (s.endedAt - s.startedAt) / 1000 : lastT;
  const paused = pausedRanges(s.events, wallSec);
  const pausedSec = paused.reduce((a, r) => a + (r.to - r.from), 0);
  const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v || ''));
  const savedAt = toMs(s.lastSavedAt ?? s.endedAt);
  const staleSec = Number.isFinite(savedAt) ? (nowMs - savedAt) / 1000 : null;
  const fps = arr(s.fps).map((x) => x.fps ?? x.value ?? x).filter(Number.isFinite).sort((a, b) => a - b);
  const frameMs = arr(s.state).filter((x) => !x.paused).map((x) => x.frameMs).filter(Number.isFinite).sort((a, b) => a - b);
  const enc = arr(s.encounters);
  const byType = {};
  for (const e of enc) {
    const t = (byType[e.type] ||= { spawned: 0, seen: 0, killed: 0, dmg: 0, seenDist: [] });
    t.spawned++;
    if (e.firstSeenT != null) { t.seen++; t.seenDist.push(e.firstSeenDist); }
    if (e.fate === 'killed') t.killed++;
    t.dmg += e.dmgToPlayer || 0;
  }
  const killsByWeapon = {};
  for (const e of enc) if (e.fate === 'killed') killsByWeapon[e.killedBy || 'other'] = (killsByWeapon[e.killedBy || 'other'] || 0) + 1;
  // hp over time: the 1 s state samples plus the hp recorded on each hit (exact, between samples)
  const hpPoints = [];
  for (const x of arr(s.state)) if (Number.isFinite(x.hp)) hpPoints.push({ t: x.t || 0, hp: x.hp });
  for (const d of arr(s.damageTaken)) if (Number.isFinite(d.hp)) hpPoints.push({ t: d.time || 0, hp: d.hp });
  hpPoints.sort((a, b) => a.t - b.t);
  const hp = hpPoints.map((p) => p.hp);
  const hpMovedNever = hp.length > 1 && hp.every((v) => v === hp[0]);
  const dmgTotal = Array.isArray(s.damageTaken) ? s.damageTaken.reduce((a, d) => a + (d.amount || 0), 0) : 0;
  const edges = arr(s.inputEdges);
  const counts = {};
  const open = {};
  let sprintSeconds = 0;
  let aimSeconds = 0;
  for (const e of edges) {
    if (e.action === 'sprint' || e.action === 'aim') {
      if (e.on) open[e.action] = e.t;
      else if (open[e.action] != null) {
        if (e.action === 'sprint') sprintSeconds += e.t - open[e.action]; else aimSeconds += e.t - open[e.action];
        open[e.action] = null;
      }
    }
    if (e.on) counts[e.action] = (counts[e.action] || 0) + 1;
  }
  return {
    result: s.result || null,
    hpPoints, hpWarning: hpMovedNever && dmgTotal > 0,
    input: { edges: edges.length, dropped: s.inputEdgesDropped || 0, counts, sprintSeconds, aimSeconds },
    
    outcome, endReason: s.endReason ?? null, difficulty: s.difficulty ?? null,
    gameVersion: s.gameVersion && typeof s.gameVersion === 'object' ? String(s.gameVersion.sha || '').slice(0, 7) : (s.gameVersion ?? null),
    durationSec: lastT, pausedSec, playSec: Math.max(0, lastT - pausedSec), staleSec,
    abandoned: outcome === 'abandoned' || (!s.outcome && !s.endedAt) || (outcome === 'in-progress' && staleSec != null && staleSec > STALE_SECONDS),
    pathPoints: pts.length, distance: pathLength(pts), stalls: findStalls(pts, paused),
    waypoints: arr(s.waypoints), deaths: arr(s.deaths),
    // DF-164: the last flood hit (feet, water, depth, crown) when the run ended in the flood
    floodDeath: arr(s.deaths).some((d) => d.cause === 'flood')
      ? ([...arr(s.damageTaken)].reverse().find((d) => d.source === 'flood' && Number.isFinite(d.feetY)) || null)
      : null,
    damageTaken: Array.isArray(s.damageTaken) ? s.damageTaken.reduce((a, d) => a + (d.amount || 0), 0) : (s.damageTaken ?? null), damageBySource: s.damageTakenBySource || {},
    shots: s.shots || null, kills: s.kills ?? null,
    spawned: s.spawned || {}, byType, killsByWeapon, encounters: enc.length,
    neverSeen: enc.filter((e) => e.firstSeenT == null && e.fate !== 'alive').length,
    fpsMedian: percentile(fps, 0.5), fpsP5: percentile(fps, 0.05), frameP95: percentile(frameMs, 0.95),
    minHp: hp.length ? Math.min(...hp) : null,
    longFrames: [...arr(s.longFrames)].sort((a, b) => b.frameMs - a.frameMs),
    spits: arr(s.events).filter((e) => e.kind === 'spit' && e.detail && Number.isFinite(e.detail.bearingDeg)).map((e) => e.detail),
    errors: arr(s.errors), env: s.env || null,
    events: arr(s.events).length,
    hasEncounters: enc.length > 0,
  };
}

export function formatReport(r, file = '') {
  const L = [];
  L.push(`PLAYTEST REPORT ${file ? `(${path.basename(file)})` : ''}`.trim());
  L.push(`Outcome: ${r.outcome}${r.endReason ? ` (${r.endReason})` : ''}   difficulty: ${r.difficulty ?? '?'}   version: ${r.gameVersion ?? '?'}`);
  L.push(`Length: ${mmss(r.durationSec)}${r.pausedSec > 0 ? ` (play ${mmss(r.playSec)}, paused ${mmss(r.pausedSec)})` : ''}   route: ${r.pathPoints} points, ${Math.round(r.distance)} m`);
  if (r.abandoned) L.push(`WARNING: run did not finish cleanly (abandoned or crashed); data stops at ${mmss(r.durationSec)}.`);
  if (r.outcome === 'in-progress' && !r.abandoned) L.push('Run still in progress or just saved; numbers are complete so far.');
  if (r.env) L.push(`Machine: ${r.env.gpu ?? '?'}, screen ${r.env.screen?.w ?? '?'}x${r.env.screen?.h ?? '?'}, dpr ${r.env.devicePixelRatio ?? '?'}`);
  L.push(`Performance: fps median ${f1(r.fpsMedian)}, 5th percentile ${f1(r.fpsP5)}, frame time p95 ${f1(r.frameP95)} ms`);
  if (r.longFrames.length) {
    L.push(`Long frames (over 25 ms): ${r.longFrames.length}, worst:`);
    for (const f of r.longFrames.slice(0, 5)) L.push(`  ${f.frameMs} ms at ${mmss(f.t)}${f.pos ? ` at ${Math.round(f.pos.x)},${Math.round(f.pos.z)}` : ''}`);
  }
  if (r.spits.length) {
    const away = r.spits.filter((d) => Math.abs(d.bearingDeg) > 90).length;
    L.push(`Spitter shots: ${r.spits.length}, ${away} fired facing away (bearing over 90 degrees)`);
  }
  if (r.result) L.push(`Score: ${r.result.score} ${r.result.grade} ${r.result.title}${r.result.tag ? ` (${r.result.tag})` : ''}`);
  L.push(`Health: lowest ${f1(r.minHp)}, damage taken ${Math.round(r.damageTaken ?? 0)}, deaths ${r.deaths.length}`);
  if (r.hpPoints.length) {
    const pts = r.hpPoints;
    const pick = [pts[0]];
    let next = 30;
    for (const p of pts) if (p.t >= next) { pick.push(p); next = p.t + 30; }
    const low = pts.reduce((a, b) => (b.hp < a.hp ? b : a));
    if (!pick.includes(low)) pick.push(low);
    pick.sort((a, b) => a.t - b.t);
    L.push(`HP over time: ${pick.map((p) => `${Math.round(p.hp)}@${mmss(p.t)}`).join(' ')}`);
  }
  if (r.hpWarning) L.push('WARNING: hp never changed despite damage taken (telemetry bug, report it).');
  const srcs = Object.entries(r.damageBySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`);
  if (srcs.length) L.push(`Damage by source: ${srcs.join(', ')}`);
  if (r.floodDeath) {
    const d = r.floodDeath;
    L.push(`Flood death: feet ${f1(d.feetY)} m, water ${f1(d.waterY)} m, depth ${f1(d.depth)} m, ${d.onCrown ? 'on a crown' : 'wading, not on a crown'}`);
  }
  if (r.shots) L.push(`Shots: ${r.shots.fired ?? '?'} fired, ${r.shots.hits ?? '?'} hit`);
  if (r.kills != null) L.push(`Kills: ${r.kills}`);
  const c = r.input.counts;
  if (!r.input.edges) L.push('Input: none recorded (older version, or no input edges)');
  else {
    const n = (k) => c[k] || 0;
    L.push(`Input: ${n('fireDown')} clicks, ${n('jump')} jumps, ${n('reload')} reloads, ${n('grenadeThrow')} grenades, ${n('melee')} melee, weapon keys ${n('weapon1') + n('weapon2') + n('weapon3') + n('swap') + n('weaponNext') + n('weaponPrev')}; sprint ${Math.round(r.input.sprintSeconds)}s, aim ${Math.round(r.input.aimSeconds)}s (${r.input.edges} edges${r.input.dropped ? `, ${r.input.dropped} edges dropped` : ''})`);
  }
  L.push(`Waypoints reached: ${r.waypoints.length}${r.waypoints.length ? ` (last at ${mmss(r.waypoints[r.waypoints.length - 1].time ?? r.waypoints[r.waypoints.length - 1].t)})` : ''}`);
  if (r.stalls.length) {
    L.push(`Stalls (${STALL_SECONDS}s+ standing still): ${r.stalls.length}`);
    for (const s of r.stalls.slice(0, 5)) L.push(`  ${mmss(s.from)} to ${mmss(s.to)} at ${Math.round(s.x)},${Math.round(s.z)}`);
  } else L.push('Stalls: none');
  if (r.hasEncounters) {
    L.push(`Enemies: ${r.encounters} spawned, ${r.neverSeen} gone without ever being seen`);
    for (const [type, t] of Object.entries(r.byType)) {
      const d = t.seenDist.filter(Number.isFinite);
      const avg = d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
      L.push(`  ${type}: spawned ${t.spawned}, seen ${t.seen}, killed ${t.killed}, damage to you ${Math.round(t.dmg)}${avg != null ? `, first seen at ${avg} m avg` : ''}`);
    }
    const kw = Object.entries(r.killsByWeapon).map(([k, v]) => `${k} ${v}`).join(', ');
    if (kw) L.push(`Kills by weapon: ${kw}`);
  } else L.push('Enemies: no encounter log in this file (older version).');
  L.push(`Errors: ${r.errors.length}`);
  for (const e of r.errors.slice(0, 3)) L.push(`  ${mmss(e.t)} ${e.kind}: ${e.message}`);
  return L.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const target = process.argv[2];
  if (!target) { console.error('usage: node src/tools/analyzeSession.mjs <session.json | folder>'); process.exit(2); }
  const file = fs.existsSync(target) ? findSessionFile(target) : null;
  if (!file) { console.error(`no session file found at ${target}`); process.exit(1); }
  console.log(formatReport(analyse(JSON.parse(fs.readFileSync(file, 'utf8'))), file));
}

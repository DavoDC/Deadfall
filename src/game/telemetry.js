// HUMAN-PLAYTEST TELEMETRY ("GIVE CLAUDE MORE DATA", playtest ask 2026-07-18).
// David plays a real run -> this logs every meaningful metric with
// timestamps to a downloadable JSON session file -> Claude ingests the log
// and finds issues (difficulty spikes, bugs, unfair deaths, bad frames).
// This is the observation harness for data-driven tuning - the workspace's
// "build the harness before you iterate" principle applied to a human
// playtester instead of a bot.
//
// Headless-safe like flood.js/weather.js: pure logic in here, zero DOM
// except download() (which only runs when actually called from the
// browser). main.js wires this into the sim's ui hooks and the render
// loop's tick(); scripts/playtest.mjs never touches it.
//
// Sampled, not per-frame-everything: path/fps are sampled on an interval
// (default 2s) so a long run's session file stays small and readable
// instead of a per-frame firehose.

import { downloadBlob } from '../capture/recorder.js';

const SAMPLE_INTERVAL = 2; // seconds between path/fps samples

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function createTelemetry() {
  let recording = false;
  let log = null;
  let lastSampleT = -Infinity;
  let visitedWaypoints = null; // Set of landmark names already recorded this run

  function blankLog(meta) {
    return {
      version: 1,
      startedAt: Date.now(),
      endedAt: null,
      difficulty: meta.difficulty ?? null,
      seed: meta.seed ?? null,
      outcome: null,             // 'extracted' | 'died' | null (still running)
      kills: 0,
      deaths: [],                // {time, pos, cause, enemy, waypoint}
      damageTaken: [],           // {time, amount, source, pos}
      damageTakenBySource: {},   // source -> total
      damageDealt: [],           // {time, amount, target, headshot, crit}
      damageDealtByTarget: {},   // target -> total
      shots: { fired: 0, hits: 0 },
      waypoints: [],             // {name, time, pos} - first arrival only
      events: [],                // {time, kind, detail}
      fps: [],                   // {time, fps, frameMs} - sampled
      path: [],                  // {time, x, z} - sampled
    };
  }

  function start(meta = {}) {
    log = blankLog(meta);
    lastSampleT = -Infinity;
    visitedWaypoints = new Set();
    recording = true;
  }

  function stop() {
    if (!recording || !log) return null;
    log.endedAt = Date.now();
    recording = false;
    return log;
  }

  function setOutcome(outcome) {
    if (!recording || !log) return;
    log.outcome = outcome;
  }

  function nowT() {
    // relative run time, best-effort from the last sampled tick time; the
    // actual per-event time is always passed in by the caller where it
    // matters (deaths/damage/shots read game.time via main.js), this is
    // only a fallback for callers that don't have it handy.
    return lastSampleT === -Infinity ? 0 : lastSampleT;
  }

  function recordDeath({ time, pos, cause, enemy, waypoint } = {}) {
    if (!recording || !log) return;
    log.deaths.push({ time: time ?? nowT(), pos, cause: cause ?? 'unknown', enemy: enemy ?? null, waypoint: waypoint ?? null });
  }

  function recordDamageTaken({ time, amount, source, pos } = {}) {
    if (!recording || !log) return;
    log.damageTaken.push({ time: time ?? nowT(), amount, source: source ?? 'unknown', pos: pos ?? null });
    log.damageTakenBySource[source ?? 'unknown'] = (log.damageTakenBySource[source ?? 'unknown'] || 0) + amount;
  }

  function recordDamageDealt({ time, amount, target, headshot, crit } = {}) {
    if (!recording || !log) return;
    log.damageDealt.push({ time: time ?? nowT(), amount, target: target ?? 'unknown', headshot: !!headshot, crit: !!crit });
    log.damageDealtByTarget[target ?? 'unknown'] = (log.damageDealtByTarget[target ?? 'unknown'] || 0) + amount;
  }

  function recordShotFired() {
    if (!recording || !log) return;
    log.shots.fired += 1;
  }

  function recordShotHit() {
    if (!recording || !log) return;
    log.shots.hits += 1;
  }

  function recordKill() {
    if (!recording || !log) return;
    log.kills += 1;
  }

  function recordEvent(kind, detail = null) {
    if (!recording || !log) return;
    log.events.push({ time: nowT(), kind, detail });
  }

  // Called once per frame from the render loop. Internally decides whether
  // this frame lands on a sample boundary (path/fps) and always checks
  // waypoint arrival cheaply (a handful of distance checks, no allocation
  // beyond the occasional recorded entry).
  function tick(dt, ctx) {
    if (!recording || !log) return;
    const { time, pos, fps, frameMs, landmarks } = ctx;
    lastSampleT = time;

    if (time - lastSampleAt() >= SAMPLE_INTERVAL) {
      log.path.push({ time: round2(time), x: round2(pos.x), z: round2(pos.z) });
      log.fps.push({ time: round2(time), fps: Math.round(fps), frameMs: round2(frameMs) });
    }

    if (landmarks && pos) {
      for (const lm of landmarks) {
        if (visitedWaypoints.has(lm.name)) continue;
        const dx = pos.x - lm.x;
        const dz = pos.z - lm.z;
        if (dx * dx + dz * dz <= lm.r * lm.r) {
          visitedWaypoints.add(lm.name);
          log.waypoints.push({ name: lm.name, time: round2(time), pos: { x: round2(pos.x), z: round2(pos.z) } });
        }
      }
    }
  }

  function lastSampleAt() {
    return log.path.length ? log.path[log.path.length - 1].time : -Infinity;
  }

  function download(filename) {
    if (!log) return false;
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename || `deadfall-session-${Date.now()}.json`);
    return true;
  }

  // A single line for the console at run end - the fast "what happened"
  // read before anyone opens the JSON.
  function summaryLine() {
    if (!log) return '[telemetry] no session recorded';
    const acc = log.shots.fired > 0 ? Math.round((log.shots.hits / log.shots.fired) * 100) : 0;
    const dur = log.endedAt ? Math.round((log.endedAt - log.startedAt) / 1000) : Math.round(nowT());
    return `[telemetry] ${log.outcome ?? 'in-progress'} in ${dur}s - `
      + `${log.kills} kills, ${log.deaths.length} deaths, `
      + `${log.shots.fired} shots (${acc}% acc), `
      + `${Math.round(Object.values(log.damageTakenBySource).reduce((a, b) => a + b, 0))} dmg taken, `
      + `difficulty=${log.difficulty ?? '?'}`;
  }

  return {
    start, stop, setOutcome, download, summaryLine,
    recordDeath, recordDamageTaken, recordDamageDealt,
    recordShotFired, recordShotHit, recordKill, recordEvent,
    tick,
    get recording() { return recording; },
    get log() { return log; },
  };
}

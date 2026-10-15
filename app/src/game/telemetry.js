// HUMAN-PLAYTEST TELEMETRY ("GIVE CLAUDE MORE DATA", playtest ask 2026-07-18).
// David plays a real run -> this logs every meaningful metric with
// timestamps to a session file -> Claude reads it straight off disk
// (captures/telemetry/, see src/server/telemetryStore.js + config/vite.config.js)
// and finds issues (difficulty spikes, bugs, unfair deaths, bad frames).
// This is the observation harness for data-driven tuning - the
// "build the harness before you iterate" principle applied to a human
// playtester instead of a bot.
//
// Headless-safe like flood.js/weather.js: pure logic in here, zero DOM
// except download() (which only runs when actually called from the
// browser). main.js wires this into the sim's ui hooks and the render
// loop's tick(), src/tools/playtest.mjs never touches it.
//
// v2 (docs/References/Telemetry.md) adds three channels on top of v1's
// deaths/damage/shots/waypoints/events/fps/path, all still pure logic fed
// by ctx objects main.js assembles every frame (enemyMgr/director/weapons
// state never leaks in here - that would break the headless-safe contract):
//   - HUMAN INPUT: full-fidelity edges (down/up) for discrete actions, plus
//     1s aggregates for continuous axes (distance, % sprinting, look speed,
//     shots, time aiming). Never raw 60fps intents - see recordInput().
//   - GAME STATE: a 1s baseline sample (pos/hp/stamina/ammo/weapon/speed/
//     slope/verticalVel/grounded/enemiesNear/threat/fps), PLUS a 10Hz ring
//     buffer that gets snapshotted into log.bursts on death or a damage
//     spike (>= DAMAGE_SPIKE_THRESHOLD) - 5s before, 2s after. This is what
//     explains an unfair death.
//
// Sampled, not per-frame-everything: path/fps are sampled on an interval
// (default 2s) so a long run's session file stays small and readable
// instead of a per-frame firehose. Same discipline extended to the new
// channels (1s / 10Hz, never per-frame).

import { downloadBlob } from '../capture/recorder.js';
import { buildDelta } from './telemetryDelta.js';

const SAMPLE_INTERVAL = 2;   // seconds between fps samples
export const PATH_INTERVAL = 1; // seconds between route samples (the player path is the key playtest signal)
const STATE_INTERVAL = 1;    // seconds between game-state baseline samples
const INPUT_AGG_INTERVAL = 1; // seconds between human-input aggregate flushes

const BURST_HZ = 10;
const BURST_INTERVAL = 1 / BURST_HZ;
const BURST_PRE_SEC = 5;
const BURST_POST_SEC = 2;
const BURST_RING_CAP = Math.ceil(BURST_PRE_SEC / BURST_INTERVAL); // 50 samples

// A single hit at/above this many hp counts as a "spike" worth a burst
// capture - chosen well below a full juggernaut/miremother hit so those
// always trigger, but above routine chip damage (stingerwing touches,
// prowler pokes) so normal combat does not flood log.bursts.
export const DAMAGE_SPIKE_THRESHOLD = 15;
export const MAX_ERRORS = 20;

// Discrete input actions worth full-fidelity edges. Pulse actions are
// already one-frame-true pulses from input.sample() (jump/reload/weapon
// swap/grenade throw have no natural "up" - the press IS the event).
// Sustain actions (firing, aim) are held, so we diff against the previous
// frame to emit both the down AND the up edge.
const PULSE_ACTIONS = ['jump', 'reload', 'weapon1', 'weapon2', 'weapon3', 'swap', 'weaponNext', 'weaponPrev',
  'grenadeThrow', 'melee', 'interact', 'fireDown'];
// firing/aim/sprint/grenadeHold are held flags on the intent; the four move
// directions are derived from moveX/moveZ (see held() below).
const SUSTAIN_ACTIONS = ['firing', 'aim', 'sprint', 'grenadeHold', 'moveFwd', 'moveBack', 'moveLeft', 'moveRight'];
// Edge list cap: a normal 10 minute run logs a few hundred edges; the cap
// only stops a stuck key from growing the file, and the drop count is kept.
export const MAX_INPUT_EDGES = 3000;

function held(intent, action) {
  switch (action) {
    case 'moveFwd': return (intent.moveZ || 0) < 0;
    case 'moveBack': return (intent.moveZ || 0) > 0;
    case 'moveLeft': return (intent.moveX || 0) < 0;
    case 'moveRight': return (intent.moveX || 0) > 0;
    default: return !!intent[action];
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function createTelemetry({ now = Date.now } = {}) {
  let recording = false;
  let log = null;
  let lastSampleT = -Infinity;
  let visitedWaypoints = null; // Set of landmark names already recorded this run

  // v2: independent sample-interval trackers (each channel samples on its
  // own cadence, unlike v1 which read the interval back off log.path).
  let lastPathSampleT = -Infinity;
  let lastFpsSampleT = -Infinity;
  let lastStateSampleT = -Infinity;
  let lastBurstSampleT = -Infinity;
  let lastInputAggT = -Infinity;

  // v2: 10Hz rolling ring buffer (last ~5s of state samples) + the
  // in-progress burst (if death/damage-spike fired recently).
  let ring = [];
  let activeBurst = null;

  // v2: human-input aggregation window + sustained-action edge tracking.
  let prevSustain = {};
  let agg = null;

  // Incremental persistence: notify() tells main.js "something worth saving
  // just happened" (reason: kill, damage, waypoint, death, event, end, ...);
  // mods tracks in-place edits to already-sent array entries (see touch()).
  let notifier = null;
  let mods = {};
  let modCounter = 0;
  function notify(reason) {
    if (notifier) { try { notifier(reason); } catch { /* never break the game for a save */ } }
  }

  function blankLog(meta) {
    return {
      version: 2,
      startedAt: now(),
      endedAt: null,
      lastSavedAt: null,         // stamped by the server on every write
      endReason: null,           // 'extracted' | 'death' | 'quit' | 'tab-closed' | 'unknown' (null while running)
      difficulty: meta.difficulty ?? null,
      seed: meta.seed ?? null,
      gameVersion: meta.gameVersion ?? null, // {sha, date} of the build that produced this run (the `version` field is the schema number)
      outcome: 'in-progress',    // 'in-progress' | 'extracted' | 'died' | 'abandoned'
      env: meta.env ?? null,     // browser, GPU, screen, quality settings (collected once by main.js)
      kills: 0,
      spawned: {},               // enemy type -> number spawned this run
      encounters: [],            // one per enemy spawn, see encounters.js (entries are updated in place)
      errors: [],                // uncaught errors / unhandled rejections, capped at MAX_ERRORS
      deaths: [],                // {time, pos, cause, enemy, waypoint}
      damageTaken: [],           // {time, amount, source, pos}
      damageTakenBySource: {},   // source -> total
      damageDealt: [],           // {time, amount, target, headshot, crit}
      damageDealtByTarget: {},   // target -> total
      shots: { fired: 0, hits: 0 },
      waypoints: [],             // {name, time, pos} - first arrival only
      events: [],                // {time, kind, detail}
      fps: [],                   // {time, fps, frameMs} - sampled every 2s
      path: [],                  // {time, x, z, y, yaw} - sampled every 1s
      // v2 channels (docs/References/Telemetry.md):
      result: null,              // {score, grade, title, tag} set at run end (result screen scoring)
      inputEdgesDropped: 0,      // edges beyond MAX_INPUT_EDGES that were not stored
      inputEdges: [],            // {t, action, on} - full fidelity
      inputAggregates: [],       // 1s: {t, distance, pctSprint, aimSeconds, lookSpeedMeanDegPerSec, lookSpeedPeakDegPerSec, shots}
      state: [],                 // 1s: {t, pos, yaw, hp, stamina, ammo, weapon, speedMps, slopeDeg, verticalVel, grounded, enemiesNear, threat, extract, fps, frameMs}
      bursts: [],                // [{trigger, triggerT, samples: [...10Hz state samples, 5s before/2s after]}]
    };
  }

  function start(meta = {}) {
    log = blankLog(meta);
    lastSampleT = -Infinity;
    lastPathSampleT = -Infinity;
    lastFpsSampleT = -Infinity;
    lastStateSampleT = -Infinity;
    lastBurstSampleT = -Infinity;
    lastInputAggT = -Infinity;
    ring = [];
    activeBurst = null;
    prevSustain = {};
    agg = null;
    visitedWaypoints = new Set();
    mods = {};
    modCounter = 0;
    recording = true;
    notify('start');
  }

  // reason: why the session ended, stored as log.endReason. A run that ends
  // without an outcome (quit, tab closed) becomes outcome 'abandoned'.
  function stop(reason = 'unknown') {
    if (!recording || !log) return null;
    // a died/partial run must leave COMPLETE data on disk - flush whatever
    // is mid-window rather than discarding it (both 2026-07-18 runs lost
    // exactly this kind of in-progress data)
    if (activeBurst) {
      log.bursts.push(activeBurst);
      activeBurst = null;
    }
    if (agg) flushInputAgg(nowT());
    log.endedAt = now();
    log.endReason = reason;
    if (log.outcome === 'in-progress') log.outcome = 'abandoned';
    recording = false;
    notify('end');
    return log;
  }

  function setOutcome(outcome) {
    if (!recording || !log) return;
    log.outcome = outcome;
  }

  // The one way a run ends by death or extraction: sets the outcome and closes
  // the session in a single step, so nothing can be recorded after it. A new
  // run must call start() again, which opens a fresh session with its own startedAt.
  function finish(outcome, reason) {
    if (!recording || !log) return null;
    setOutcome(outcome);
    return stop(reason);
  }

  function nowT() {
    // relative run time, best-effort from the last sampled tick time; the
    // actual per-event time is always passed in by the caller where it
    // matters (deaths/damage/shots read game.time via main.js), this is
    // only a fallback for callers that don't have it handy.
    return lastSampleT === -Infinity ? 0 : lastSampleT;
  }

  // Snapshot the ring buffer (or extend the in-progress burst window) - the
  // 5s-before/2s-after picture around an incident. A second trigger while
  // one is already open just extends the post-window rather than opening
  // an overlapping second burst.
  function beginBurst(trigger, time) {
    if (!recording || !log) return;
    if (activeBurst) {
      activeBurst.triggerT = time;
      return;
    }
    activeBurst = { trigger, triggerT: time, samples: ring.slice() };
  }

  function flushBurstIfDone(time) {
    if (activeBurst && time - activeBurst.triggerT >= BURST_POST_SEC) {
      log.bursts.push(activeBurst);
      activeBurst = null;
    }
  }

  // Seconds since start() on the same wall clock that stop() uses for endedAt.
  // Deaths, damage and hits default to this, so they sit on the session's own
  // timeline. (They used to take sim time, which freezes while paused, so a
  // death after a pause was stamped minutes before the run really ended.)
  function elapsed() {
    return log ? (now() - log.startedAt) / 1000 : 0;
  }

  function recordDeath({ time, pos, cause, enemy, waypoint, hp } = {}) {
    if (!recording || !log) return;
    const t = time ?? elapsed();
    log.deaths.push({ time: t, pos, cause: cause ?? 'unknown', enemy: enemy ?? null, waypoint: waypoint ?? null, hp: hp ?? null });
    beginBurst('death', t);
    notify('death');
  }

  // hp: the player's hp AFTER this hit (so hp over time is exact even between the 1 s state samples)
  function recordDamageTaken({ time, amount, source, pos, hp } = {}) {
    if (!recording || !log) return;
    const t = time ?? elapsed();
    log.damageTaken.push({ time: t, amount, source: source ?? 'unknown', pos: pos ?? null, hp: hp ?? null });
    log.damageTakenBySource[source ?? 'unknown'] = (log.damageTakenBySource[source ?? 'unknown'] || 0) + amount;
    if (amount >= DAMAGE_SPIKE_THRESHOLD) beginBurst('damageSpike', t);
    notify('damage');
  }

  function recordDamageDealt({ time, amount, target, headshot, crit } = {}) {
    if (!recording || !log) return;
    log.damageDealt.push({ time: time ?? elapsed(), amount, target: target ?? 'unknown', headshot: !!headshot, crit: !!crit });
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
    notify('kill');
  }

  // Encounter log (encounters.js): entries are appended once and then updated
  // in place, so every update marks the entry changed for the next delta.
  function addEncounter(entry) {
    if (!recording || !log) return -1;
    log.encounters.push(entry);
    touch('encounters', log.encounters.length - 1);
    return log.encounters.length - 1;
  }

  function updateEncounter(index, patch) {
    if (!recording || !log || !log.encounters[index]) return;
    Object.assign(log.encounters[index], patch);
    touch('encounters', index);
  }

  function setSpawned(counts) {
    if (!recording || !log) return;
    log.spawned = { ...counts };
  }

  // Uncaught error or unhandled rejection; the first MAX_ERRORS are kept.
  function recordError({ kind, message, source, line } = {}) {
    if (!log || log.errors.length >= MAX_ERRORS) return;
    log.errors.push({
      t: round2(nowT()), kind: kind || 'error',
      message: String(message ?? '').slice(0, 300),
      source: source ? String(source).slice(0, 200) : null,
      line: line ?? null,
    });
    notify('error');
  }

  function recordEvent(kind, detail = null) {
    if (!recording || !log) return;
    log.events.push({ time: nowT(), kind, detail });
    notify('event');
  }

  // Builds one game-state sample from a ctx object main.js assembles every
  // frame. Every field is optional (defaults to null) so callers that only
  // pass the v1 fields (time/pos/fps/frameMs - the existing tests, the
  // headless bot) never throw; main.js's real ctx fills all of them.
  function buildStateSample(time, ctx) {
    return {
      t: round2(time),
      pos: ctx.pos ? { x: round2(ctx.pos.x), y: round2(ctx.pos.y), z: round2(ctx.pos.z) } : null,
      yaw: ctx.yaw != null ? round2(ctx.yaw) : null,
      hp: ctx.hp ?? null,
      stamina: ctx.stamina != null ? round2(ctx.stamina) : null,
      ammo: ctx.ammo ?? null,
      weapon: ctx.weapon ?? null,
      speedMps: ctx.speedMps != null ? round2(ctx.speedMps) : null,
      slopeDeg: ctx.slopeDeg != null ? round2(ctx.slopeDeg) : null,
      verticalVel: ctx.verticalVel != null ? round2(ctx.verticalVel) : null,
      grounded: ctx.grounded ?? null,
      enemiesNear: ctx.enemiesNear ?? null,
      threat: ctx.threat != null ? round2(ctx.threat) : null,
      extract: ctx.extract != null ? round2(ctx.extract) : null,
      fps: ctx.fps != null ? Math.round(ctx.fps) : null,
      frameMs: ctx.frameMs != null ? round2(ctx.frameMs) : null,
    };
  }

  // An immediate state sample outside the 1 s cadence (main.js calls it on a
  // hard hit and on death) so hp is on record right at the moments that matter.
  function snapshotState(ctx) {
    if (!recording || !log || !ctx) return;
    const s = buildStateSample(ctx.time ?? nowT(), ctx);
    log.state.push(s);
    ring.push(s);
    if (ring.length > BURST_RING_CAP) ring.shift();
    if (activeBurst) activeBurst.samples.push(s);
  }

  // Score, grade and rank title from the result screen, so analysis can use them.
  function setResult(r) {
    if (!recording || !log || !r) return;
    log.result = { score: r.score ?? null, grade: r.grade ?? null, title: r.title ?? null, tag: r.tag ?? '' };
  }

  // Called once per frame from the render loop. Internally decides whether
  // this frame lands on a sample boundary (path/fps/state/burst-ring, each
  // on its own cadence) and always checks waypoint arrival cheaply.
  function tick(dt, ctx) {
    if (!recording || !log) return;
    const { time, pos, fps, frameMs, landmarks } = ctx;
    lastSampleT = time;

    if (time - lastPathSampleT >= PATH_INTERVAL) {
      lastPathSampleT = time;
      const pt = { time: round2(time), x: round2(pos.x), z: round2(pos.z) };
      if (pos.y != null) pt.y = round2(pos.y);
      if (ctx.yaw != null) pt.yaw = round2(ctx.yaw);
      log.path.push(pt);
    }
    if (time - lastFpsSampleT >= SAMPLE_INTERVAL) {
      lastFpsSampleT = time;
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
          notify('waypoint');
        }
      }
    }

    if (time - lastStateSampleT >= STATE_INTERVAL) {
      lastStateSampleT = time;
      log.state.push(buildStateSample(time, ctx));
    }

    if (time - lastBurstSampleT >= BURST_INTERVAL) {
      lastBurstSampleT = time;
      const s = buildStateSample(time, ctx);
      ring.push(s);
      if (ring.length > BURST_RING_CAP) ring.shift();
      if (activeBurst) activeBurst.samples.push(s);
      flushBurstIfDone(time);
    }
  }

  function blankAgg(startT, shotsAtStart) {
    return { startT, distance: 0, sprintT: 0, aimT: 0, lookSum: 0, lookPeak: 0, lastPos: null, shotsAtStart };
  }

  function flushInputAgg(time) {
    if (!agg) return;
    const span = Math.max(1e-6, time - agg.startT);
    log.inputAggregates.push({
      t: round2(time),
      distance: round2(agg.distance),
      pctSprint: round2(Math.min(1, agg.sprintT / span) * 100),
      aimSeconds: round2(agg.aimT),
      lookSpeedMeanDegPerSec: round2(agg.lookSum / span),
      lookSpeedPeakDegPerSec: round2(agg.lookPeak),
      shots: log.shots.fired - agg.shotsAtStart,
    });
    lastInputAggT = time;
    agg = blankAgg(time, log.shots.fired);
  }

  // Called once per frame from main.js right after input.sample() (the
  // same "wrap the seam" pattern telemetry already uses on weaponHooks).
  // intent: the full sample() return value. ctx: { time, pos, lookDeltaDeg }
  // - lookDeltaDeg is degrees turned THIS frame, computed by main.js (which
  // owns player.p.sensitivity) so this module stays decoupled from the
  // controller's pixel->radian conversion.
  //
  // Logs EDGES at full fidelity (sparse - only on state change) plus 1s
  // AGGREGATES for the continuous axes. Never logs raw 60fps intents.
  function recordInput(intent, dt, ctx = {}) {
    if (!recording || !log) return;
    const time = ctx.time ?? nowT();

    const pushEdge = (action, on) => {
      if (log.inputEdges.length >= MAX_INPUT_EDGES) { log.inputEdgesDropped += 1; return; }
      log.inputEdges.push({ t: round2(time), action, on });
    };
    for (const action of PULSE_ACTIONS) {
      if (intent[action]) pushEdge(action, true);
    }
    for (const action of SUSTAIN_ACTIONS) {
      const now = held(intent, action);
      if (now !== !!prevSustain[action]) {
        pushEdge(action, now);
        prevSustain[action] = now;
      }
    }

    if (!agg) {
      agg = blankAgg(time, log.shots.fired);
      // anchor the window's own clock here - if left at -Infinity (start()'s
      // reset value) the very first call below would see an infinite gap
      // and flush a degenerate near-zero-span aggregate immediately instead
      // of accumulating a real 1s window
      lastInputAggT = time;
    }
    if (intent.sprint) agg.sprintT += dt;
    if (intent.aim) agg.aimT += dt;
    const pos = ctx.pos;
    if (pos) {
      if (agg.lastPos) agg.distance += Math.hypot(pos.x - agg.lastPos.x, pos.z - agg.lastPos.z);
      agg.lastPos = { x: pos.x, z: pos.z };
    }
    const lookDeg = ctx.lookDeltaDeg || 0; // degrees turned this frame
    agg.lookSum += lookDeg;
    agg.lookPeak = Math.max(agg.lookPeak, dt > 0 ? lookDeg / dt : 0);

    if (time - lastInputAggT >= INPUT_AGG_INTERVAL) {
      flushInputAgg(time);
    }
  }

  // The next delta for the server: only what is new since ack (see
  // telemetryDelta.js). counter is stored by the caller as the new ack.mod
  // once the server confirms.
  function delta(ack, seq) {
    if (!log) return null;
    return { delta: buildDelta(log, ack, mods, seq), counter: modCounter };
  }

  // Marks an already-sent array entry as changed so the next delta resends it.
  function touch(name, index) {
    (mods[name] || (mods[name] = []))[index] = ++modCounter;
  }

  // HUMAN-ONLY. Triggers a browser download, which lands in the OS Downloads
  // folder. Automation / Claude / subagents MUST NOT call this - it violates the
  // no-Downloads rule. To capture a session programmatically, read the
  // `.log` getter (the full session object, below) and write it to the repo's
  // gitignored `captures/` folder with file tools instead. See toJSON().
  function download(filename) {
    if (!log) return false;
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename || `deadfall-session-${Date.now()}.json`);
    return true;
  }

  // Automation-safe: returns the session as a pretty JSON string so Claude can
  // pull it (via window.__deadfall.telemetry.toJSON()) and write it to captures/
  // - no browser download, nothing touches Downloads. v2: main.js also POSTs
  // this same string to /telemetry on an interval + on events, so David never
  // has to pull it manually - it is already on disk.
  function toJSON() {
    return log ? JSON.stringify(log, null, 2) : null;
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
    start, stop, finish, setOutcome, elapsed, delta, touch, download, toJSON, summaryLine,
    recordDeath, recordDamageTaken, recordDamageDealt,
    recordShotFired, recordShotHit, recordKill, recordEvent,
    addEncounter, updateEncounter, setSpawned, recordError,
    recordInput,
    tick, snapshotState, setResult,
    setNotifier(fn) { notifier = fn; },
    get recording() { return recording; },
    get log() { return log; },
  };
}

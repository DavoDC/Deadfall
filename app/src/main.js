// Deadfall - browser entry point. The GAME lives in src/game/sim.js (shared
// with the headless playtest runner); this file is presentation: renderer,
// input, HUD, audio, menus, atmosphere, and the debug/playtest API.
// State machine: MENU -> RUNNING (-> extraction channel) -> WIN | DEAD -> MENU.

import * as THREE from 'three';
import { WORLD, LANDMARKS, landmarkPos, waterLevelAt, terrainNormal } from './world/heightmap.js';
import { buildTerrain, buildWater } from './world/terrain.js';
import { buildSky, trackShadow, MOODS, ATMOS } from './world/sky.js';
import { tickDapple, updateDappleSun, uniforms as dappleUniforms } from './world/dapple.js';
import { buildVegetation, tickWind, setSwayMult } from './world/vegetation.js';
import { buildMedusae, tickMedusae } from './world/medusae.js';
import { buildProps } from './world/props.js';
import { buildRoosts } from './world/roosts.js';
import { colliderCount } from './world/colliders.js';
import { createInput } from './player/input.js';
import { startPing, quitGame } from './game/serverLink.js';
import { loadVersion } from './game/versionInfo.js';
import { resultView } from './player/resultScreen.js';
import { FRAME_INTERVAL_S, FRAME_CAP_PER_SESSION } from './game/frameCadence.js';
import { shouldShowMenu, statsAboveMenu, shouldShowEndScreen, resumeButtonLabel, shouldStepSim, shouldRecordTelemetry } from './player/pauseState.js';
import { createViewmodel } from './weapons/viewmodel.js';
import { createEffects } from './weapons/effects.js';
import { createHud } from './game/hud.js';
import { createSim } from './game/sim.js';
import { DIFFICULTIES, DEFAULT_DIFFICULTY } from './game/difficulty.js';
import {
  initAudio, resumeAudio, setListener, sfxFootstep, sfxLand, sfxHurt,
  sfxExtractTone, sfxStinger, sfxHeartbeat, sfxRazorfin, sfxAyahuasca,
  sfxThunder,
} from './audio/engine.js';
import { startAmbience, updateAmbience, setRain } from './audio/ambience.js';
import { createMotes, createDrizzle } from './world/motes.js';
import { createRazorfins } from './world/razorfins.js';
import { sfxCreature } from './audio/engine.js';
import { createBot } from './game/autotest.js';
import { createSnapshot } from './game/snapshot.js';
import { createShotsAPI } from './game/shots.js';
import { checkLegibility } from './game/legibility.js';
import { makeViewer } from './game/viewer.js';
import { createRecorderAPI } from './capture/recorder.js';
import { createCinematic } from './game/cinematic.js';
import { createPipeline } from './render/pipeline.js';
import { createTelemetry, DAMAGE_SPIKE_THRESHOLD, hurtPositions } from './game/telemetry.js';
import { CONTROLS, shouldShowControlsOnLaunch, markControlsSeen } from './player/controlsOverlay.js';
import { loadDeveloperMode } from './game/developerMode.js';
import { createSessionFlusher } from './game/telemetrySender.js';
import { createEncounterTracker } from './game/encounters.js';
import { createBootTimer, bootProfileEnabled } from './game/bootTiming.js';

const boot = createBootTimer();
boot.mark('imports loaded');

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
// round-6: the round-3 saturation push (saturate(1.3) contrast(1.04)) moved
// from a CSS canvas filter into the pipeline's grade pass - screenshots and
// the trailer now capture the graded look. The CSS filter slot remains for
// the ayahuasca trip's hue-rotate + displacement, which stay DOM-side.
const BASE_FILTER = '';
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BASE_FOV = 74;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.08, 2400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  pipeline.setSize(window.innerWidth, window.innerHeight);
});

// --- world ---
console.log('[deadfall] building world, seed', WORLD.seed);
const t0 = performance.now();
const { sun, hemi, applyMood: applyMoodSky } = buildSky(scene, renderer);
// round-6: every mood change also re-captures the water's environment
// reflection (sky + fog + canopy silhouettes) - see buildWater
function applyMood(mood) {
  applyMoodSky(mood);
  if (water && water.userData.updateEnvMap) {
    water.userData.updateEnvMap(renderer, scene, camera.position);
  }
}
// round-6 rendering pipeline - every render (game loop, shots rig,
// legibility probe, cinematic) goes through this
boot.mark('renderer+sky');
const pipeline = createPipeline({ renderer, scene, camera, sun });
boot.mark('pipeline');
const renderFrame = () => pipeline.render();
buildTerrain(scene);
boot.mark('terrain');
const water = buildWater(scene);
boot.mark('water');
buildVegetation(scene);
boot.mark('vegetation');
buildMedusae(scene); // round 7: the lantern medusae live (pulse/drift/trail)
boot.mark('medusae');
const { tickProps, igniteBeacon, ringPulse } = buildProps(scene);
boot.mark('props');
buildRoosts(scene); // the flood's vertical retreat (round 5)
boot.mark('roosts');
const motes = createMotes(scene);
const drizzle = createDrizzle(scene);
let razorfins = null; // needs effects; created after the sim below
console.log('[deadfall] world built in', Math.round(performance.now() - t0), 'ms,',
  colliderCount(), 'colliders');
// round-6: first water reflection capture (moods re-capture via applyMood)
water.userData.updateEnvMap(renderer, scene, camera.position);
boot.mark('water env map');

// --- presentation elements the sim reports into ---
const vignetteEl = document.getElementById('vignette');
const underwaterEl = document.getElementById('underwater');
const feverEl = document.getElementById('fever');
const lightningEl = document.getElementById('lightning');
let vignette = 0;
let hud = null; // created after sim

// --- weather presentation state (the sim owns the weather MECHANIC;
// this block owns how it looks and sounds) ---
let currentMood = MOODS.bloom;
let weatherFx = { key: 'clear', fogMult: 1, sunMult: 1, rain: 0 };
let lightningT = 5;      // seconds to next strike (storm only)
let lightningGlow = 0;   // current flash brightness (sun boost), decays fast
let lightningFlash = 0;  // screen overlay opacity, decays fast
const _fogTarget = new THREE.Color();
const STORM_SLATE = new THREE.Color(0x707a96);

function applyWeatherFx(w, initial) {
  weatherFx = w;
  const rainLevel = Math.max(w.rain, currentMood.drizzle ? 0.45 : 0);
  drizzle.setLevel(rainLevel);
  setRain(rainLevel);
  if (!initial && hud) hud.toast(w.label, 3);
  if (w.key === 'storm') lightningT = 1.5 + Math.random() * 3;
}

// --- the ayahuasca trip: the world goes wavy and you SEE DIFFERENTLY ---
// X-ray: every creature material stops depth-testing and ignores fog, so
// the fauna glows through trees, terrain, everything. Wavy: an SVG
// displacement filter warps the whole canvas while the global vegetation
// sway multiplier makes the jungle itself writhe.
let tripActive = false;
let xrayReapplyT = 0;
const xrayOriginals = new Map(); // material -> saved props
const ayaTurbEl = document.getElementById('ayaturb');
const ayaDispEl = document.getElementById('ayadisp');

function applyXray(on) {
  const mats = new Set();
  for (const e of sim.enemyMgr.enemies) {
    e.model.group.traverse((o) => {
      if (o.isMesh && o.material) mats.add(o.material);
    });
  }
  for (const m of mats) {
    if (on) {
      if (!xrayOriginals.has(m)) {
        xrayOriginals.set(m, {
          depthTest: m.depthTest,
          fog: m.fog,
          emissiveIntensity: m.emissiveIntensity,
        });
        m.depthTest = false;
        m.fog = false;
        if (m.emissiveIntensity !== undefined) m.emissiveIntensity *= 1.9;
        m.needsUpdate = true;
      }
    }
  }
  if (!on) {
    for (const [m, orig] of xrayOriginals) {
      m.depthTest = orig.depthTest;
      m.fog = orig.fog;
      m.emissiveIntensity = orig.emissiveIntensity;
      m.needsUpdate = true;
    }
    xrayOriginals.clear();
  }
}

// --- HUMAN-PLAYTEST TELEMETRY ("GIVE CLAUDE MORE DATA", 2026-07-18) ---
// David plays a real run -> every meaningful metric gets timestamped into
// a downloadable session file -> Claude ingests it to find issues. Pure
// logic lives in game/telemetry.js; this file just wires it onto the same
// ui hooks presentation already subscribes through, plus one per-frame
// tick() call below for sampled fps/path/waypoints. See window.__deadfall
// .telemetry for the console API (start/stop/download/summaryLine).
const telemetry = createTelemetry();
const encounters = createEncounterTracker(telemetry);

// Browser / GPU / screen / quality, collected once per run for the session header.
function collectEnv() {
  let gpu = null;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { /* GPU string unavailable */ }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || null,
    gpu,
    screen: { w: screen.width, h: screen.height },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    renderPixelRatio: renderer.getPixelRatio(),
    antialias: !!renderer.getContextAttributes()?.antialias,
    shadows: !!renderer.shadowMap.enabled,
    cpuThreads: navigator.hardwareConcurrency ?? null,
    memoryGB: navigator.deviceMemory ?? null,
    language: navigator.language || null,
  };
}

// Uncaught errors and rejected promises, capped inside telemetry.
window.addEventListener('error', (ev) => {
  telemetry.recordError({ kind: 'error', message: ev.message, source: ev.filename, line: ev.lineno });
});
window.addEventListener('unhandledrejection', (ev) => {
  telemetry.recordError({ kind: 'unhandledrejection', message: ev.reason && ev.reason.message ? ev.reason.message : ev.reason });
});
// landmark positions are resolved once (gates/crossings sit on analytic
// centre-lines - landmarkPos() is deterministic, no need to recompute
// every frame) and reused for both the HUD reveal system and telemetry.
const TELEMETRY_LANDMARKS = LANDMARKS.map((l) => ({ name: l.name, r: l.r, ...landmarkPos(l) }));
let lastHurt = null; // {amount, srcPos, source} - reused as the death cause
// broken-telemetry P0 (2026-08-20): telemetryStartPerf anchors a wall-clock
// (performance.now()-based) time base for telemetry.tick(), independent of
// game.time (sim time), so state/path sampling keeps advancing through a
// pause instead of freezing. telemetryWasLocked tracks pointer-lock
// transitions so a pause/resume can be logged as an explicit event rather
// than the session just going quiet.
let telemetryStartPerf = 0;
let telemetryWasLocked = null;

// --- TELEMETRY V2 TRANSPORT (docs/References/Telemetry.md) ---
// David plays -> the disk endpoint (config/vite.config.js -> src/server/
// telemetryStore.js) is where it actually lands. Everything here is
// fire-and-forget: never await, never block the render loop, swallow every
// failure. Posted on a ~1s interval AND after every notable event AND at
// run end, so a died/refreshed/crashed tab loses at most ~1s of data
// instead of the whole run (the bug both 2026-07-18 playtests hit).
//
// Session posts go through a coalescing sender (see telemetrySender.js) -
// without it, overlapping POSTs can land out of order and a stale snapshot
// can clobber endRun()'s final state on disk (caught during end-to-end
// verification). Frame posts do not need this: each frame is written to
// its own uniquely-timestamped file, so there is nothing to overwrite.
// Flush policy (docs/References/Telemetry.md): the session is saved on a
// ~3 s timer while playing, immediately on every notable moment (kill,
// damage, waypoint, death, extraction, pause/resume, quit, start) and on
// visibilitychange / pagehide / beforeunload. Each flush sends only what the
// server does not have yet (telemetryDelta.js), one request at a time with a
// timeout, so a slow or failed request can never wedge the stream.
const sessionFlusher = createSessionFlusher({
  telemetry,
  post: async (body, { keepalive }) => {
    const res = await fetch('/telemetry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive,
      signal: AbortSignal.timeout(7000),
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { ok: res.ok, status: res.status, json };
  },
});
function postTelemetrySession() {
  sessionFlusher.flush();
}
telemetry.setNotifier((reason) => {
  if (reason === 'kill' || reason === 'damage') sessionFlusher.soft();
  else sessionFlusher.flush();
});

// Downscaled (~640px wide) JPEG of the current frame, via an offscreen
// canvas so the full-res render target is never touched. Returns null
// (never throws) if the canvas is not ready - callers just skip that beat.
let _frameCanvas = null;
function captureFrame() {
  try {
    const src = renderer.domElement;
    if (!src.width || !src.height) return null;
    const w = 640;
    const h = Math.max(1, Math.round(src.height * (w / src.width)));
    if (!_frameCanvas) _frameCanvas = document.createElement('canvas');
    _frameCanvas.width = w;
    _frameCanvas.height = h;
    _frameCanvas.getContext('2d').drawImage(src, 0, 0, w, h);
    return _frameCanvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return null;
  }
}

// Developer-only (DF-144): frames are JPEGs under captures/, so nothing is
// captured unless config/launcher.json developerMode is true. The server
// refuses them too; this check just skips the work.
let developerMode = false;
const developerModeReady = loadDeveloperMode(fetch).then((on) => { developerMode = on; });

// The WebGL canvas reads back black outside the render task, so postFrame only
// raises a flag and the frame loop sends it right after pipeline.render().
let framePending = false;
// frames sent this run; the server caps the session too (telemetryStore.writeFrame)
let framesSentThisRun = 0;
let frameCapLogged = false;
function postFrame() {
  if (!developerMode || !telemetry.recording || !telemetry.log) return;
  framePending = true;
}
function sendPendingFrame() {
  if (!framePending) return;
  framePending = false;
  if (!developerMode || !telemetry.recording || !telemetry.log) return;
  if (framesSentThisRun >= FRAME_CAP_PER_SESSION) {
    if (!frameCapLogged) {
      frameCapLogged = true;
      console.warn(`[deadfall] frame cap ${FRAME_CAP_PER_SESSION} reached; no more frames this run`);
    }
    return;
  }
  const dataURL = captureFrame();
  if (!dataURL) return;
  framesSentThisRun++;
  const startedAt = telemetry.log.startedAt;
  const t = Math.round(telemetry.elapsed() * 100) / 100;
  fetch('/telemetry/frame', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startedAt, t, dataURL }),
  }).catch(() => {});
}

// last-gasp flush when the page goes away - sendBeacon survives unload where
// a plain fetch can get cancelled. A run still in progress is closed as
// abandoned / tab-closed so the file says how it ended.
function lastGasp() {
  if (!telemetry.log) return;
  if (telemetry.recording) telemetry.stop('tab-closed');
  sessionFlusher.beacon((body) => navigator.sendBeacon
    && navigator.sendBeacon('/telemetry', new Blob([body], { type: 'application/json' })));
}
window.addEventListener('pagehide', lastGasp);
window.addEventListener('beforeunload', lastGasp);
document.addEventListener('visibilitychange', () => {
  if (!telemetry.recording) return;
  telemetry.recordEvent(document.hidden ? 'tab-hidden' : 'tab-visible');
  if (document.hidden) sessionFlusher.beacon((body) => navigator.sendBeacon
    && navigator.sendBeacon('/telemetry', new Blob([body], { type: 'application/json' })));
});

// periodic save - covers everything that is not an explicit event (path,
// state samples, input aggregates accumulating during ordinary play)
setInterval(() => { if (telemetry.recording) postTelemetrySession(); }, 3000);
setInterval(() => { if (telemetry.recording) postFrame(); }, FRAME_INTERVAL_S * 1000);

const ui = {
  toast: (msg, secs) => hud && hud.toast(msg, secs),
  setObjective: (text) => hud && hud.setObjective(text),
  showExtract: (progress) => hud && hud.showExtract(progress),
  hitmarker: (kill, crit) => {
    hud && hud.hitmarker(kill, crit);
    runHits += 1;
    telemetry.recordShotHit();
    if (kill) telemetry.recordKill();
  },
  onHurt(amount, srcPos, source, detail) {
    sfxHurt();
    vignette = 1;
    // detail: flood fields, or for acid {attacker, attackerPos} (the spitter that fired the glob)
    const { attacker, attackerPos: _firedFrom, ...extra } = detail || {};
    const where = hurtPositions(player.p.pos, srcPos, source, detail);
    const attackerId = encounters.noteHurt(source, srcPos, amount, attacker);
    lastHurt = { amount, srcPos, source, attackerType: where.attackerType, attackerId };
    // no time: telemetry stamps it on its own wall clock (see telemetry.elapsed)
    // pos is the PLAYER (srcPos is the attacker or impact point and goes to attackerPos)
    telemetry.recordDamageTaken({
      amount, source, hp: player.p.hp,
      ...where, attackerId,
      ...extra,
    });
    // hp on record right at the hit, not up to 1 s later (throttled to 4 per second)
    if (telemetry.recording && performance.now() - lastHurtSnapPerf > 250) {
      lastHurtSnapPerf = performance.now();
      telemetry.snapshotState(buildTelemetryCtx(performance.now(), 0.016));
    }
    if (amount >= DAMAGE_SPIKE_THRESHOLD) postFrame();
  },
  onDeath() {
    sfxStinger('death');
    telemetry.recordDeath({
      pos: { x: player.p.pos.x, y: player.p.pos.y, z: player.p.pos.z },
      cause: lastHurt ? lastHurt.source : 'unknown',
      enemy: lastHurt ? lastHurt.source : null,
      killerType: lastHurt ? lastHurt.attackerType : null,
      killerId: lastHurt ? lastHurt.attackerId : null,
      hp: player.p.hp,
    });
    if (telemetry.recording) telemetry.snapshotState(buildTelemetryCtx(performance.now(), 0.016));
    endRun(false, lastHurt ? lastHurt.source : null);
  },
  onWin() {
    sfxStinger('win');
    endRun(true);
  },
  onHazard(kind) {
    if (kind === 'razorfin') {
      sfxRazorfin();
      hud && hud.toast('RAZORFINS - GET OUT OF THE WATER', 1.2);
    } else if (kind === 'flood') {
      sfxRazorfin();
      hud && hud.toast('THE FLOOD FEEDS - GET ABOVE THE WATER', 1.2);
    }
  },
  onExtractTone: (progress) => sfxExtractTone(progress),
  onSurge: () => {
    telemetry.recordEvent('extraction', 'committed');
    postTelemetrySession();
    postFrame();
  },
  onBuff: () => sfxAyahuasca(),
  onWeather: (w, initial) => {
    applyWeatherFx(w, initial);
    if (!initial) {
      telemetry.recordEvent('weather', w.key);
      postTelemetrySession();
    }
  },
  onForeshadow: () => {
    // the apex is cued from afar before the drowned stair: a low call over
    // the water and a line of text, so her lair is never a surprise
    sfxCreature('miremother', { x: WORLD.maw.x, y: 0, z: WORLD.maw.z }, 0.9);
    hud && hud.toast('SOMETHING HUGE STIRS IN THE WATER AHEAD', 3.5);
    telemetry.recordEvent('boss', 'foreshadowed');
  },
  onBoss: () => {
    sfxCreature('miremother', { x: WORLD.maw.x, y: 0, z: WORLD.maw.z }, 1.8);
    telemetry.recordEvent('boss', 'spawned');
    postTelemetrySession();
    postFrame();
  },
  onFlood(phase) {
    // the flood announces itself like weather does - but it is a threat
    // with a clock, so every line names the correct response: UP
    if (phase === 'telegraph') {
      hud && hud.toast('THE GORGE IS SWELLING - GET TO HIGH GROUND', 4);
      sfxThunder(0.85); // the flood-front rolls like distant thunder
    } else if (phase === 'surge') {
      hud && hud.toast('FLOODWATER - CLIMB. NOW.', 3);
      sfxThunder(1);
    } else if (phase === 'recede') {
      hud && hud.toast('THE WATERS RECEDE', 2.5);
    }
    telemetry.recordEvent('flood', phase);
    postTelemetrySession();
    if (phase === 'surge') postFrame();
  },
};

// --- the game itself ---
const effects = createEffects(scene);
razorfins = createRazorfins(scene, effects);
boot.mark('effects');
const sim = createSim({ scene, camera, effects, ui });
boot.mark('sim');
const { game, player, weapons, grenades, enemyMgr, director, pickups, extraction } = sim;

// telemetry: wrap the two weaponHooks that carry per-shot detail sim.js
// doesn't otherwise surface to `ui` - shots fired (frequency/rate) and
// damage dealt per hit (target/headshot/crit, for a real accuracy +
// "what am I actually hurting" picture, not just aggregate kill counts).
{
  const origOnShot = sim.weaponHooks.onShot;
  sim.weaponHooks.onShot = () => {
    origOnShot();
    telemetry.recordShotFired();
  };
  const origOnEnemyHit = sim.weaponHooks.onEnemyHit;
  sim.weaponHooks.onEnemyHit = (enemy, dmg, headshot, point, crit) => {
    const res = origOnEnemyHit(enemy, dmg, headshot, point, crit);
    encounters.noteHit(enemy, weapons.state.current, res === 'kill');
    telemetry.recordDamageDealt({ amount: dmg, target: enemy.type, headshot, crit });
    return res;
  };
}

scene.add(camera); // viewmodel rig hangs off the camera
player.p.onStep = (wet, sprint) => sfxFootstep(wet, sprint);
player.p.onLand = (impact) => sfxLand(impact);

const input = createInput(renderer.domElement);
const viewmodel = createViewmodel(camera, weapons, player);
scene.add(viewmodel.flashGroup);
hud = createHud(player, weapons, game, director, grenades, sim);

// --- difficulty selection ---
let difficultyKey = localStorage.getItem('deadfall_difficulty') || DEFAULT_DIFFICULTY;
if (!DIFFICULTIES[difficultyKey]) difficultyKey = DEFAULT_DIFFICULTY;
// the difficulty of the last run started; PLAY AGAIN preselects it
let lastPlayedKey = difficultyKey;
sim.setDifficulty(difficultyKey);

// the same cards on the start screen and in the PLAY AGAIN step (DF-160)
const diffButtons = {};
for (const wrapId of ['difficulty', 'again-difficulty']) {
  const wrap = document.getElementById(wrapId);
  for (const key of Object.keys(DIFFICULTIES)) {
    const btn = document.createElement('button');
    btn.className = 'diff-btn';
    btn.innerHTML = `<b>${DIFFICULTIES[key].label}</b><span>${DIFFICULTIES[key].blurb}</span>`;
    btn.addEventListener('click', () => selectDifficulty(key));
    wrap.appendChild(btn);
    (diffButtons[key] ||= []).push(btn);
  }
}
function selectDifficulty(key) {
  difficultyKey = key;
  localStorage.setItem('deadfall_difficulty', key);
  sim.setDifficulty(key);
  for (const [k, btns] of Object.entries(diffButtons)) {
    for (const btn of btns) btn.classList.toggle('selected', k === key);
  }
}
selectDifficulty(difficultyKey);

// --- run lifecycle (presentation wrapper around sim.resetRun) ---
function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('deadfall_best2_' + difficultyKey)) || null;
  } catch {
    return null;
  }
}

function saveBest(extracted) {
  const best = loadBest();
  const run = { extracted, time: Math.round(game.time), kills: game.kills };
  // extraction beats non-extraction; then fastest extraction; then most kills
  const better = !best
    || (extracted && !best.extracted)
    || (extracted === !!best.extracted
      && (extracted ? run.time < best.time : run.kills > best.kills));
  if (better) localStorage.setItem('deadfall_best2_' + difficultyKey, JSON.stringify(run));
  return better;
}

let runHits = 0;
let lastHurtSnapPerf = 0;

function buildTelemetryCtx(now, dt) {
  const telemetryElapsedT = telemetryStartPerf ? (now - telemetryStartPerf) / 1000 : 0;
  terrainNormal(player.p.pos.x, player.p.pos.z, _slopeNormal);
  const slopeDeg = Math.acos(Math.min(1, Math.max(-1, _slopeNormal.y))) * RAD2DEG;
  const wst = weapons.state;
  return {
    time: telemetryElapsedT, pos: player.p.pos, fps, frameMs: dt * 1000,
    landmarks: TELEMETRY_LANDMARKS,
    yaw: player.p.yaw, hp: player.p.hp, stamina: player.p.stamina,
    ammo: { mag: wst.mag[wst.current], reserve: wst.reserve[wst.current] },
    weapon: wst.current, speedMps: player.p.speedNow,
    slopeDeg, verticalVel: player.p.vel.y, grounded: player.p.grounded,
    enemiesNear: computeEnemiesNear(player.p.pos), threat: director.threat(),
    extract: extraction.committed ? extraction.progress : null,
  };
}

function endRun(extracted, cause = null) {
  input.exitLock();
  hudEl.classList.add('hidden');
  endEl.classList.remove('hidden');
  const isRecord = saveBest(extracted);
  const view = resultView({
    extracted,
    difficulty: difficultyKey,
    difficultyLabel: DIFFICULTIES[difficultyKey].label,
    time: game.time,
    kills: game.kills,
    shots: game.shotsFired,
    hits: runHits,
    damage: game.damageTaken,
    isRecord,
    cause, // damage source of the last hit (K.I.A. only; see resultView)
  });
  telemetry.setResult({ score: view.score.total, grade: view.grade, title: view.rank, tag: view.tag });
  // closes the session: no sample, event or death can land in it after this
  // (the next startRun opens a fresh session)
  if (telemetry.finish(extracted ? 'extracted' : 'died', extracted ? 'extracted' : 'death')) {
    console.log(telemetry.summaryLine());
  }
  // guardrail: a died/extracted run always leaves its FINAL state (endedAt,
  // outcome, every channel) on disk before anything else happens
  postTelemetrySession();
  postFrame();
  renderResult(view);
}

function renderResult(view) {
  setAgainStep(false);
  const title = document.getElementById('end-title');
  title.textContent = view.title;
  title.className = 'title ' + view.titleClass;
  document.getElementById('end-diff').textContent = view.difficultyLabel;
  const statsEl = document.getElementById('end-stats');
  statsEl.textContent = '';
  for (const [label, value] of view.stats) {
    const stat = document.createElement('div');
    stat.className = 'result-stat';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('b');
    v.textContent = value;
    stat.append(l, v);
    statsEl.appendChild(stat);
  }
  const grade = document.getElementById('end-grade');
  grade.textContent = view.grade;
  grade.className = 'result-grade g-' + view.grade;
  document.getElementById('end-total').textContent = view.total + ' PTS';
  document.getElementById('end-rank').textContent = view.rank;
  document.getElementById('end-tag').textContent = view.tag;
  const bd = document.getElementById('end-breakdown');
  bd.textContent = '';
  const row = (label, value, cls) => {
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('b');
    v.textContent = value;
    if (cls) l.className = v.className = cls;
    bd.append(l, v);
  };
  // line items, DIFFICULTY, then TOTAL under a rule (resultView.rows)
  for (const [label, value] of view.rows) {
    if (label === 'TOTAL') {
      const sep = document.createElement('div');
      sep.className = 'sep';
      bd.appendChild(sep);
      row(label, value, 'tot');
    } else {
      row(label, value, value.startsWith('-') && value !== '-0' ? 'neg' : '');
    }
  }
  copyText = view.copyText;
  clearTimeout(copyResetTimer);
  setCopyState(false);
  document.getElementById('end-record').classList.toggle('hidden', !view.record);
  document.getElementById('end-killed').textContent = view.killedBy ? `KILLED BY ${view.killedBy}` : '';
  document.getElementById('end-flavor').textContent = view.flavor;
}

const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const endEl = document.getElementById('endscreen');
const btnCopy = document.getElementById('btn-copy');
let copyText = '';
let copyResetTimer = 0;
// icon-only copy control: clipboard icon, then a brief checkmark and "Copied"
function setCopyState(copied) {
  const label = copied ? 'Copied' : 'Copy result';
  btnCopy.classList.toggle('copied', copied);
  btnCopy.title = label;
  btnCopy.setAttribute('aria-label', label);
  btnCopy.innerHTML = copied
    ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
}
btnCopy.addEventListener('click', () => {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return;
  navigator.clipboard.writeText(copyText).then(() => {
    setCopyState(true);
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => setCopyState(false), 1500);
  }, () => {});
});

function startRun() {
  initAudio();
  resumeAudio();
  startAmbience();
  // roll the mood - same jungle, different fever. Live weather (storms,
  // fog banks) then evolves DURING the run, driven by the sim.
  const moodKeys = Object.keys(MOODS);
  currentMood = MOODS[moodKeys[Math.floor(Math.random() * moodKeys.length)]];
  applyMood(currentMood);
  drizzle.setLevel(currentMood.drizzle ? 0.45 : 0);
  setRain(currentMood.drizzle ? 0.45 : 0);
  sim.resetRun();
  vignette = 0;
  seenLandmarks.clear();
  lastHurt = null;
  telemetryWasLocked = null;
  telemetryStartPerf = performance.now();
  runHits = 0;
  framesSentThisRun = 0;
  frameCapLogged = false;
  encounters.reset();
  lastPlayedKey = difficultyKey;
  telemetry.start({ difficulty: difficultyKey, seed: WORLD.seed, gameVersion, env: collectEnv() });
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  input.requestLock();
}

const btnStart = document.getElementById('btn-start');
btnStart.addEventListener('click', () => {
  if (game.state === 'RUNNING') {
    // ESC pause -> resume the same run, do not reset it. Do NOT hide the
    // menu here: that used to be optimistic (assumed the lock request would
    // succeed). Browsers throttle/deny requestPointerLock() calls made too
    // soon after an unlock (e.g. resume right after an alt-tab) with no
    // pointerlockchange event at all - the menu we hid never came back and
    // the sim stayed frozen (2026-07-19 playtest freeze). The menu now only
    // hides once onLockChange actually confirms the lock, and the watchdog
    // below self-heals any other missed transition.
    input.requestLock();
  } else {
    startRun();
  }
});
// PLAY AGAIN opens the difficulty step with the last played difficulty
// preselected; DEPLOY in that step starts the run (DF-160)
function setAgainStep(open) {
  document.getElementById('btn-again').classList.toggle('hidden', open);
  document.getElementById('again-step').classList.toggle('hidden', !open);
}
document.getElementById('btn-again').addEventListener('click', () => {
  selectDifficulty(lastPlayedKey);
  setAgainStep(true);
});
document.getElementById('btn-again-back').addEventListener('click', () => setAgainStep(false));
document.getElementById('btn-deploy-again').addEventListener('click', startRun);
// Quit stops the hidden local game server (launch.bat starts it with no window).
function quitFromMenu() {
  // QUIT from the pause menu mid-run: save the ending BEFORE the server stops
  if (telemetry.recording) telemetry.stop('quit');
  sessionFlusher.drain().then(() => quitGame(fetch, document));
}
document.getElementById('btn-quit').addEventListener('click', quitFromMenu);

// Controls reminder (DF-106): shown once on a fresh profile, reopened from the menu
const controlsEl = document.getElementById('controls');
const controlsList = document.getElementById('controls-list');
for (const c of CONTROLS) {
  const li = document.createElement('li');
  const keys = document.createElement('b');
  keys.textContent = c.keys;
  li.append(keys, c.label);
  controlsList.appendChild(li);
}
function setControlsOpen(open) { controlsEl.classList.toggle('hidden', !open); }
document.getElementById('btn-controls').addEventListener('click', () => setControlsOpen(true));
document.getElementById('btn-controls-close').addEventListener('click', () => setControlsOpen(false));
{
  // reading the localStorage global itself can throw when site data is blocked
  let store = null;
  try { store = localStorage; } catch { /* blocked: shouldShow treats null as unseen */ }
  if (shouldShowControlsOnLaunch(store)) {
    setControlsOpen(true);
    markControlsSeen(store);
  }
}
document.getElementById('btn-end-quit').addEventListener('click', quitFromMenu);
startPing(fetch);
// Build version: console line + title-screen footer; kept for the telemetry session header.
let gameVersion = null;
loadVersion(fetch, document).then((v) => { gameVersion = v ? { sha: v.sha, date: v.date } : null; });

function syncPauseMenu() {
  const show = shouldShowMenu(game.state, input.state.locked);
  menuEl.classList.toggle('hidden', !show);
  hudEl.classList.toggle('over-menu', statsAboveMenu(game.state, input.state.locked));
  endEl.classList.toggle('hidden', !shouldShowEndScreen(game.state));
  btnStart.textContent = resumeButtonLabel(game.state);
}

input.state.onLockChange = () => syncPauseMenu();

// ESC fallback: if pointer lock is already gone (a prior unlock we somehow
// missed, or the browser ate the pointerlockchange event) the browser's
// native Escape-releases-lock behavior is a no-op and the player is stuck
// staring at a frozen game with no way back to the menu. A direct keydown
// handler means ESC always reaches the menu, independent of pointer lock
// event ordering.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || game.state !== 'RUNNING') return;
  input.exitLock();
  syncPauseMenu();
});

// --- named-place reveals: every landmark announces itself once per run ---
const seenLandmarks = new Set();
function updateLandmarkCallout() {
  const pp = player.p.pos;
  for (const l of LANDMARKS) {
    if (seenLandmarks.has(l.name)) continue;
    const p = landmarkPos(l);
    if (Math.hypot(pp.x - p.x, pp.z - p.z) < l.r) {
      seenLandmarks.add(l.name);
      hud.showLocation(l.name);
      break; // one reveal at a time - they are moments, not spam
    }
  }
}

// --- main loop ---
let last = performance.now();
let frames = 0;
let fpsTimer = 0;
let fps = 0;

let bootFirstFrame = true;
// dev server or ?bootprofile only: print where the startup time went and keep
// it on window.__bootProfile; a second table covers the next few frames
function reportBootProfile() {
  if (!bootProfileEnabled(location.search, import.meta.env?.DEV === true)) return;
  const rows = boot.report();
  window.__bootProfile = rows;
  console.log('[deadfall] boot profile', JSON.stringify(rows));
  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) longTasks.push({ at: Math.round(en.startTime), ms: Math.round(en.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* longtask unsupported */ }
  window.__bootLongTasks = longTasks;
}
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 2) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
  }

  // Self-healing pause watchdog: the menu's visibility must always match
  // (game.state, locked) even if a pointer-lock event (pointerlockchange,
  // blur, pointerlockerror) was missed entirely. Cheap (two property reads
  // + a class toggle) and closes the freeze bug's whole failure class
  // rather than one specific browser-event ordering.
  syncPauseMenu();

  // Telemetry must survive a pause/alt-tab (broken-telemetry P0,
  // 2026-08-20): this used to live inside the sim-step gate below, so any
  // pause or alt-tab silently halted sampling and the burst-flush along
  // with it. It is deliberately OUTSIDE that gate now - shouldRecordTelemetry
  // only cares that a run is in progress, never whether pointer lock holds.
  // Uses a wall-clock elapsed-since-telemetry-start value (telemetryElapsedT),
  // NOT game.time: game.time is sim time and correctly freezes while
  // paused (gameplay cooldowns/timers must not jump on resume), but a
  // frozen time value would stop the state/path sampler from ever
  // advancing again even though tick() keeps being called every frame.
  if (shouldRecordTelemetry(game.state)) {
    const locked = input.state.locked;
    if (telemetryWasLocked === true && locked === false) telemetry.recordEvent('paused');
    else if (telemetryWasLocked === false && locked === true) telemetry.recordEvent('resumed');
    telemetryWasLocked = locked;

    const telemetryElapsedT = telemetryStartPerf ? (now - telemetryStartPerf) / 1000 : 0;
    // telemetry v2 game-state ctx: everything main.js can see that the
    // spec's diagnosis fields need (stamina, uphill speed vs slope, jump
    // arcs, nearby-threat pressure) - see docs/References/Telemetry.md
    telemetry.tick(dt, buildTelemetryCtx(now, dt));
    if (encounters.due(telemetryElapsedT)) encounters.update(telemetryElapsedT, enemyMgr.aliveList(), { x: player.p.pos.x, z: player.p.pos.z, yaw: player.p.yaw });
  }

  // Sim advances only under pointer lock: ESC is a real pause, and the
  // autotest bot (which steps the sim itself, unlocked) never double-ticks.
  if (shouldStepSim(game.state, input.state.locked)) {
    const intent = input.sample();
    sim.step(intent, dt);
    viewmodel.update(intent, dt);
    effects.update(dt, camera);
    trackShadow(sun, player.p.pos);
    setListener(player.p.pos, camera.getWorldDirection(_listenerFwd));
    hud.update(dt);
    updateLandmarkCallout();
    telemetry.recordInput(intent, dt, {
      time: game.time, pos: player.p.pos,
      lookDeltaDeg: Math.hypot(intent.lookDX, intent.lookDY) * player.p.sensitivity * RAD2DEG,
    });
    razorfins.update(dt, now / 1000, player.p.pos, player.p.inWater);

    // apex health bar while she lives
    const bref = sim.boss.ref;
    if (bref && !bref.dead && bref.state !== 'dying') {
      hud.showBoss(sim.boss.name, bref.hp / sim.boss.maxHp);
    } else {
      hud.showBoss('', null);
    }

    // reactive dread: nearest hostile drives ambience; extraction keeps it hot
    let nearest = Infinity;
    for (const e of enemyMgr.aliveList()) {
      const dd = Math.hypot(e.pos.x - player.p.pos.x, e.pos.z - player.p.pos.z);
      if (dd < nearest) nearest = dd;
    }
    let danger = nearest === Infinity ? 0 : Math.max(0, Math.min(1, 1 - nearest / 48));
    if (extraction.committed && game.state === 'RUNNING' && extraction.progress < 1) {
      danger = Math.max(danger, 0.55);
    }
    updateAmbience(danger, dt);

    // low integrity: your own heart is the loudest thing in the jungle
    heartbeatT -= dt;
    if (player.p.hp < 30 && player.p.alive && heartbeatT <= 0) {
      sfxHeartbeat();
      heartbeatT = 0.65 + (player.p.hp / 30) * 0.55; // faster when closer to death
    }

    // FOV: sprint widens, ADS narrows toward the weapon's sight picture,
    // and the vine makes the whole view BREATHE
    const tripInten = Math.min(1, player.p.buffT / 3);
    const ads = weapons.state.adsBlend;
    const hipFov = player.p.sprinting ? BASE_FOV + 5 : BASE_FOV;
    const targetFov = hipFov + (weapons.def().adsFov - hipFov) * ads
      + Math.sin(now / 1000 * 1.3) * 2.5 * tripInten;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }

    motes.update(dt, now / 1000, player.p.pos, camera.quaternion);
    _yawQuat.setFromEuler(_yawEuler.set(0, player.p.yaw, 0));
    drizzle.update(dt, player.p.pos, _yawQuat);
    vignette = Math.max(0, vignette - dt * 1.6);
    vignetteEl.style.opacity = vignette * 0.9;

    // underwater tint: the round-1 "vanishing water" is now a real dive
    // (flood-aware: a risen surface can swallow the camera anywhere)
    const submerged = camera.position.y
      < waterLevelAt(camera.position.x, camera.position.z) + 0.12;
    underwaterEl.style.opacity = submerged ? 1 : 0;

    // ayahuasca: overlay fever + the full trip (x-ray, wavy world)
    feverEl.style.opacity = tripInten * 0.85;
    renderer.toneMappingExposure = 1.05 + tripInten * 0.35;

    const tripping = player.p.buffT > 0;
    if (tripping !== tripActive) {
      tripActive = tripping;
      applyXray(tripping);
      setSwayMult(tripping ? 3.6 : 1);
      if (!tripping) {
        ayaDispEl.setAttribute('scale', '0');
        renderer.domElement.style.filter = BASE_FILTER;
        camera.rotation.z = 0;
      }
    }
    if (tripActive) {
      // catch creatures spawned mid-trip
      xrayReapplyT -= dt;
      if (xrayReapplyT <= 0) {
        xrayReapplyT = 1.2;
        applyXray(true);
      }
      const tt = now / 1000;
      ayaDispEl.setAttribute('scale', String(24 * tripInten + Math.sin(tt * 1.7) * 6 * tripInten));
      ayaTurbEl.setAttribute('baseFrequency',
        `${(0.010 + Math.sin(tt * 0.23) * 0.004).toFixed(4)} ${(0.015 + Math.cos(tt * 0.19) * 0.004).toFixed(4)}`);
      const hue = Math.sin(tt * 0.5) * 22 * tripInten;
      renderer.domElement.style.filter = `${BASE_FILTER} hue-rotate(${hue.toFixed(1)}deg) url(#ayawave)`;
      camera.rotation.z += Math.sin(tt * 0.9) * 0.012 * tripInten;
    }
  }

  // --- live weather look: ease fog/light toward the current weather's
  // targets; storms darken toward slate and walk lightning through ---
  {
    const ease = Math.min(1, dt * 0.4);
    const targetDensity = currentMood.fogDensity * weatherFx.fogMult;
    scene.fog.density += (targetDensity - scene.fog.density) * ease;
    const stormy = weatherFx.key === 'storm' ? 1 : 0;
    _fogTarget.set(currentMood.fogColor).lerp(STORM_SLATE, stormy * 0.55);
    scene.fog.color.lerp(_fogTarget, ease);
    scene.background.lerp(_fogTarget, ease);
    lightningGlow = Math.max(0, lightningGlow - dt * 5);
    const targetSun = currentMood.sunIntensity * weatherFx.sunMult;
    sun.intensity += (targetSun - sun.intensity) * ease;
    // THUNDER WHITEOUT FIX (playtest bug, 2026-07-18): this used to be
    // `+= lightningGlow * 5`, fine back when render() was a bare LDR
    // renderer.render(). Round 6 made the scene real HDR with an
    // UnrealBloomPass thresholded at 1.0 linear luminance - a bare +5
    // spike on top of the ~2.3-3.1 baseline pushes nearly every lit pixel
    // on screen over that threshold AT ONCE, so bloom blows the whole
    // frame white instead of glowing a flash. Confirmed via in-browser
    // capture (sun.intensity 2.9 -> 7.9 = a wide white blowout patch
    // covering most of the visible ground). Cut the boost and hard-clamp
    // the total so a strike reads as a bright flash, not a wash.
    sun.intensity = Math.min(sun.intensity + lightningGlow * 1.4, targetSun + 1.6);
    hemi.intensity += (currentMood.hemiIntensity * (1 - stormy * 0.3) - hemi.intensity) * ease;

    if (weatherFx.key === 'storm' && game.state === 'RUNNING' && input.state.locked) {
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = 2.5 + Math.random() * 6.5;
        lightningGlow = 1;
        // same whiteout fix: the DOM flash overlay stacks with the HDR
        // bloom above it, so its own peak opacity also had to come down
        // (was 0.5-0.9 - a near-opaque white sheet over the whole canvas).
        lightningFlash = 0.22 + Math.random() * 0.18;
        const dist = Math.random(); // 0 = overhead, 1 = far
        setTimeout(() => sfxThunder(1 - dist * 0.65), 300 + dist * 1900);
      }
    }
    lightningFlash = Math.max(0, lightningFlash - dt * 3);
    lightningEl.style.opacity = lightningFlash;
  }

  // the flood re-poses the water surface + sweeps the red telegraph
  // (early-outs to nothing when no event is running)
  if (water.userData.setFlood) {
    const fs = sim.flood.state;
    water.userData.setFlood(fs.rise, fs.tintFront, fs.tintIntensity);
  }
  // EXTRACTION IGNITION (round 6 signature moment): committing to the
  // channel makes the beacon ANSWER - pillar ignites, lamp goes HDR-hot,
  // and a light ring races across the canopy on the commit edge and again
  // the moment you make it out.
  {
    const committed = extraction.committed && game.state === 'RUNNING';
    const targetK = committed ? 0.35 + extraction.progress * 0.65 : 0;
    igniteK += (targetK - igniteK) * Math.min(1, dt * (committed ? 3 : 1.2));
    igniteBeacon(igniteK);
    if (committed && !ignitionWasCommitted) ringPulse();
    ignitionWasCommitted = committed;
    if (game.state === 'WIN' && !ignitionWinFired) {
      ignitionWinFired = true;
      ringPulse();
    } else if (game.state === 'RUNNING') {
      ignitionWinFired = false;
    }
  }

  if (water.userData.tick) water.userData.tick(now / 1000);
  tickWind(now / 1000);
  tickMedusae(now / 1000);
  tickDapple(now / 1000);
  updateDappleSun(ATMOS.sunPos, sun.color, sun.intensity);
  tickProps(dt);
  if (bootFirstFrame) boot.mark('first frame: before render');
  pipeline.render();
  if (bootFirstFrame) {
    bootFirstFrame = false;
    boot.mark('first frame: render done (shader compile)');
    reportBootProfile();
  }
  sendPendingFrame();
}

const _listenerFwd = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _yawEuler = new THREE.Euler();
let heartbeatT = 0;
let igniteK = 0;
let ignitionWasCommitted = false;
let ignitionWinFired = false;

// telemetry v2 game-state enrichment: a reusable slope-normal target (no
// per-frame allocation) and a cheap radius scan of the enemy manager - both
// live here in main.js, not telemetry.js, so telemetry stays headless-safe
// (no three.js/enemyMgr coupling, see the file's own doc comment).
const _slopeNormal = { x: 0, y: 1, z: 0 };
const RAD2DEG = 180 / Math.PI;
const ENEMIES_NEAR_RADIUS = 60;
function computeEnemiesNear(pos) {
  const types = {};
  let count = 0;
  for (const e of enemyMgr.aliveList()) {
    const dx = e.pos.x - pos.x;
    const dz = e.pos.z - pos.z;
    if (dx * dx + dz * dz <= ENEMIES_NEAR_RADIUS * ENEMIES_NEAR_RADIUS) {
      count++;
      types[e.type] = (types[e.type] || 0) + 1;
    }
  }
  return { count, types };
}

requestAnimationFrame(tick);
boot.mark('script end');

// --- debug / automated-playtest API (documented in README) ---
const bot = createBot({ sim, startRun: () => sim.resetRun() });
const { snapshot } = createSnapshot({ sim, seed: WORLD.seed });
const shotsAPI = createShotsAPI({ renderer, camera, game, drizzle, effects, motes, applyMood, MOODS, scene, renderFrame });
const recorderAPI = createRecorderAPI({ getCanvas: () => renderer.domElement });
// THE TRAILER (round 5B): a replayable ~60s cinematic. The mood setter must
// go through currentMood or the per-frame weather easing (above) would drag
// the atmosphere back to the pre-cinematic mood within a second.
const cinematic = createCinematic({
  camera, renderer, scene, renderFrame,
  setMood: (key) => {
    currentMood = MOODS[key] || currentMood;
    applyMood(currentMood);
    drizzle.setLevel(currentMood.drizzle ? 0.45 : 0);
  },
  flood: sim.flood,
  water,
  enemyMgr,
  viewmodel,
  effects,
  recorder: recorderAPI,
  tickWind,
  tickMedusae,
  tickDapple,
  trackShadow,
  sun,
});
window.__deadfall = {
  version: 4,
  sim,
  input, // playtest API: input.state.locked can be forced for headed verification
  game,
  player,
  weapons,
  grenades,
  enemyMgr,
  director,
  pickups,
  extraction,
  hud,
  viewmodel,
  effects,
  applyMood,
  MOODS,
  drizzle,
  scene,
  camera,
  renderer,
  get fps() { return fps; },
  // control surface
  setDifficulty: (name) => sim.setDifficulty(name),
  startRun,            // full presentation run (menus, audio)
  startSimRun: () => sim.resetRun(), // silent sim-only run (bot/tests)
  step: (intent, dt) => sim.step(intent, dt),
  teleport(x, z) {
    player.p.pos.set(x, 0, z);
    player.p.pos.y = 200; // drop in; gravity settles onto terrain
  },
  god(on = true) {
    player.p.maxHp = on ? 1e9 : 100;
    player.p.hp = player.p.maxHp;
  },
  give(what, n = 1) {
    if (what === 'grenade') grenades.add(n);
    else if (what === 'ammo') {
      weapons.addAmmo('carbine', 90);
      weapons.addAmmo('breacher', 24);
      weapons.addAmmo('longarm', 16);
    }
  },
  snapshot,
  runBot: bot.runBot,
  shots: shotsAPI,
  // in-engine trailer capture (plumbing only - see src/capture/recorder.js).
  // window.__deadfall.recorder.start() / .stop() records the render canvas
  // to captures/telemetry/recordings/<file>.webm; camera choreography is a
  // later session's job.
  recorder: recorderAPI,
  // THE TRAILER (round 5B): cinematic.seek(t) poses camera + world at time t
  // deterministically; cinematic.play() runs it; cinematic.record() plays it
  // into the recorder and saves the .webm to captures/ (foreground window
  // required).
  cinematic,
  // THE FLOOD (round 5): trigger/inspect the event for grading + filming.
  // flood.trigger() springs it now (once per run - startSimRun to re-arm);
  // flood.state exposes phase/rise/tint for capture scripts.
  flood: sim.flood,
  dappleUniforms, // live dapple tuning from the console (art grading)
  // enemy-legibility metric: is a threat readable against dark/dappled
  // foliage? See game/legibility.js for the difference-imaging method.
  checkLegibility: (opts = {}) => checkLegibility({ renderer, camera, scene, game, enemyMgr, drizzle, effects, motes, renderFrame, ...opts }),
  // creature portrait/turntable rig - spawn one enemy, frame it, capture
  // portraits straight to captures/telemetry/frames/ (see game/viewer.js)
  viewer: makeViewer({ renderer, scene, camera, game, enemyMgr, drizzle, effects, motes, renderFrame, sim }),
  // round-6 rendering pipeline - pass toggles + uniforms for live A/B
  post: pipeline,
  // round-6 signature moment, drivable headlessly (hidden tabs have no
  // RAF, so capture rigs step tickProps themselves)
  ignition: { igniteBeacon, ringPulse, tickProps },
  // HUMAN-PLAYTEST TELEMETRY: auto-starts on startRun()/telemetry.start().
  // window.__deadfall.telemetry.stop() to close early, .download() to save
  // the session JSON, .summaryLine() for the one-line console readout,
  // .log for the live object (readable mid-run without stopping).
  telemetry,
  // save stats (sent, failed, bytes, ms) for measuring flush cost
  telemetryFlusher: sessionFlusher,
};
console.log('[deadfall] ready (round 2)');

// --- URL param entry point for screenshot rig ---
// ?shots=1  - boot the game, capture all vantages across all moods, save contact sheet to captures/
const params = new URLSearchParams(window.location.search);
if (params.has('shots')) {
  // Start the game silently and trigger capture after a brief delay to let the
  // world finish rendering.
  (async () => {
    try {
      await developerModeReady;
      if (!developerMode) {
        console.warn('[shots] skipped: screenshots are developer-only; set developerMode true in config/launcher.json');
        return;
      }
      console.log('[shots] URL param detected - starting automated capture...');
      sim.resetRun();
      // Small delay to let initial render settle
      await new Promise((resolve) => setTimeout(resolve, 500));
      const shots = await window.__deadfall.shots.captureShots();
      await window.__deadfall.shots.downloadShots(shots);
      console.log('[shots] capture complete - saved under captures/telemetry/shots/');
    } catch (err) {
      console.error('[shots] capture failed:', err);
    }
  })();
}

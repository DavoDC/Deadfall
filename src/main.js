// Deadfall - browser entry point. The GAME lives in src/game/sim.js (shared
// with the headless playtest runner); this file is presentation: renderer,
// input, HUD, audio, menus, atmosphere, and the debug/playtest API.
// State machine: MENU -> RUNNING (-> extraction channel) -> WIN | DEAD -> MENU.

import * as THREE from 'three';
import { WORLD, LANDMARKS, landmarkPos } from './world/heightmap.js';
import { buildTerrain, buildWater } from './world/terrain.js';
import { buildSky, trackShadow, MOODS } from './world/sky.js';
import { buildVegetation, tickWind } from './world/vegetation.js';
import { buildProps } from './world/props.js';
import { colliderCount } from './world/colliders.js';
import { createInput } from './player/input.js';
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
import { createBot } from './game/autotest.js';
import { createSnapshot } from './game/snapshot.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
// round-3 saturation push: Far Cry New Dawn vibrancy baseline; the
// ayahuasca trip appends its own distortion filters on top of this
const BASE_FILTER = 'saturate(1.3) contrast(1.04)';
renderer.domElement.style.filter = BASE_FILTER;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BASE_FOV = 74;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.08, 2400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- world ---
console.log('[deadfall] building world, seed', WORLD.seed);
const t0 = performance.now();
const { sun, hemi, applyMood } = buildSky(scene, renderer);
buildTerrain(scene);
const water = buildWater(scene);
buildVegetation(scene);
const { tickProps } = buildProps(scene);
const motes = createMotes(scene);
const drizzle = createDrizzle(scene);
console.log('[deadfall] world built in', Math.round(performance.now() - t0), 'ms,',
  colliderCount(), 'colliders');

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

const ui = {
  toast: (msg, secs) => hud && hud.toast(msg, secs),
  setObjective: (text) => hud && hud.setObjective(text),
  showExtract: (progress) => hud && hud.showExtract(progress),
  hitmarker: (kill, crit) => hud && hud.hitmarker(kill, crit),
  onHurt(amount) {
    sfxHurt();
    vignette = 1;
  },
  onDeath() {
    sfxStinger('death');
    endRun(false);
  },
  onWin() {
    sfxStinger('win');
    endRun(true);
  },
  onHazard(kind) {
    if (kind === 'razorfin') {
      sfxRazorfin();
      hud && hud.toast('RAZORFINS - GET OUT OF THE WATER', 1.2);
    }
  },
  onExtractTone: (progress) => sfxExtractTone(progress),
  onSurge: () => {},
  onBuff: () => sfxAyahuasca(),
  onWeather: (w, initial) => applyWeatherFx(w, initial),
};

// --- the game itself ---
const effects = createEffects(scene);
const sim = createSim({ scene, camera, effects, ui });
const { game, player, weapons, grenades, enemyMgr, director, pickups, extraction } = sim;

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
sim.setDifficulty(difficultyKey);

const diffButtons = {};
const diffWrap = document.getElementById('difficulty');
for (const key of Object.keys(DIFFICULTIES)) {
  const d = DIFFICULTIES[key];
  const btn = document.createElement('button');
  btn.className = 'diff-btn';
  btn.innerHTML = `<b>${d.label}</b><span>${d.blurb}</span>`;
  btn.addEventListener('click', () => selectDifficulty(key));
  diffWrap.appendChild(btn);
  diffButtons[key] = btn;
}
function selectDifficulty(key) {
  difficultyKey = key;
  localStorage.setItem('deadfall_difficulty', key);
  sim.setDifficulty(key);
  for (const [k, btn] of Object.entries(diffButtons)) {
    btn.classList.toggle('selected', k === key);
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

function endRun(extracted) {
  input.exitLock();
  hudEl.classList.add('hidden');
  endEl.classList.remove('hidden');
  const isRecord = saveBest(extracted);
  const title = document.getElementById('end-title');
  title.textContent = extracted ? 'EXTRACTED' : 'K.I.A.';
  title.className = 'title ' + (extracted ? 'extracted' : 'died');
  const mm = Math.floor(game.time / 60);
  const ss = String(Math.floor(game.time % 60)).padStart(2, '0');
  document.getElementById('end-stats').innerHTML =
    `${DIFFICULTIES[difficultyKey].label} &nbsp;·&nbsp; TIME <b>${mm}:${ss}</b> &nbsp;·&nbsp; KILLS <b>${game.kills}</b>`
    + ` &nbsp;·&nbsp; SHOTS <b>${game.shotsFired}</b> &nbsp;·&nbsp; DAMAGE TAKEN <b>${Math.round(game.damageTaken)}</b>`
    + (isRecord ? '<br/><span style="color:var(--accent)">NEW RECORD</span>' : '')
    + (extracted ? '' : '<br/>The jungle keeps what it kills.');
}

const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const endEl = document.getElementById('endscreen');

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
  menuEl.classList.add('hidden');
  endEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  input.requestLock();
}

const btnStart = document.getElementById('btn-start');
btnStart.addEventListener('click', () => {
  if (game.state === 'RUNNING') {
    // ESC pause -> resume the same run, do not reset it
    menuEl.classList.add('hidden');
    input.requestLock();
  } else {
    startRun();
  }
});
document.getElementById('btn-again').addEventListener('click', startRun);

input.state.onLockChange = (locked) => {
  if (!locked && game.state === 'RUNNING') {
    // treat unlock as pause -> menu overlay, run frozen (loop gates on lock)
    btnStart.textContent = 'RESUME';
    menuEl.classList.remove('hidden');
  } else if (locked && game.state === 'RUNNING') {
    menuEl.classList.add('hidden');
  }
  if (game.state !== 'RUNNING') btnStart.textContent = 'DEPLOY';
};

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

  // Sim advances only under pointer lock: ESC is a real pause, and the
  // autotest bot (which steps the sim itself, unlocked) never double-ticks.
  if (game.state === 'RUNNING' && input.state.locked) {
    const intent = input.sample();
    sim.step(intent, dt);
    viewmodel.update(intent, dt);
    effects.update(dt, camera);
    trackShadow(sun, player.p.pos);
    setListener(player.p.pos, camera.getWorldDirection(_listenerFwd));
    hud.update(dt);
    updateLandmarkCallout();

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

    // FOV: sprint widens, ADS narrows toward the weapon's sight picture
    const ads = weapons.state.adsBlend;
    const hipFov = player.p.sprinting ? BASE_FOV + 5 : BASE_FOV;
    const targetFov = hipFov + (weapons.def().adsFov - hipFov) * ads;
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
    const submerged = camera.position.y < WORLD.waterLevel + 0.12;
    underwaterEl.style.opacity = submerged ? 1 : 0;

    // ayahuasca fever: the world saturates and breathes
    const fever = Math.min(1, player.p.buffT / 3); // fades over the last 3s
    feverEl.style.opacity = fever * 0.85;
    renderer.toneMappingExposure = 1.05 + fever * 0.35;
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
    sun.intensity += lightningGlow * 5;
    hemi.intensity += (currentMood.hemiIntensity * (1 - stormy * 0.3) - hemi.intensity) * ease;

    if (weatherFx.key === 'storm' && game.state === 'RUNNING' && input.state.locked) {
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = 2.5 + Math.random() * 6.5;
        lightningGlow = 1;
        lightningFlash = 0.5 + Math.random() * 0.4;
        const dist = Math.random(); // 0 = overhead, 1 = far
        setTimeout(() => sfxThunder(1 - dist * 0.65), 300 + dist * 1900);
      }
    }
    lightningFlash = Math.max(0, lightningFlash - dt * 3);
    lightningEl.style.opacity = lightningFlash;
  }

  if (water.userData.tick) water.userData.tick(now / 1000);
  tickWind(now / 1000);
  tickProps(dt);
  renderer.render(scene, camera);
}

const _listenerFwd = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _yawEuler = new THREE.Euler();
let heartbeatT = 0;

requestAnimationFrame(tick);

// --- debug / automated-playtest API (documented in README) ---
const bot = createBot({ sim, startRun: () => sim.resetRun() });
const { snapshot } = createSnapshot({ sim, seed: WORLD.seed });
window.__deadfall = {
  version: 2,
  sim,
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
};
console.log('[deadfall] ready (round 2)');

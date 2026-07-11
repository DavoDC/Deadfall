// Deadfall - entry point and game orchestration.
// State machine: MENU -> RUNNING (-> extraction channel) -> WIN | DEAD -> MENU.

import * as THREE from 'three';
import { WORLD } from './world/heightmap.js';
import { buildTerrain, buildWater } from './world/terrain.js';
import { buildSky, trackShadow, MOODS } from './world/sky.js';
import { buildVegetation, tickWind } from './world/vegetation.js';
import { buildProps } from './world/props.js';
import { colliderCount } from './world/colliders.js';
import { createInput } from './player/input.js';
import { createPlayer } from './player/controller.js';
import { createWeapons } from './weapons/weapons.js';
import { createViewmodel } from './weapons/viewmodel.js';
import { createEffects } from './weapons/effects.js';
import { createEnemyManager } from './enemies/enemies.js';
import { createDirector } from './enemies/director.js';
import { createPickups } from './game/pickups.js';
import { createHud } from './game/hud.js';
import {
  initAudio, resumeAudio, setListener, sfxFootstep, sfxLand, sfxHurt,
  sfxExtractTone, sfxStinger, sfxHeartbeat,
} from './audio/engine.js';
import { startAmbience, updateAmbience, setRain } from './audio/ambience.js';
import { createMotes, createDrizzle } from './world/motes.js';
import { createBot } from './game/autotest.js';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 2200);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- world ---
console.log('[deadfall] building world, seed', WORLD.seed);
const t0 = performance.now();
const { sun, applyMood } = buildSky(scene, renderer);
buildTerrain(scene);
const water = buildWater(scene);
buildVegetation(scene);
const { tickProps } = buildProps(scene);
const motes = createMotes(scene);
const drizzle = createDrizzle(scene);
console.log('[deadfall] world built in', Math.round(performance.now() - t0), 'ms,',
  colliderCount(), 'colliders');

// --- game state ---
const game = {
  state: 'MENU', // MENU | RUNNING | DEAD | WIN
  time: 0,       // seconds since run start
  kills: 0,
  shotsFired: 0,
};

// --- player ---
const input = createInput(renderer.domElement);
const player = createPlayer(camera);
scene.add(camera); // viewmodel rig hangs off the camera
player.p.onStep = (wet, sprint) => sfxFootstep(wet, sprint);
player.p.onLand = (impact) => sfxLand(impact);

// --- combat ---
const effects = createEffects(scene);
const weaponHooks = {
  rayEnemies: null, // installed by enemies module
  onTracer: (from, to) => effects.spawnTracer(from, to),
  onImpact: (point, kind) => effects.burst(point, kind),
  onEnemyHit: null, // installed by enemies module
  onShot: null,     // installed by director (gunfire raises heat)
  onHitmarker: null, // installed by HUD
};
const weapons = createWeapons(camera, player, weaponHooks);
const viewmodel = createViewmodel(camera, weapons, player);
scene.add(viewmodel.flashGroup);

// --- enemies + director ---
const vignetteEl = document.getElementById('vignette');
let vignette = 0;
let pickupsRef = null; // assigned below; enemy kills drop supplies through it
const enemyMgr = createEnemyManager(scene, player, effects, {
  damagePlayer(amount, srcPos) {
    if (game.state !== 'RUNNING' || !player.p.alive) return;
    player.damage(amount);
    sfxHurt();
    vignette = 1;
    if (!player.p.alive) onPlayerDeath();
  },
  onKill(type, pos) {
    game.kills += 1;
    // dying enemies drop supplies; juggernauts drop a cache
    if (!pickupsRef) return;
    if (type === 'juggernaut') pickupsRef.dropAt(pos.x, pos.z, true);
    else if (Math.random() < 0.35) pickupsRef.dropAt(pos.x, pos.z, false);
  },
});
const director = createDirector(enemyMgr, player);
weaponHooks.rayEnemies = (origin, dir, maxDist) => enemyMgr.rayEnemies(origin, dir, maxDist);
weaponHooks.onEnemyHit = (enemy, dmg, headshot, point) => enemyMgr.applyDamage(enemy, dmg, headshot, point);
weaponHooks.onShot = () => {
  director.onShot();
  game.shotsFired += 1;
};

// --- pickups + HUD ---
const hud = createHud(player, weapons, game, director);
const pickups = createPickups(scene, player, weapons, {
  heal(amount) {
    const before = player.p.hp;
    player.heal(amount);
    return player.p.hp - before;
  },
  toast(msg) {
    hud.toast(msg);
  },
});
weaponHooks.onHitmarker = (kill) => hud.hitmarker(kill);
pickupsRef = pickups;

// --- extraction ---
const extraction = {
  progress: 0,
  active: false,     // player currently in the zone
  committed: false,  // surge triggered (stays on once you start)
  toneAt: 0,
};

function updateExtraction(dt) {
  const ex = WORLD.extraction;
  const dx = player.p.pos.x - ex.x;
  const dz = player.p.pos.z - ex.z;
  const inZone = dx * dx + dz * dz < ex.radius * ex.radius;

  if (inZone && !extraction.active) {
    extraction.active = true;
    if (!extraction.committed) {
      extraction.committed = true;
      director.startSurge();
      hud.toast('HOLD THE BEACON', 2.4);
      hud.setObjective('HOLD FOR EXTRACTION');
    }
  } else if (!inZone && extraction.active) {
    extraction.active = false;
    hud.setObjective('RETURN TO THE BEACON');
  }

  if (extraction.active) {
    extraction.progress = Math.min(1, extraction.progress + dt / 18);
    if (extraction.progress - extraction.toneAt >= 0.1) {
      extraction.toneAt = extraction.progress;
      sfxExtractTone(extraction.progress);
    }
    if (extraction.progress >= 1) {
      winRun();
      return;
    }
  }
  hud.showExtract(extraction.committed ? extraction.progress : null);
}

function winRun() {
  game.state = 'WIN';
  sfxStinger('win');
  endRun(true);
}

function onPlayerDeath() {
  game.state = 'DEAD';
  sfxStinger('death');
  endRun(false);
}

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('deadfall_best')) || null;
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
  if (better) localStorage.setItem('deadfall_best', JSON.stringify(run));
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
  const acc = game.shotsFired > 0 ? '' : '';
  document.getElementById('end-stats').innerHTML =
    `TIME <b>${mm}:${ss}</b> &nbsp;·&nbsp; KILLS <b>${game.kills}</b> &nbsp;·&nbsp; SHOTS <b>${game.shotsFired}</b>${acc}` +
    (isRecord ? '<br/><span style="color:var(--accent)">NEW RECORD</span>' : '') +
    (extracted ? '' : '<br/>The jungle keeps what it kills.');
}

const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const endEl = document.getElementById('endscreen');

function startRun() {
  initAudio();
  resumeAudio();
  startAmbience();
  // roll the weather - same jungle, different day
  const moodKeys = Object.keys(MOODS);
  const mood = MOODS[moodKeys[Math.floor(Math.random() * moodKeys.length)]];
  applyMood(mood);
  drizzle.setEnabled(!!mood.drizzle);
  setRain(!!mood.drizzle);
  player.reset();
  weapons.reset();
  enemyMgr.reset();
  director.reset();
  pickups.reset();
  extraction.progress = 0;
  extraction.active = false;
  extraction.committed = false;
  extraction.toneAt = 0;
  hud.setObjective('REACH THE EXTRACTION BEACON');
  hud.showExtract(null);
  vignette = 0;
  game.state = 'RUNNING';
  game.time = 0;
  game.kills = 0;
  game.shotsFired = 0;
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
  // autotest bot (which steps the systems itself, unlocked) never double-ticks.
  if (game.state === 'RUNNING' && input.state.locked) {
    game.time += dt;
    const intent = input.sample();
    player.update(intent, dt);
    weapons.update(intent, dt, game.time);
    viewmodel.update(intent, dt);
    effects.update(dt, camera);
    enemyMgr.update(dt);
    director.update(dt);
    pickups.update(dt);
    if (game.state === 'RUNNING') updateExtraction(dt);
    trackShadow(sun, player.p.pos);
    setListener(player.p.pos, camera.getWorldDirection(_listenerFwd));
    hud.update(dt);

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

    // sprint FOV kick
    const targetFov = player.p.sprinting ? 79 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
      camera.updateProjectionMatrix();
    }
    motes.update(dt, now / 1000, player.p.pos, camera.quaternion);
    _yawQuat.setFromEuler(_yawEuler.set(0, player.p.yaw, 0));
    drizzle.update(dt, player.p.pos, _yawQuat);
    vignette = Math.max(0, vignette - dt * 1.6);
    vignetteEl.style.opacity = vignette * 0.9;
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

const EMPTY_INTENT = {
  moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, sprint: false, jump: false,
  reload: false, weapon1: false, weapon2: false, swap: false, interact: false,
  firing: false, fireDown: false,
};

requestAnimationFrame(tick);

// --- debug / automated-test API ---
window.__deadfall = {
  game,
  player,
  weapons,
  weaponHooks,
  effects,
  viewmodel,
  enemyMgr,
  director,
  pickups,
  hud,
  extraction,
  updateExtraction,
  applyMood,
  MOODS,
  drizzle,
  runBot: null, // assigned below
  scene,
  camera,
  renderer,
  get fps() { return fps; },
  startRun,
  teleport(x, z) {
    player.p.pos.set(x, 0, z);
    player.p.pos.y = 200; // drop in; gravity settles onto terrain
  },
};
const bot = createBot({
  player, weapons, enemyMgr, director, pickups, game, updateExtraction, startRun,
});
window.__deadfall.runBot = bot.runBot;
console.log('[deadfall] ready');

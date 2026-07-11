// Deadfall - entry point and game orchestration.
// State machine: MENU -> RUNNING (-> extraction channel) -> WIN | DEAD -> MENU.

import * as THREE from 'three';
import { WORLD } from './world/heightmap.js';
import { buildTerrain, buildWater } from './world/terrain.js';
import { buildSky, trackShadow } from './world/sky.js';
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
import {
  initAudio, resumeAudio, setListener, sfxFootstep, sfxLand, sfxHurt,
} from './audio/engine.js';

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
const { sun } = buildSky(scene, renderer);
buildTerrain(scene);
const water = buildWater(scene);
buildVegetation(scene);
const { tickProps } = buildProps(scene);
console.log('[deadfall] world built in', Math.round(performance.now() - t0), 'ms,',
  colliderCount(), 'colliders');

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
const enemyMgr = createEnemyManager(scene, player, effects, {
  damagePlayer(amount, srcPos) {
    if (game.state !== 'RUNNING' || !player.p.alive) return;
    player.damage(amount);
    sfxHurt();
    vignette = 1;
    if (!player.p.alive) onPlayerDeath();
  },
  onKill(type) {
    game.kills += 1;
  },
});
const director = createDirector(enemyMgr, player);
weaponHooks.rayEnemies = (origin, dir, maxDist) => enemyMgr.rayEnemies(origin, dir, maxDist);
weaponHooks.onEnemyHit = (enemy, dmg, headshot, point) => enemyMgr.applyDamage(enemy, dmg, headshot, point);
weaponHooks.onShot = () => {
  director.onShot();
  game.shotsFired += 1;
};

function onPlayerDeath() {
  game.state = 'DEAD';
  endRun(false);
}

function endRun(extracted) {
  // placeholder - full end screen lands with the run-loop module
  input.exitLock();
  hudEl.classList.add('hidden');
  endEl.classList.remove('hidden');
  const title = document.getElementById('end-title');
  title.textContent = extracted ? 'EXTRACTED' : 'K.I.A.';
  title.className = 'title ' + (extracted ? 'extracted' : 'died');
  document.getElementById('end-stats').innerHTML =
    `TIME <b>${Math.floor(game.time / 60)}:${String(Math.floor(game.time % 60)).padStart(2, '0')}</b>` +
    ` &nbsp; KILLS <b>${game.kills}</b> &nbsp; SHOTS <b>${game.shotsFired}</b>`;
}

// --- game state ---
const game = {
  state: 'MENU', // MENU | RUNNING | DEAD | WIN
  time: 0,       // seconds since run start
  kills: 0,
  shotsFired: 0,
};

const menuEl = document.getElementById('menu');
const hudEl = document.getElementById('hud');
const endEl = document.getElementById('endscreen');

function startRun() {
  initAudio();
  resumeAudio();
  player.reset();
  weapons.reset();
  enemyMgr.reset();
  director.reset();
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

document.getElementById('btn-start').addEventListener('click', startRun);
document.getElementById('btn-again').addEventListener('click', startRun);

input.state.onLockChange = (locked) => {
  if (!locked && game.state === 'RUNNING') {
    // treat unlock as pause -> back to menu overlay without resetting
    menuEl.classList.remove('hidden');
  } else if (locked && game.state === 'RUNNING') {
    menuEl.classList.add('hidden');
  }
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

  if (game.state === 'RUNNING') {
    game.time += dt;
    const intent = input.state.locked ? input.sample() : EMPTY_INTENT;
    player.update(intent, dt);
    weapons.update(intent, dt, game.time);
    viewmodel.update(intent, dt);
    effects.update(dt, camera);
    enemyMgr.update(dt);
    director.update(dt);
    trackShadow(sun, player.p.pos);
    setListener(player.p.pos, camera.getWorldDirection(_listenerFwd));
    updateAmmoHud();
    // damage vignette + health bar
    vignette = Math.max(0, vignette - dt * 1.6);
    vignetteEl.style.opacity = vignette * 0.9;
    const hb = document.getElementById('health-bar');
    const frac = player.p.hp / player.p.maxHp;
    hb.style.width = `${frac * 100}%`;
    hb.classList.toggle('low', frac < 0.33);
  }

  if (water.userData.tick) water.userData.tick(now / 1000);
  tickWind(now / 1000);
  tickProps(dt);
  renderer.render(scene, camera);
}

const _listenerFwd = new THREE.Vector3();

// temporary ammo HUD hookup (full HUD module lands with the run loop)
const ammoEl = document.getElementById('ammo');
const weaponNameEl = document.getElementById('weapon-name');
const reloadHintEl = document.getElementById('reload-hint');
function updateAmmoHud() {
  const st = weapons.state;
  const mag = st.mag[st.current];
  const res = st.reserve[st.current];
  ammoEl.innerHTML = `${mag} <span class="reserve">/ ${res}</span>`;
  ammoEl.classList.toggle('empty', mag === 0);
  weaponNameEl.textContent = weapons.def().name;
  reloadHintEl.style.opacity =
    (mag <= 5 && res > 0 && st.reloading <= 0) ? 1 : 0;
}

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
console.log('[deadfall] ready');

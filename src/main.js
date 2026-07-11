// Deadfall - entry point and game orchestration.
// State machine: MENU -> RUNNING (-> extraction channel) -> WIN | DEAD -> MENU.

import * as THREE from 'three';
import { WORLD } from './world/heightmap.js';
import { buildTerrain, buildWater } from './world/terrain.js';
import { buildSky, trackShadow } from './world/sky.js';
import { createInput } from './player/input.js';
import { createPlayer } from './player/controller.js';

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
console.log('[deadfall] world built in', Math.round(performance.now() - t0), 'ms');

// --- player ---
const input = createInput(renderer.domElement);
const player = createPlayer(camera);

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
  player.reset();
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
    trackShadow(sun, player.p.pos);
  }

  if (water.userData.tick) water.userData.tick(now / 1000);
  renderer.render(scene, camera);
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

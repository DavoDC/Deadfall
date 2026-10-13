#!/usr/bin/env node
import * as THREE from 'three';
import { WORLD } from '../../world/heightmap.js';
import { buildVegetation } from '../../world/vegetation.js';
import { buildProps } from '../../world/props.js';
import { createSim } from '../../game/sim.js';
import { createBot } from '../../game/autotest.js';

const scene = new THREE.Scene();
const veg = buildVegetation(scene, { collidersOnly: true });
buildProps(scene);

const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
const fxStub = { spawnTracer() {}, burst() {}, update() {} };
const sim = createSim({ scene, camera, effects: fxStub, ui: {} });
const bot = createBot({ sim, startRun: () => sim.resetRun() });

console.log('[test] Running 20 baseline runs on normal/river...');
const results = { wins: 0, total: 0 };
for (let i = 0; i < 20; i++) {
  const rep = await bot.runBot('river', { difficulty: 'normal' });
  results.total++;
  if (rep.result === 'WIN') results.wins++;
  console.log(`[${i+1}/20] ${rep.result}`);
}
console.log(`\n=== DISTRIBUTION: ${results.wins}/${results.total} wins ===`);

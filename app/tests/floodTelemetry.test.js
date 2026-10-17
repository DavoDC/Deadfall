// DF-164: a flood hit in damageTaken carries feetY, waterY, depth and onCrown,
// so any death near the flood explains itself.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createSim } from '../src/game/sim.js';
import { createTelemetry } from '../src/game/telemetry.js';
import { clearPlatforms } from '../src/world/platforms.js';
import { FLOOD, terrainHeight, waterLevelAt } from '../src/world/heightmap.js';
import { ROOSTS, buildRoosts } from '../src/world/roosts.js';
import { analyse, formatReport } from '../src/tools/analyzeSession.mjs';

beforeEach(() => {
  FLOOD.rise = 0;
  clearPlatforms();
});

const IDLE = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, sprint: false, jump: false, aim: false, fire: false, reload: false };

function makeSim(hurts) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
  const effects = { spawnTracer() {}, burst() {}, update() {} };
  const ui = { onHurt: (amount, srcPos, source, detail) => hurts.push({ amount, srcPos, source, detail }) };
  const sim = createSim({ scene, camera, effects, ui });
  sim.resetRun();
  sim.flood.trigger();
  sim.flood.update(12, [], 60);
  sim.flood.update(26, [], 60);
  return sim;
}

describe('flood hit telemetry (DF-164)', () => {
  it('a simulated flood hit reports feetY, waterY, depth and onCrown', () => {
    buildRoosts(new THREE.Scene(), { collidersOnly: true });
    const crown = ROOSTS.find((r) => r.name.startsWith('THE RAPIDS ROOST (N)'));
    const hurts = [];
    const sim = makeSim(hurts);
    const ctrl = sim.player;
    const wx = crown.top.x + 12;
    const wz = crown.top.z;
    const feet = terrainHeight(wx, wz);
    ctrl.p.alive = true;
    ctrl.p.hp = 100;
    ctrl.p.pos.set(wx, feet + ctrl.EYE_HEIGHT, wz);
    for (let t = 0; t < 2; t += 1 / 60) sim.step(IDLE, 1 / 60);
    const hit = hurts.find((h) => h.source === 'flood');
    expect(hit).toBeTruthy();
    expect(hit.detail.waterY).toBeCloseTo(waterLevelAt(wx, wz), 5);
    expect(hit.detail.feetY).toBeCloseTo(feet, 1);
    expect(hit.detail.depth).toBeCloseTo(hit.detail.waterY - hit.detail.feetY, 5);
    expect(hit.detail.depth).toBeGreaterThan(0.9);
    expect(hit.detail.onCrown).toBe(false);
    // the source position is the water sample, not the player's own eye
    expect(hit.srcPos.y).toBeCloseTo(hit.detail.waterY, 5);
  });

  it('telemetry stores the four fields on a flood entry and omits them on others', () => {
    const t = createTelemetry();
    t.start({});
    t.recordDamageTaken({ amount: 5, source: 'flood', pos: { x: 1, y: 2, z: 3 }, hp: 90, feetY: 1, waterY: 4, depth: 3, onCrown: false });
    t.recordDamageTaken({ amount: 5, source: 'prowler', pos: { x: 1, y: 2, z: 3 }, hp: 85 });
    const [f, p] = t.log.damageTaken;
    expect(f).toMatchObject({ feetY: 1, waterY: 4, depth: 3, onCrown: false });
    expect(p).not.toHaveProperty('feetY');
  });

  it('analyzeSession prints the fields for a flood death', () => {
    const s = {
      version: 2, outcome: 'died', endReason: 'death', startedAt: 1, endedAt: 2, lastSavedAt: 2,
      deaths: [{ time: 50, cause: 'flood' }],
      damageTaken: [{ time: 49, amount: 9, source: 'flood', hp: 0, feetY: 5.1, waterY: 7.3, depth: 2.2, onCrown: false }],
      damageTakenBySource: { flood: 9 }, path: [], state: [], fps: [], waypoints: [], events: [],
    };
    expect(formatReport(analyse(s))).toContain('Flood death: feet 5.1 m, water 7.3 m, depth 2.2 m, wading, not on a crown');
  });
});

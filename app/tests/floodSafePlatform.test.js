// Flood safe platform (DF-158 investigation). A player standing ON a gorge
// roost crown (the real platform disc, built by the real buildRoosts) at the
// flood peak must take zero flood damage. A control player standing in the
// water beside the crown must take flood damage, so a silent pass cannot
// come from a broken probe.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createSim } from '../src/game/sim.js';
import { ROOSTS, buildRoosts, CROWN_R } from '../src/world/roosts.js';
import { clearPlatforms, platformGroundAt } from '../src/world/platforms.js';
import { FLOOD, terrainHeight, waterLevelAt } from '../src/world/heightmap.js';

beforeEach(() => {
  FLOOD.rise = 0;
  clearPlatforms();
});

function makeSim() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
  const effects = { spawnTracer() {}, burst() {}, update() {} };
  const sim = createSim({ scene, camera, effects, ui: {} });
  sim.resetRun();
  return sim;
}

// drive the real flood phase machine to its peak (telegraph 12s, surge 26s)
function floodToPeak(sim) {
  sim.flood.trigger();
  sim.flood.update(12, [], 60);
  sim.flood.update(26, [], 60);
  expect(sim.flood.state.phase).toBe('peak');
  expect(FLOOD.rise).toBe(FLOOD.RISE_MAX);
}

function standAt(ctrl, x, z, feetY) {
  ctrl.p.pos.x = x;
  ctrl.p.pos.z = z;
  ctrl.p.pos.y = feetY + ctrl.EYE_HEIGHT;
}

// a neutral intent: standing still, no fire, no jump
const IDLE = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, sprint: false, jump: false, aim: false, fire: false, reload: false };

// real frame step (60 Hz): a coarse step lets gravity sink the feet out of the crown's step window
const DT = 1 / 60;

function runHazardTicks(sim, seconds) {
  for (let t = 0; t < seconds; t += DT) sim.step(IDLE, DT);
}

describe('flood safe platform (DF-158)', () => {
  it('a player standing on any gorge roost crown takes zero flood damage at peak', () => {
    buildRoosts(new THREE.Scene(), { collidersOnly: true });
    expect(ROOSTS.length).toBeGreaterThan(0);
    for (const crown of ROOSTS) {
      const sim = makeSim();
      floodToPeak(sim);
      const ctrl = sim.player;
      ctrl.p.alive = true;
      ctrl.p.hp = 100;
      // the crown's standing height comes from the real platform disc
      expect(platformGroundAt(crown.top.x, crown.top.z, crown.top.y), crown.name).toBe(crown.top.y);
      standAt(ctrl, crown.top.x, crown.top.z, crown.top.y);
      runHazardTicks(sim, 4);
      expect(ctrl.p.alive, crown.name).toBe(true);
      expect(sim.game.dmgBySource.flood || 0, crown.name).toBe(0);
      expect(ctrl.p.hp, crown.name).toBe(100);
    }
  });

  it('control: a player standing in the risen water next to the crown takes flood damage', () => {
    buildRoosts(new THREE.Scene(), { collidersOnly: true });
    const crown = ROOSTS.find((r) => r.name.startsWith('THE RAPIDS ROOST (N)'));
    const sim = makeSim();
    floodToPeak(sim);
    const ctrl = sim.player;
    ctrl.p.alive = true;
    ctrl.p.hp = 100;
    // 12m off the crown, on the bank, inside the flood band: real water above feet
    const wx = crown.top.x + 12;
    const wz = crown.top.z;
    const feet = terrainHeight(wx, wz);
    expect(waterLevelAt(wx, wz) - feet).toBeGreaterThan(2.2);
    expect(platformGroundAt(wx, wz, feet)).toBe(-Infinity);
    standAt(ctrl, wx, wz, feet);
    runHazardTicks(sim, 4);
    expect(sim.game.dmgBySource.flood || 0).toBeGreaterThan(0);
  });
});


describe('crown physics covers the visible crown (DF-158)', () => {
  it('standing 2.45 m from the centre at peak flood takes zero flood damage', () => {
    buildRoosts(new THREE.Scene(), { collidersOnly: true });
    expect(CROWN_R).toBeGreaterThanOrEqual(2.5);
    for (const crown of ROOSTS) {
      const sim = makeSim();
      floodToPeak(sim);
      const ctrl = sim.player;
      ctrl.p.alive = true;
      ctrl.p.hp = 100;
      // 2.45 m from the centre, away from the ramp side (the ramp climbs from -dir)
      const x = crown.top.x + crown.dir * 2.45;
      expect(platformGroundAt(x, crown.top.z, crown.top.y), crown.name).toBe(crown.top.y);
      standAt(ctrl, x, crown.top.z, crown.top.y);
      runHazardTicks(sim, 4);
      expect(sim.game.dmgBySource.flood || 0, crown.name).toBe(0);
      expect(ctrl.p.hp, crown.name).toBe(100);
    }
  });
});

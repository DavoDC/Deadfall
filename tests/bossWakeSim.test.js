import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSim } from '../src/game/sim.js';
import { WORLD } from '../src/world/heightmap.js';

// Integration check that updateBoss() (sim.js, invoked every step()) wires
// up bossWake.js's shouldWakeMiremother correctly - the pure predicate is
// unit-tested in tests/bossWake.test.js.

function makeSim() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
  const effects = { spawnTracer() {}, burst() {}, update() {} };
  const sim = createSim({ scene, camera, effects, ui: {} });
  sim.resetRun();
  return sim;
}

describe('updateBoss wiring: the Miremother is the crescendo, not the opener (root cause 6)', () => {
  it('does not spawn the moment extraction commits, far from the moat', () => {
    const sim = makeSim();
    // put the player far from the moat so proximity does not confound this
    sim.player.p.pos.set(WORLD.extraction.x, sim.player.p.pos.y, WORLD.extraction.z);
    sim.extraction.committed = true;
    sim.extraction.progress = 0;
    sim.step({}, 1 / 60);
    expect(sim.boss.spawned).toBe(false);
  });

  it('spawns once the hold reaches the crescendo threshold', () => {
    const sim = makeSim();
    sim.player.p.pos.set(WORLD.extraction.x, sim.player.p.pos.y, WORLD.extraction.z);
    sim.extraction.committed = true;
    sim.extraction.progress = 0.5;
    sim.step({}, 1 / 60);
    expect(sim.boss.spawned).toBe(true);
  });
});

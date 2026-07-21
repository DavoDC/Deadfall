import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSim } from '../src/game/sim.js';

// Integration check that damagePlayer() (sim.js) actually wires up
// burstGrace.js - the pure math is unit-tested in tests/burstGrace.test.js,
// this proves the real call site behaves the same way.

function makeSim() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
  const effects = { spawnTracer() {}, burst() {}, update() {} };
  const sim = createSim({ scene, camera, effects, ui: {} });
  sim.resetRun();
  return sim;
}

describe('damagePlayer: anti-burst grace wiring (root cause 5)', () => {
  it('is scoped to the extraction hold - no softening before commit', () => {
    // early build applied this everywhere and measurably softened the
    // whole run (normal win-rate 33% -> ~90% in the critic) - it must be
    // inert outside the hold this round targets.
    const sim = makeSim();
    sim.player.p.hp = 100;
    sim.extraction.committed = false;
    sim.game.time = 10;
    sim.damagePlayer(20, sim.player.p.pos, 'prowler');
    sim.game.time = 10.1;
    sim.damagePlayer(20, sim.player.p.pos, 'prowler');
    expect(sim.player.p.hp).toBe(60); // both full - not in the hold yet
  });

  it('softens a second discrete hit landing within the grace window, once committed', () => {
    const sim = makeSim();
    sim.player.p.hp = 100;
    sim.extraction.committed = true;
    sim.game.time = 10;
    sim.damagePlayer(20, sim.player.p.pos, 'prowler');
    expect(sim.player.p.hp).toBe(80);
    sim.game.time = 10.1; // inside the 0.4s grace window
    sim.damagePlayer(20, sim.player.p.pos, 'prowler');
    expect(sim.player.p.hp).toBe(70); // 20 * 0.5 = 10 taken, not 20
  });

  it('does not soften a hit arriving after the grace window elapses', () => {
    const sim = makeSim();
    sim.player.p.hp = 100;
    sim.extraction.committed = true;
    sim.game.time = 10;
    sim.damagePlayer(20, sim.player.p.pos, 'prowler');
    sim.game.time = 11.5; // well outside the window
    sim.damagePlayer(20, sim.player.p.pos, 'prowler');
    expect(sim.player.p.hp).toBe(60); // both hits full
  });

  it('never softens the continuous razorfin hazard, even during the hold', () => {
    const sim = makeSim();
    sim.player.p.hp = 100;
    sim.extraction.committed = true;
    sim.game.time = 10;
    sim.damagePlayer(5, sim.player.p.pos, 'razorfin');
    sim.game.time = 10.02;
    sim.damagePlayer(5, sim.player.p.pos, 'razorfin');
    expect(sim.player.p.hp).toBe(90); // both full
  });

  it('the recorded F6-shaped burst chain survives instead of dying outright', () => {
    // reconstructs docs/critic-report-inc1-after2.md's F2 finding (an
    // extraction-hold death): hp56, three 14dmg prowler hits at
    // t=321.15/321.75/321.95, then a 30dmg juggernaut finisher at
    // t=322.15 - killed the player outright before this fix
    // (56 - 14 - 14 - 14 - 30 = -16).
    const sim = makeSim();
    sim.player.p.hp = 56;
    sim.extraction.committed = true;
    sim.game.time = 321.15;
    sim.damagePlayer(14, sim.player.p.pos, 'prowler');
    sim.game.time = 321.75;
    sim.damagePlayer(14, sim.player.p.pos, 'prowler');
    sim.game.time = 321.95;
    sim.damagePlayer(14, sim.player.p.pos, 'prowler');
    sim.game.time = 322.15;
    sim.damagePlayer(30, sim.player.p.pos, 'juggernaut');
    expect(sim.player.p.alive).toBe(true);
    expect(sim.player.p.hp).toBeGreaterThan(0);
  });
});

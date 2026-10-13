import { describe, it, expect, vi } from 'vitest';

// Mock the audio engine so sfxCreature is a plain spy - it no-ops on `ctx`
// being null anyway (headless/node has no AudioContext), but we need to
// SEE it was called, not just that it did not throw.
vi.mock('../src/audio/engine.js', () => ({
  sfxCreature: vi.fn(),
  sfxAcidSpit: vi.fn(),
  sfxAcidSplat: vi.fn(),
  sfxBloomPulse: vi.fn(),
  sfxMimicShriek: vi.fn(),
}));

import * as THREE from 'three';
import { sfxCreature } from '../src/audio/engine.js';
import { buildJuggernaut } from '../src/enemies/models.js';
import { createEnemyManager } from '../src/enemies/enemies.js';

function makeManager() {
  const scene = { add() {} };
  const playerPos = new THREE.Vector3(0, 0, 0);
  const playerVel = new THREE.Vector3(0, 0, 0);
  const players = [{ pos: playerPos, vel: playerVel }];
  const playerHelpers = {
    nearestPlayer: () => players[0],
    players,
  };
  const effects = { burst() {} };
  const hooks = {
    damagePlayer: vi.fn(),
    onKill: vi.fn(),
    onSummon: vi.fn(),
  };
  const mgr = createEnemyManager(scene, playerHelpers, effects, hooks);
  return { mgr, playerPos, hooks };
}

describe('juggernaut model: per-instance boil material (round: extraction-redesign)', () => {
  it('two juggernaut models do not share the same boil material instance', () => {
    // The boil is the melee telegraph AND the back weakpoint. If its
    // material is shared (like it was before this round), brightening it
    // to sell one juggernaut's windup would flash EVERY juggernaut on the
    // map. Must be cloned per-instance, same pattern as the spitter's sacs
    // (models.js: `MAT.sac.clone()`).
    const a = buildJuggernaut();
    const b = buildJuggernaut();
    expect(a.refs.boil.material).not.toBe(b.refs.boil.material);
    expect(a.refs.boil.material.color.getHex()).toBe(b.refs.boil.material.color.getHex());
  });
});

describe('juggernaut melee telegraph (root cause 1: no windup cue)', () => {
  it('fires a creature call the instant the melee windup starts', () => {
    const { mgr, playerPos } = makeManager();
    sfxCreature.mockClear();
    const e = mgr.spawn('juggernaut', 0, 0);
    e.pos.copy(playerPos);
    e.pos.x = 2; // inside attackRange (3.0)
    e.attackCd = 0;
    e.state = 'hunt';
    mgr.update(1 / 60);
    expect(e.state).toBe('windup');
    expect(sfxCreature).toHaveBeenCalledWith('juggernaut', expect.anything(), expect.any(Number));
  });

  it('brightens the back-boil weakpoint through the windup, then resets it', () => {
    const { mgr, playerPos } = makeManager();
    const e = mgr.spawn('juggernaut', 0, 0);
    e.pos.copy(playerPos);
    e.pos.x = 2;
    e.attackCd = 0;
    e.state = 'hunt';
    mgr.update(1 / 60); // enters windup this frame
    expect(e.state).toBe('windup');
    const base = e.model.refs.boil.material.emissiveIntensity;

    for (let i = 0; i < 20; i++) mgr.update(1 / 60); // partway through the 0.5s windup
    const mid = e.model.refs.boil.material.emissiveIntensity;
    expect(mid).toBeGreaterThan(base);

    for (let i = 0; i < 20; i++) mgr.update(1 / 60); // finish it - strike resolves
    expect(e.state).toBe('hunt');
    expect(e.model.refs.boil.material.emissiveIntensity).toBeCloseTo(base, 5);
  });

  it("does not mutate a second, unrelated juggernaut's boil while the first winds up", () => {
    const { mgr, playerPos } = makeManager();
    const e1 = mgr.spawn('juggernaut', 0, 0);
    e1.pos.copy(playerPos);
    e1.pos.x = 2;
    e1.attackCd = 0;
    e1.state = 'hunt';
    const e2 = mgr.spawn('juggernaut', 200, 200); // far away, never engages
    const e2Base = e2.model.refs.boil.material.emissiveIntensity;
    for (let i = 0; i < 10; i++) mgr.update(1 / 60);
    expect(e1.state).toBe('windup');
    expect(e2.model.refs.boil.material.emissiveIntensity).toBe(e2Base);
  });

  it('lands the strike as before once the windup completes at close range', () => {
    const { mgr, playerPos, hooks } = makeManager();
    const e = mgr.spawn('juggernaut', 0, 0);
    e.pos.copy(playerPos);
    e.pos.x = 2;
    e.attackCd = 0;
    e.state = 'hunt';
    mgr.update(1 / 60); // enters windup - real terrain snaps e.pos.y here
    // match the player's elevation to whatever the terrain settled the
    // enemy at (real heightmap, not flat - only the horizontal gap matters
    // for this test, the world's vertical relief is not what's under test)
    playerPos.y = e.pos.y;
    expect(e.state).toBe('windup');
    for (let i = 0; i < 40; i++) mgr.update(1 / 60);
    expect(hooks.damagePlayer).toHaveBeenCalledWith(30, expect.anything(), 'juggernaut');
  });
});

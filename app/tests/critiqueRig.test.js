import { describe, it, expect } from 'vitest';
import { viewInfo, enemiesNearCount, createRig } from '../src/game/critiqueRig.js';

describe('critiqueRig: viewInfo (pure)', () => {
  it('a source dead ahead is in the view cone, zero bearing', () => {
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const src = { x: 0, y: 1.6, z: -10 }; // yaw 0 looks down -z (controller.js convention)
    const info = viewInfo(player, src, () => true);
    expect(info.angleDeg).toBe(0);
    expect(info.inViewCone).toBe(true);
    expect(info.dist).toBeCloseTo(10);
  });

  it('a source directly behind the player is out of the view cone', () => {
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const src = { x: 0, y: 1.6, z: 10 }; // behind - +z when facing -z
    const info = viewInfo(player, src, () => true);
    expect(info.angleDeg).toBeCloseTo(180);
    expect(info.inViewCone).toBe(false);
  });

  it('a source 90 degrees to the side is out of a 55-degree half-angle cone', () => {
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const src = { x: 10, y: 1.6, z: 0 }; // due east
    const info = viewInfo(player, src, () => true);
    expect(info.angleDeg).toBeCloseTo(90);
    expect(info.inViewCone).toBe(false);
  });

  it('inView requires BOTH the cone and clear line of sight', () => {
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const src = { x: 0, y: 1.6, z: -5 };
    const clear = viewInfo(player, src, () => true);
    const blocked = viewInfo(player, src, () => false);
    expect(clear.inViewCone).toBe(true);
    expect(clear.losClear).toBe(true);
    expect(clear.inView).toBe(true);
    expect(blocked.inViewCone).toBe(true);
    expect(blocked.losClear).toBe(false);
    expect(blocked.inView).toBe(false);
  });

  it('defaults losClear to true when no hasLOS function is supplied', () => {
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const src = { x: 0, y: 1.6, z: -5 };
    const info = viewInfo(player, src);
    expect(info.losClear).toBe(true);
  });

  it('flags withinReactionDist correctly at the boundary', () => {
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: 0 };
    const near = viewInfo(player, { x: 0, y: 1.6, z: -20 }, () => true);
    const far = viewInfo(player, { x: 0, y: 1.6, z: -40 }, () => true);
    expect(near.withinReactionDist).toBe(true);
    expect(far.withinReactionDist).toBe(false);
  });

  it('bearing respects the yaw-rotated frame, not just world axes', () => {
    // engine convention (controller.js: fwd = (-sin(yaw), -cos(yaw))):
    // yaw 0 faces -z; yaw +90deg (PI/2) faces -x.
    const player = { pos: { x: 0, y: 1.6, z: 0 }, yaw: Math.PI / 2 };
    const src = { x: -10, y: 1.6, z: 0 }; // -x, straight ahead once yawed +90deg
    const info = viewInfo(player, src, () => true);
    expect(info.angleDeg).toBeCloseTo(0, 0);
  });
});

describe('critiqueRig: enemiesNearCount (pure)', () => {
  it('counts enemies within the radius and buckets by type', () => {
    const enemies = [
      { type: 'prowler', pos: { x: 5, z: 0 } },
      { type: 'prowler', pos: { x: 100, z: 0 } }, // out of range
      { type: 'spitter', pos: { x: 0, z: 8 } },
    ];
    const r = enemiesNearCount(enemies, { x: 0, z: 0 }, 20);
    expect(r.count).toBe(2);
    expect(r.types).toEqual({ prowler: 1, spitter: 1 });
  });

  it('returns zero count for an empty enemy list', () => {
    const r = enemiesNearCount([], { x: 0, z: 0 }, 20);
    expect(r.count).toBe(0);
    expect(r.types).toEqual({});
  });
});

// --- createRig wiring: exercised against a minimal duck-typed fake sim,
// never the real THREE-backed sim - this is exactly the "independent of
// the sim" testability the critic brief asks for.
function fakeSim(overrides = {}) {
  const player = {
    pos: { x: 0, y: 1.6, z: 0 }, yaw: 0, hp: 100, maxHp: 100, stamina: 1,
  };
  return {
    game: { time: 0 },
    player: { p: player },
    director: { threat: () => 0.4 },
    enemyMgr: { aliveList: () => [] },
    extraction: { progress: 0, committed: false },
    ...overrides,
  };
}

describe('critiqueRig: createRig wiring', () => {
  it('begin() resets the current record for a fresh run', () => {
    const rig = createRig(fakeSim());
    const rec = rig.begin('river', 'normal');
    expect(rec.route).toBe('river');
    expect(rec.difficulty).toBe('normal');
    expect(rec.damageEvents).toEqual([]);
    expect(rec.deathRecord).toBeNull();
    expect(rec.ticks).toEqual([]);
    expect(rig.current()).toBe(rec);
  });

  it('onHurt records a fully-classified damage event using live sim state', () => {
    const sim = fakeSim();
    sim.game.time = 12.5;
    const rig = createRig(sim, { hasLOS: () => true });
    rig.begin('river', 'normal');
    rig.onHurt(18, { x: 0, y: 1.6, z: -10 }, 'prowler');
    const rec = rig.current();
    expect(rec.damageEvents.length).toBe(1);
    const ev = rec.damageEvents[0];
    expect(ev.t).toBe(12.5);
    expect(ev.amount).toBe(18);
    expect(ev.source).toBe('prowler');
    expect(ev.inViewCone).toBe(true);
    expect(ev.losClear).toBe(true);
    expect(ev.playerHp).toBe(100);
  });

  it('onDeath captures the last damage event as the death record', () => {
    const sim = fakeSim();
    const rig = createRig(sim, { hasLOS: () => false });
    rig.begin('river', 'normal');
    rig.onHurt(30, { x: 0, y: 1.6, z: 10 }, 'juggernaut'); // behind, no LOS
    rig.onDeath();
    const rec = rig.current();
    expect(rec.deathRecord).not.toBeNull();
    expect(rec.deathRecord.source).toBe('juggernaut');
    expect(rec.deathRecord.inViewCone).toBe(false);
    expect(rec.deathRecord.losClear).toBe(false);
  });

  it('onDeath with no prior damage event still produces a record, marked unknown', () => {
    const rig = createRig(fakeSim());
    rig.begin('river', 'normal');
    rig.onDeath();
    expect(rig.current().deathRecord).toEqual({ unknown: true });
  });

  it('hooks silently no-op before begin() is called (no crash mid-wiring)', () => {
    const rig = createRig(fakeSim());
    expect(() => rig.onHurt(10, { x: 0, y: 0, z: 0 }, 'prowler')).not.toThrow();
    expect(() => rig.onDeath()).not.toThrow();
    expect(() => rig.debugHook(0, { p: { pos: { x: 0, z: 0 }, hp: 100, stamina: 1 } }, 0)).not.toThrow();
  });

  it('debugHook samples every N frames, not every frame, and only for player 0', () => {
    const sim = fakeSim();
    const rig = createRig(sim, { sampleFrames: 10 });
    rig.begin('river', 'normal');
    const player = { p: { pos: { x: 1, z: 2 }, hp: 90, stamina: 0.5 } };
    for (let i = 0; i < 25; i++) rig.debugHook(i, player, 0);
    expect(rig.current().ticks.length).toBe(3); // frames 0, 10, 20
    expect(rig.current().ticks[0]).toMatchObject({ hp: 90, x: 1, z: 2 });
  });

  it('debugHook ignores non-zero playerIdx (critic runs solo, player 0 only)', () => {
    const rig = createRig(fakeSim(), { sampleFrames: 1 });
    rig.begin('river', 'normal');
    rig.debugHook(0, { p: { pos: { x: 0, z: 0 }, hp: 100, stamina: 1 } }, 1);
    expect(rig.current().ticks.length).toBe(0);
  });

  it('debugHook attaches live threat and enemiesNear from the sim', () => {
    const sim = fakeSim({
      director: { threat: () => 0.77 },
      enemyMgr: { aliveList: () => [{ type: 'spitter', pos: { x: 0, z: 5 } }] },
    });
    const rig = createRig(sim, { sampleFrames: 1 });
    rig.begin('river', 'normal');
    rig.debugHook(0, { p: { pos: { x: 0, z: 0 }, hp: 100, stamina: 1 } }, 0);
    const tick = rig.current().ticks[0];
    expect(tick.threat).toBeCloseTo(0.77);
    expect(tick.enemiesNear.count).toBe(1);
    expect(tick.enemiesNear.types).toEqual({ spitter: 1 });
  });
});

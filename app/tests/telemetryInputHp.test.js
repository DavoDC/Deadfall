// Telemetry additions: real HP in samples and events, compact input edges, result block.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createTelemetry, MAX_INPUT_EDGES } from '../src/game/telemetry.js';
import { createSim } from '../src/game/sim.js';

const IDLE = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0 };
const edges = (t, action) => t.log.inputEdges.filter((e) => e.action === action);

describe('telemetry: real HP (DF-15)', () => {
  it('state samples, damage entries and the death record carry the hp the sim really has', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 2400);
    const effects = { spawnTracer() {}, burst() {}, update() {} };
    const t = createTelemetry();
    let sim;
    const ui = {
      onHurt(amount, srcPos, source) {
        t.recordDamageTaken({ time: sim.game.time, amount, source, hp: sim.player.p.hp });
      },
      onDeath() {
        t.recordDeath({ time: sim.game.time, cause: 'prowler', hp: sim.player.p.hp });
      },
    };
    sim = createSim({ scene, camera, effects, ui });
    sim.resetRun();
    t.start({});
    const ctx = (time) => ({ time, pos: sim.player.p.pos, fps: 60, frameMs: 16, hp: sim.player.p.hp });
    t.tick(0.1, ctx(0));
    sim.damagePlayer(30, sim.player.p.pos, 'prowler');
    t.tick(0.1, ctx(1.1));
    sim.damagePlayer(30, sim.player.p.pos, 'prowler');
    t.tick(0.1, ctx(2.2));
    expect(t.log.state.map((s) => s.hp)).toEqual([100, 70, 40]);
    expect(t.log.damageTaken.map((d) => d.hp)).toEqual([70, 40]);
    sim.damagePlayer(500, sim.player.p.pos, 'prowler');
    expect(t.log.deaths[0].hp).toBe(0);
    expect(t.log.damageTaken.at(-1).hp).toBe(0);
  });

  it('snapshotState adds an immediate state sample (and burst sample) with the current hp', () => {
    const t = createTelemetry();
    t.start({});
    t.tick(0.1, { time: 0, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16, hp: 100 });
    t.snapshotState({ time: 0.4, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16, hp: 12 });
    expect(t.log.state.map((s) => s.hp)).toEqual([100, 12]);
    expect(t.log.state[1].t).toBe(0.4);
  });

  it('snapshotState is a safe no-op when not recording', () => {
    const t = createTelemetry();
    expect(() => t.snapshotState({ time: 0, hp: 5 })).not.toThrow();
  });

  it('a death burst ends up on disk shape: stop() after a lethal hit keeps pre-samples with varying hp', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i <= 30; i++) t.tick(0.1, { time: i * 0.1, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16, hp: 100 - i * 3 });
    t.recordDamageTaken({ time: 3, amount: 40, source: 'juggernaut', hp: 7 });
    t.recordDeath({ time: 3, cause: 'juggernaut', hp: 0 });
    t.snapshotState({ time: 3.05, pos: { x: 0, y: 0, z: 0 }, hp: 0 });
    t.stop('death');
    expect(t.log.bursts.length).toBe(1);
    const hps = t.log.bursts[0].samples.map((s) => s.hp);
    expect(new Set(hps).size).toBeGreaterThan(5);
    expect(hps.at(-1)).toBe(0);
  });
});

describe('telemetry: input edges (DF-14)', () => {
  it('semi-auto clicks (fireDown) and melee are edges even when firing never holds', () => {
    const t = createTelemetry();
    t.start({});
    t.recordInput({ ...IDLE, fireDown: true, firing: false }, 0.016, { time: 1 });
    t.recordInput({ ...IDLE, melee: true }, 0.016, { time: 2 });
    expect(edges(t, 'fireDown')).toEqual([{ t: 1, action: 'fireDown', on: true }]);
    expect(edges(t, 'melee')).toHaveLength(1);
  });

  it('sprint, grenade hold and the four move directions log down and up edges once', () => {
    const t = createTelemetry();
    t.start({});
    t.recordInput({ ...IDLE, moveZ: -1, sprint: true }, 0.016, { time: 0 });
    t.recordInput({ ...IDLE, moveZ: -1, sprint: true }, 0.016, { time: 0.016 });
    t.recordInput({ ...IDLE, moveX: 1, grenadeHold: true }, 0.016, { time: 0.5 });
    t.recordInput({ ...IDLE }, 0.016, { time: 1 });
    expect(edges(t, 'sprint').map((e) => e.on)).toEqual([true, false]);
    expect(edges(t, 'moveFwd').map((e) => e.on)).toEqual([true, false]);
    expect(edges(t, 'moveRight').map((e) => e.on)).toEqual([true, false]);
    expect(edges(t, 'grenadeHold').map((e) => e.on)).toEqual([true, false]);
    expect(edges(t, 'moveBack')).toHaveLength(0);
  });

  it('weapon wheel switches are edges', () => {
    const t = createTelemetry();
    t.start({});
    t.recordInput({ ...IDLE, weaponNext: true }, 0.016, { time: 1 });
    t.recordInput({ ...IDLE, weaponPrev: true }, 0.016, { time: 2 });
    expect(edges(t, 'weaponNext')).toHaveLength(1);
    expect(edges(t, 'weaponPrev')).toHaveLength(1);
  });

  it('the edge list is capped and counts what it dropped', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i < MAX_INPUT_EDGES + 50; i++) t.recordInput({ ...IDLE, jump: true }, 0.016, { time: i * 0.01 });
    expect(t.log.inputEdges.length).toBe(MAX_INPUT_EDGES);
    expect(t.log.inputEdgesDropped).toBe(50);
  });

  it('edges stay compact: a 30 second scripted run costs well under 10 KB', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i < 30 * 60; i++) {
      const time = i / 60;
      t.recordInput({ ...IDLE, moveZ: -1, sprint: i % 300 < 200, firing: i % 90 < 20, fireDown: i % 90 === 0, jump: i % 400 === 0 }, 1 / 60, { time });
    }
    expect(JSON.stringify(t.log.inputEdges).length).toBeLessThan(10000);
  });
});

describe('telemetry: result block', () => {
  it('setResult stores score, grade and title on the session and survives the delta wire', () => {
    const t = createTelemetry();
    t.start({});
    t.setResult({ score: 4200, grade: 'B', title: 'SEASONED SCOUT', tag: 'DEAD EYE', junk: 1 });
    expect(t.log.result).toEqual({ score: 4200, grade: 'B', title: 'SEASONED SCOUT', tag: 'DEAD EYE' });
    const d = t.delta({ lens: {}, mod: 0 }, 1).delta;
    expect(d.scalars.result.grade).toBe('B');
  });

  it('a fresh session has result null', () => {
    const t = createTelemetry();
    t.start({});
    expect(t.log.result).toBe(null);
  });
});

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

describe('attacker position on damage events (DF-158)', () => {
  it('an enemy hit carries the attacker position; flood, razorfin and self hits do not', async () => {
    const { attackerPosFor } = await import('../src/game/telemetry.js');
    expect(attackerPosFor('prowler', { x: 1, y: -4, z: 3 })).toEqual({ x: 1, y: -4, z: 3 });
    expect(attackerPosFor('stingerwing', { x: 9, y: 0, z: 2 })).toEqual({ x: 9, y: 0, z: 2 });
    expect(attackerPosFor('flood', { x: 1, y: 2, z: 3 })).toBeNull();
    expect(attackerPosFor('razorfin', { x: 1, y: 2, z: 3 })).toBeNull();
    expect(attackerPosFor('grenade-self', { x: 1, y: 2, z: 3 })).toBeNull();
    expect(attackerPosFor('prowler', null)).toBeNull();
  });

  it('telemetry stores attackerPos on the damage entry', () => {
    const t = createTelemetry();
    t.start({});
    t.recordDamageTaken({ amount: 8, source: 'acid', pos: { x: 0, y: 0, z: 0 }, hp: 70, attackerPos: { x: 4, y: -6, z: 2 } });
    t.recordDamageTaken({ amount: 3, source: 'flood', hp: 67 });
    const [a, f] = t.log.damageTaken;
    expect(a.attackerPos).toEqual({ x: 4, y: -6, z: 2 });
    expect(f).not.toHaveProperty('attackerPos');
  });

  it('a real enemy-sourced sim hit reports the srcPos it was given', () => {
    const hurts = [];
    const sim = makeSim(hurts);
    sim.player.p.alive = true;
    sim.damagePlayer(5, { x: 10, y: -7, z: 4 }, 'prowler');
    expect(hurts.at(-1).srcPos).toEqual({ x: 10, y: -7, z: 4 });
  });
});

describe('real attacker data on damage events', () => {
  it('hurtPositions keeps the player in pos and the attacker in attackerPos', async () => {
    const { hurtPositions } = await import('../src/game/telemetry.js');
    const w = hurtPositions({ x: 0, y: 1, z: 0 }, { x: 9, y: 2, z: 9 }, 'prowler');
    expect(w.pos).toEqual({ x: 0, y: 1, z: 0 });
    expect(w.attackerPos).toEqual({ x: 9, y: 2, z: 9 });
    expect(w.attackerType).toBe('prowler');
  });

  it('acid maps to spitter and uses the firing position, not the impact', async () => {
    const { hurtPositions } = await import('../src/game/telemetry.js');
    const w = hurtPositions({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 1 }, 'acid', { attackerPos: { x: 20, y: 3, z: 5 } });
    expect(w.attackerType).toBe('spitter');
    expect(w.attackerPos).toEqual({ x: 20, y: 3, z: 5 });
    expect(hurtPositions({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, 'spitter-bite').attackerType).toBe('spitter');
  });

  it('environmental hits have no attacker', async () => {
    const { hurtPositions } = await import('../src/game/telemetry.js');
    const w = hurtPositions({ x: 0, y: 1, z: 0 }, { x: 0, y: 5, z: 0 }, 'flood');
    expect(w.attackerPos).toBeNull();
    expect(w.attackerType).toBeNull();
  });

  it('stores attackerType and attackerId on the hit and killerType on the death', () => {
    const t = createTelemetry();
    t.start({});
    t.recordDamageTaken({ amount: 8, source: 'acid', pos: { x: 0, y: 0, z: 0 }, hp: 70, attackerPos: { x: 4, y: 0, z: 2 }, attackerType: 'spitter', attackerId: 7 });
    t.recordDeath({ cause: 'acid', enemy: 'acid', killerType: 'spitter', killerId: 7 });
    expect(t.log.damageTaken[0]).toMatchObject({ attackerType: 'spitter', attackerId: 7 });
    expect(t.log.deaths[0]).toMatchObject({ enemy: 'acid', killerType: 'spitter', killerId: 7 });
  });

  it('noteHurt returns the encounter id, matches an exact attacker, and attributes bites and charges', async () => {
    const { createEncounterTracker } = await import('../src/game/encounters.js');
    const t = createTelemetry();
    t.start({});
    const enc = createEncounterTracker(t);
    const a = { type: 'spitter', pos: { x: 50, z: 0 }, hasLOS: false, hp: 5, state: 'hunt' };
    const b = { type: 'spitter', pos: { x: 5, z: 0 }, hasLOS: false, hp: 5, state: 'hunt' };
    enc.update(1, [a, b], { x: 0, z: 0, yaw: 0 });
    expect(enc.noteHurt('acid', { x: 5, z: 0 }, 4, a)).toBe(1);
    expect(enc.noteHurt('spitter-bite', { x: 5, z: 0 }, 4)).toBe(2);
    expect(enc.noteHurt('flood', { x: 0, z: 0 }, 4)).toBeNull();
  });

  it('recorded sessions: no enemy hit has attackerPos equal to pos', async () => {
    const fs = await import('node:fs');
    const dir = new URL('../captures/telemetry/', import.meta.url);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^session-.*\.json$/.test(n)) : [];
    for (const n of names) {
      const s = JSON.parse(fs.readFileSync(new URL(n, dir), 'utf8'));
      // only sessions recorded after this fix carry attackerType
      for (const d of (s.damageTaken || []).filter((x) => x.attackerType && x.attackerPos && x.pos)) {
        expect(d.attackerPos).not.toEqual(d.pos);
      }
    }
  });
});

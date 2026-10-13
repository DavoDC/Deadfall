// Enemy encounter log (src/game/encounters.js) and the other telemetry
// additions: errors cap, env header, extraction progress, spawn counts.

import { describe, it, expect } from 'vitest';
import { createTelemetry, MAX_ERRORS } from '../src/game/telemetry.js';
import { createEncounterTracker, SIGHT_RANGE } from '../src/game/encounters.js';
import { buildDelta } from '../src/game/telemetryDelta.js';

function setup() {
  const t = createTelemetry();
  t.start({ difficulty: 'easy' });
  return { t, enc: createEncounterTracker(t) };
}
const enemy = (type, x, z, extra = {}) => ({ type, pos: { x, z }, state: 'hunt', hp: 10, hasLOS: false, ...extra });
// player at the origin looking down -z (yaw 0 => forward (-0, -1))
const player = { x: 0, z: 0, yaw: 0 };

describe('encounter tracker', () => {
  it('opens an encounter on spawn and counts spawns by type', () => {
    const { t, enc } = setup();
    const a = enemy('prowler', 10, -50);
    const b = enemy('prowler', 12, -55);
    const c = enemy('spitter', 0, -70);
    enc.update(1, [a, b, c], player);
    expect(t.log.encounters).toHaveLength(3);
    expect(t.log.encounters[0]).toMatchObject({ type: 'prowler', spawnT: 1, fate: 'alive', firstSeenT: null });
    expect(t.log.spawned).toEqual({ prowler: 2, spitter: 1 });
  });

  it('records first sighting only with line of sight, in front, in range', () => {
    const { t, enc } = setup();
    const e = enemy('prowler', 0, -40);
    enc.update(1, [e], player);
    expect(t.log.encounters[0].firstSeenT).toBeNull(); // no LOS yet
    e.hasLOS = true;
    enc.update(2, [e], { ...player, yaw: Math.PI }); // looking away
    expect(t.log.encounters[0].firstSeenT).toBeNull();
    enc.update(3, [e], player);
    expect(t.log.encounters[0].firstSeenT).toBe(3);
    expect(t.log.encounters[0].firstSeenDist).toBe(40);
    enc.update(4, [e], { ...player, yaw: 1 });
    expect(t.log.encounters[0].firstSeenT).toBe(3); // first time only
  });

  it('ignores enemies beyond sight range', () => {
    const { t, enc } = setup();
    const e = enemy('shrike', 0, -(SIGHT_RANGE + 20), { hasLOS: true });
    enc.update(1, [e], player);
    expect(t.log.encounters[0].firstSeenT).toBeNull();
  });

  it('closes a kill with the weapon and a despawn without one', () => {
    const { t, enc } = setup();
    const a = enemy('prowler', 0, -30);
    const b = enemy('spitter', 5, -30);
    enc.update(1, [a, b], player);
    enc.noteHit(a, 'carbine', true);
    a.state = 'dying'; a.hp = -1;
    enc.update(2, [b], player);
    expect(t.log.encounters[0]).toMatchObject({ fate: 'killed', killedT: 2, killedBy: 'carbine' });
    enc.update(3, [], player); // b vanished alive
    expect(t.log.encounters[1]).toMatchObject({ fate: 'despawned' });
  });

  it('a kill with no weapon hit (grenade, hazard) is attributed to other', () => {
    const { t, enc } = setup();
    const a = enemy('prowler', 0, -30);
    enc.update(1, [a], player);
    a.state = 'dying'; a.hp = 0;
    enc.update(2, [], player);
    expect(t.log.encounters[0].killedBy).toBe('other');
  });

  it('attributes damage to the nearest enemy of the source type, acid to spitters', () => {
    const { t, enc } = setup();
    const near = enemy('prowler', 2, 0);
    const far = enemy('prowler', 30, 0);
    const sp = enemy('spitter', 20, 0);
    enc.update(1, [near, far, sp], player);
    enc.noteHurt('prowler', { x: 3, z: 0 }, 12);
    enc.noteHurt('prowler', { x: 3, z: 0 }, 8);
    enc.noteHurt('acid', { x: 18, z: 0 }, 5);
    expect(t.log.encounters[0].dmgToPlayer).toBe(20);
    expect(t.log.encounters[1].dmgToPlayer).toBe(0);
    expect(t.log.encounters[2].dmgToPlayer).toBe(5);
  });

  it('does not re-open an encounter for a pooled enemy that is still alive, but does after it left', () => {
    const { t, enc } = setup();
    const a = enemy('prowler', 0, -30);
    enc.update(1, [a], player);
    enc.update(2, [a], player);
    expect(t.log.encounters).toHaveLength(1);
    a.state = 'dying';
    enc.update(3, [], player);
    a.state = 'hunt'; a.hp = 10; // pool reuse
    enc.update(4, [a], player);
    expect(t.log.encounters).toHaveLength(2);
  });

  it('runs at 5 Hz only', () => {
    const { t, enc } = setup();
    const a = enemy('prowler', 0, -30);
    enc.update(1, [a], player);
    expect(enc.due(1.1)).toBe(false);
    expect(enc.due(1.25)).toBe(true);
    enc.update(1.1, [enemy('spitter', 1, 1)], player);
    expect(t.log.encounters).toHaveLength(1);
  });

  it('in-place encounter updates reach the server through the next delta', () => {
    const { t, enc } = setup();
    const a = enemy('prowler', 0, -30);
    enc.update(1, [a], player);
    const ack = { lens: { encounters: 1 }, mod: t.delta({ lens: {}, mod: -1 }, 1).counter };
    a.state = 'dying';
    enc.update(2, [], player);
    const d = t.delta(ack, 2).delta;
    expect(d.arrays.encounters.from).toBe(0);
    expect(d.arrays.encounters.items[0].fate).toBe('killed');
    expect(buildDelta(t.log, { lens: { encounters: 1 }, mod: t.delta(ack, 3).counter }, undefined, 4).arrays.encounters.items).toHaveLength(0);
  });
});

describe('other telemetry additions', () => {
  it('keeps the env header from start()', () => {
    const t = createTelemetry();
    t.start({ env: { gpu: 'Test GPU', screen: { w: 1920, h: 1080 } } });
    expect(t.log.env.gpu).toBe('Test GPU');
  });

  it('caps uncaught errors and truncates long messages', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i < MAX_ERRORS + 10; i++) t.recordError({ kind: 'error', message: 'x'.repeat(1000), source: 'a.js', line: i });
    expect(t.log.errors).toHaveLength(MAX_ERRORS);
    expect(t.log.errors[0].message).toHaveLength(300);
  });

  it('samples extraction progress into the state channel', () => {
    const t = createTelemetry();
    t.start({});
    t.tick(0.016, { time: 0, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16, extract: 0.4567 });
    t.tick(0.016, { time: 1.1, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16 });
    expect(t.log.state[0].extract).toBe(0.46);
    expect(t.log.state[1].extract).toBeNull();
  });
});

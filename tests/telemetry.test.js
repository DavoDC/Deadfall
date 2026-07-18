// HUMAN-PLAYTEST TELEMETRY (SPEC: "GIVE CLAUDE MORE DATA", 2026-07-18).
// Pure logic tests - no DOM/Blob involved (that only happens in download()).
// This is the harness: David plays, telemetry logs every meaningful metric
// to a session file, Claude ingests it to find issues.

import { describe, it, expect, beforeEach } from 'vitest';
import { createTelemetry } from '../src/game/telemetry.js';

describe('telemetry: recording lifecycle', () => {
  it('starts idle (not recording, no log)', () => {
    const t = createTelemetry();
    expect(t.recording).toBe(false);
    expect(t.log).toBe(null);
  });

  it('start() opens a fresh log carrying meta', () => {
    const t = createTelemetry();
    t.start({ difficulty: 'hunter', seed: 1337 });
    expect(t.recording).toBe(true);
    expect(t.log.difficulty).toBe('hunter');
    expect(t.log.seed).toBe(1337);
    expect(t.log.startedAt).toBeGreaterThan(0);
    expect(t.log.outcome).toBe(null);
  });

  it('start() while already recording resets to a fresh log (new run = new session)', () => {
    const t = createTelemetry();
    t.start({ difficulty: 'recruit', seed: 1 });
    t.recordKill();
    t.start({ difficulty: 'deadfall', seed: 2 });
    expect(t.log.kills).toBe(0);
    expect(t.log.difficulty).toBe('deadfall');
  });

  it('stop() closes the log, sets endedAt, returns it, recording goes false', () => {
    const t = createTelemetry();
    t.start({});
    const closed = t.stop();
    expect(t.recording).toBe(false);
    expect(closed.endedAt).toBeGreaterThan(0);
    expect(closed).toBe(t.log); // still readable after stop
  });

  it('stop() while not recording is a safe no-op returning null', () => {
    const t = createTelemetry();
    expect(t.stop()).toBe(null);
  });

  it('setOutcome records the run result exactly once it is called', () => {
    const t = createTelemetry();
    t.start({});
    t.setOutcome('extracted');
    expect(t.log.outcome).toBe('extracted');
  });
});

describe('telemetry: recording is a no-op before start() / after stop()', () => {
  it('record calls before start() do not throw and leave no log', () => {
    const t = createTelemetry();
    expect(() => {
      t.recordDeath({ pos: { x: 0, y: 0, z: 0 }, cause: 'test' });
      t.recordDamageTaken({ amount: 5, source: 'test' });
      t.recordShotFired();
      t.recordKill();
    }).not.toThrow();
    expect(t.log).toBe(null);
  });

  it('record calls after stop() do not mutate the closed log', () => {
    const t = createTelemetry();
    t.start({});
    t.stop();
    const before = JSON.stringify(t.log);
    t.recordKill();
    t.recordShotFired();
    expect(JSON.stringify(t.log)).toBe(before);
  });
});

describe('telemetry: event recording', () => {
  let t;
  beforeEach(() => {
    t = createTelemetry();
    t.start({ difficulty: 'hunter', seed: 7 });
  });

  it('recordDeath appends a full death record', () => {
    t.recordDeath({ pos: { x: 1, y: 2, z: 3 }, cause: 'prowler', enemy: 'prowler' });
    expect(t.log.deaths.length).toBe(1);
    expect(t.log.deaths[0]).toMatchObject({ pos: { x: 1, y: 2, z: 3 }, cause: 'prowler', enemy: 'prowler' });
    expect(t.log.deaths[0].time).toBeGreaterThanOrEqual(0);
  });

  it('recordDamageTaken appends and accumulates by source', () => {
    t.recordDamageTaken({ amount: 10, source: 'prowler' });
    t.recordDamageTaken({ amount: 5, source: 'prowler' });
    t.recordDamageTaken({ amount: 3, source: 'razorfin' });
    expect(t.log.damageTaken.length).toBe(3);
    expect(t.log.damageTakenBySource).toEqual({ prowler: 15, razorfin: 3 });
  });

  it('recordDamageDealt appends and accumulates by target', () => {
    t.recordDamageDealt({ amount: 20, target: 'prowler', headshot: true });
    t.recordDamageDealt({ amount: 8, target: 'juggernaut', headshot: false });
    expect(t.log.damageDealt.length).toBe(2);
    expect(t.log.damageDealtByTarget).toEqual({ prowler: 20, juggernaut: 8 });
  });

  it('recordShotFired / recordShotHit tally shots and compute accuracy', () => {
    t.recordShotFired();
    t.recordShotFired();
    t.recordShotFired();
    t.recordShotHit();
    expect(t.log.shots.fired).toBe(3);
    expect(t.log.shots.hits).toBe(1);
  });

  it('recordKill increments the kill count', () => {
    t.recordKill();
    t.recordKill();
    expect(t.log.kills).toBe(2);
  });

  it('recordEvent appends timestamped world events (flood/thunder/boss/extraction)', () => {
    t.recordEvent('flood', 'telegraph');
    t.recordEvent('thunder');
    expect(t.log.events.length).toBe(2);
    expect(t.log.events[0]).toMatchObject({ kind: 'flood', detail: 'telegraph' });
    expect(t.log.events[1]).toMatchObject({ kind: 'thunder' });
  });
});

describe('telemetry: tick() sampling (fps + path)', () => {
  it('samples path and fps at most once per sampling interval, not every tick', () => {
    const t = createTelemetry();
    t.start({});
    // many small ticks inside one interval - should coalesce to one sample
    for (let i = 0; i < 50; i++) {
      t.tick(0.01, { time: i * 0.01, pos: { x: i, y: 0, z: 0 }, fps: 60, frameMs: 16.6 });
    }
    expect(t.log.path.length).toBeLessThanOrEqual(1);
    expect(t.log.fps.length).toBeLessThanOrEqual(1);
  });

  it('accumulates multiple samples across several intervals', () => {
    const t = createTelemetry();
    t.start({});
    for (let s = 0; s < 10; s++) {
      t.tick(2.1, { time: s * 2.1, pos: { x: s, y: 0, z: 0 }, fps: 60, frameMs: 16.6 });
    }
    expect(t.log.path.length).toBeGreaterThan(1);
    expect(t.log.fps.length).toBeGreaterThan(1);
  });

  it('tick() before start() is a no-op', () => {
    const t = createTelemetry();
    expect(() => t.tick(2.1, { time: 2.1, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16 })).not.toThrow();
    expect(t.log).toBe(null);
  });
});

describe('telemetry: waypoint arrival tracking', () => {
  const landmarks = [
    { x: 0, z: 0, r: 10, name: 'ALPHA' },
    { x: 100, z: 0, r: 10, name: 'BETA' },
  ];

  it('records first arrival at a waypoint exactly once, with elapsed time', () => {
    const t = createTelemetry();
    t.start({});
    // far from both landmarks
    t.tick(2.1, { time: 2.1, pos: { x: 50, y: 0, z: 50 }, fps: 60, frameMs: 16, landmarks });
    expect(t.log.waypoints.length).toBe(0);
    // enters ALPHA's radius
    t.tick(2.1, { time: 4.2, pos: { x: 2, y: 0, z: 2 }, fps: 60, frameMs: 16, landmarks });
    expect(t.log.waypoints.length).toBe(1);
    expect(t.log.waypoints[0].name).toBe('ALPHA');
    expect(t.log.waypoints[0].time).toBeCloseTo(4.2, 5);
    // stays inside ALPHA - should not double-record
    t.tick(2.1, { time: 6.3, pos: { x: 1, y: 0, z: 1 }, fps: 60, frameMs: 16, landmarks });
    expect(t.log.waypoints.length).toBe(1);
    // reaches BETA later
    t.tick(2.1, { time: 8.4, pos: { x: 99, y: 0, z: 0 }, fps: 60, frameMs: 16, landmarks });
    expect(t.log.waypoints.length).toBe(2);
    expect(t.log.waypoints[1].name).toBe('BETA');
  });

  it('without landmarks passed in, tick() still samples path/fps without throwing', () => {
    const t = createTelemetry();
    t.start({});
    expect(() => t.tick(2.1, { time: 2.1, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16 })).not.toThrow();
  });
});

describe('telemetry: summaryLine', () => {
  it('produces a one-line human-readable summary with the key stats', () => {
    const t = createTelemetry();
    t.start({ difficulty: 'hunter', seed: 42 });
    t.recordShotFired();
    t.recordShotFired();
    t.recordShotHit();
    t.recordKill();
    t.recordDamageTaken({ amount: 25, source: 'prowler' });
    t.setOutcome('extracted');
    t.stop();
    const line = t.summaryLine();
    expect(typeof line).toBe('string');
    expect(line).toContain('extracted');
    expect(line).toContain('1'); // 1 kill
    expect(line.length).toBeLessThan(300); // ONE line, not a report
  });

  it('summaryLine works even if called mid-run (before stop)', () => {
    const t = createTelemetry();
    t.start({});
    expect(() => t.summaryLine()).not.toThrow();
  });

  it('summaryLine on an idle (never-started) telemetry does not throw', () => {
    const t = createTelemetry();
    expect(() => t.summaryLine()).not.toThrow();
  });
});

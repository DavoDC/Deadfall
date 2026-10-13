// HUMAN-PLAYTEST TELEMETRY (SPEC: "GIVE CLAUDE MORE DATA", 2026-07-18).
// Pure logic tests - no DOM/Blob involved (that only happens in download()).
// This is the harness: David plays, telemetry logs every meaningful metric
// to a session file, Claude ingests it to find issues.

import { describe, it, expect, beforeEach } from 'vitest';
import { createTelemetry, DAMAGE_SPIKE_THRESHOLD } from '../src/game/telemetry.js';

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

// ---------------------------------------------------------------------
// v2: HUMAN INPUT (docs/References/Telemetry.md channel 1)
// ---------------------------------------------------------------------
describe('telemetry v2: recordInput edges', () => {
  it('pulse actions (jump/reload/weapon swap/grenade throw) log one edge per true frame', () => {
    const t = createTelemetry();
    t.start({});
    t.recordInput({ moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, jump: true, reload: false }, 0.016, { time: 1 });
    t.recordInput({ moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, jump: false, reload: true }, 0.016, { time: 1.016 });
    expect(t.log.inputEdges).toEqual([
      { t: 1, action: 'jump', on: true },
      { t: 1.02, action: 'reload', on: true },
    ]);
  });

  it('sustained actions (firing, aim) log a down edge and an up edge, not one per frame held', () => {
    const t = createTelemetry();
    t.start({});
    const base = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, firing: true };
    t.recordInput(base, 0.016, { time: 0 });
    t.recordInput(base, 0.016, { time: 0.016 }); // held - no new edge
    t.recordInput(base, 0.016, { time: 0.032 }); // held - no new edge
    t.recordInput({ ...base, firing: false }, 0.016, { time: 0.048 }); // released
    const fireEdges = t.log.inputEdges.filter((e) => e.action === 'firing');
    expect(fireEdges).toEqual([
      { t: 0, action: 'firing', on: true },
      { t: 0.05, action: 'firing', on: false },
    ]);
  });

  it('recordInput before start() / after stop() is a safe no-op', () => {
    const t = createTelemetry();
    expect(() => t.recordInput({ jump: true }, 0.016, { time: 0 })).not.toThrow();
    t.start({});
    t.stop();
    const before = JSON.stringify(t.log);
    t.recordInput({ jump: true }, 0.016, { time: 0 });
    expect(JSON.stringify(t.log)).toBe(before);
  });
});

describe('telemetry v2: input aggregates (1s window)', () => {
  it('flushes distance/sprint/aim/look/shots into one aggregate per second, not per frame', () => {
    const t = createTelemetry();
    t.start({});
    // 60 frames of ~16.6ms sprinting forward, one shot fired mid-window
    for (let i = 0; i < 60; i++) {
      const time = i * (1 / 60);
      if (i === 30) t.recordShotFired();
      t.recordInput(
        { moveX: 0, moveZ: -1, sprint: true, aim: false, lookDX: 10, lookDY: 0 },
        1 / 60,
        { time, pos: { x: i * 0.1, y: 0, z: 0 }, lookDeltaDeg: 2 }
      );
    }
    // window has not yet reached the full 1s mark - nothing flushed until
    // stop() (or a later frame past the boundary) closes it out
    expect(t.log.inputAggregates.length).toBe(0);
    t.stop();
    expect(t.log.inputAggregates.length).toBe(1);
    const agg = t.log.inputAggregates[0];
    expect(agg.pctSprint).toBeCloseTo(100, 0);
    expect(agg.shots).toBe(1);
    expect(agg.distance).toBeGreaterThan(0);
    expect(agg.lookSpeedMeanDegPerSec).toBeGreaterThan(0);
    expect(agg.lookSpeedPeakDegPerSec).toBeGreaterThan(0);
  });

  it('time aiming is reported in seconds, not a percentage', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i < 60; i++) {
      t.recordInput(
        { moveX: 0, moveZ: 0, aim: true, lookDX: 0, lookDY: 0 },
        1 / 60,
        { time: i * (1 / 60) }
      );
    }
    t.stop();
    const agg = t.log.inputAggregates[0];
    expect(agg.aimSeconds).toBeCloseTo(1, 1);
  });

  it('stop() flushes a trailing partial aggregate window instead of discarding it', () => {
    const t = createTelemetry();
    t.start({});
    t.recordInput({ moveX: 1, moveZ: 0, sprint: false, lookDX: 0, lookDY: 0 }, 0.1, { time: 0 });
    t.recordInput({ moveX: 1, moveZ: 0, sprint: false, lookDX: 0, lookDY: 0 }, 0.1, { time: 0.1 });
    t.stop();
    expect(t.log.inputAggregates.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------
// v2: GAME STATE (docs/References/Telemetry.md channel 2)
// ---------------------------------------------------------------------
describe('telemetry v2: state samples (1s baseline)', () => {
  const fullCtx = (time, overrides = {}) => ({
    time,
    pos: { x: 1, y: 2, z: 3 },
    fps: 60,
    frameMs: 16.6,
    yaw: 0.5,
    hp: 80,
    stamina: 0.7,
    ammo: { mag: 20, reserve: 60 },
    weapon: 'carbine',
    speedMps: 5.1,
    slopeDeg: 12,
    verticalVel: -2,
    grounded: true,
    enemiesNear: { count: 2, types: { prowler: 2 } },
    threat: 0.4,
    ...overrides,
  });

  it('samples game state at most once per second', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i < 20; i++) t.tick(0.01, fullCtx(i * 0.01));
    expect(t.log.state.length).toBeLessThanOrEqual(1);
  });

  it('carries every documented field through to the sample', () => {
    const t = createTelemetry();
    t.start({});
    t.tick(0.016, fullCtx(0));
    const s = t.log.state[0];
    expect(s).toMatchObject({
      pos: { x: 1, y: 2, z: 3 },
      yaw: 0.5,
      hp: 80,
      stamina: 0.7,
      ammo: { mag: 20, reserve: 60 },
      weapon: 'carbine',
      speedMps: 5.1,
      slopeDeg: 12,
      verticalVel: -2,
      grounded: true,
      enemiesNear: { count: 2, types: { prowler: 2 } },
      threat: 0.4,
    });
  });

  it('missing optional fields default to null rather than throwing (v1-style minimal ctx)', () => {
    const t = createTelemetry();
    t.start({});
    expect(() => t.tick(0.016, { time: 0, pos: { x: 0, y: 0, z: 0 }, fps: 60, frameMs: 16 })).not.toThrow();
    const s = t.log.state[0];
    expect(s.hp).toBe(null);
    expect(s.weapon).toBe(null);
  });
});

describe('telemetry v2: incident bursts (10Hz ring buffer)', () => {
  const ctxAt = (time) => ({
    time, pos: { x: time, y: 0, z: 0 }, fps: 60, frameMs: 16.6, hp: 100 - time,
  });

  it('death opens a burst carrying the pre-incident ring plus post-incident samples', () => {
    const t = createTelemetry();
    t.start({});
    // build up >5s of 10Hz ring history
    for (let i = 0; i <= 70; i++) t.tick(0.1, ctxAt(i * 0.1));
    t.recordDeath({ time: 7.0, pos: { x: 7, y: 0, z: 0 }, cause: 'prowler' });
    // just over 2 more seconds of post-incident samples (a little margin
    // past the boundary - real 60fps ticks always clear it within a frame
    // or two, this just avoids a floating-point fencepost in the test)
    for (let i = 71; i <= 95; i++) t.tick(0.1, ctxAt(i * 0.1));
    expect(t.log.bursts.length).toBe(1);
    const burst = t.log.bursts[0];
    expect(burst.trigger).toBe('death');
    // pre-window capped at the ring size (~5s @ 10Hz = 50 samples)
    expect(burst.samples.length).toBeGreaterThan(40);
    expect(burst.samples.length).toBeLessThanOrEqual(70);
    // some samples come from before the death, some from after
    expect(burst.samples.some((s) => s.t < 7.0)).toBe(true);
    expect(burst.samples.some((s) => s.t > 7.0)).toBe(true);
  });

  it('a damage spike >= DAMAGE_SPIKE_THRESHOLD opens a burst; smaller hits do not', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i <= 20; i++) t.tick(0.1, ctxAt(i * 0.1));
    t.recordDamageTaken({ time: 2.0, amount: DAMAGE_SPIKE_THRESHOLD - 1, source: 'stingerwing' });
    expect(t.log.bursts.length).toBe(0);
    t.recordDamageTaken({ time: 2.1, amount: DAMAGE_SPIKE_THRESHOLD, source: 'juggernaut' });
    for (let i = 21; i <= 45; i++) t.tick(0.1, ctxAt(i * 0.1));
    expect(t.log.bursts.length).toBe(1);
    expect(t.log.bursts[0].trigger).toBe('damageSpike');
  });

  it('a second incident while a burst is already open extends it instead of opening a duplicate', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i <= 10; i++) t.tick(0.1, ctxAt(i * 0.1));
    t.recordDeath({ time: 1.0, pos: { x: 0, y: 0, z: 0 }, cause: 'prowler' });
    t.recordDamageTaken({ time: 1.1, amount: 50, source: 'juggernaut' }); // still inside the 2s post-window
    for (let i = 11; i <= 40; i++) t.tick(0.1, ctxAt(i * 0.1));
    expect(t.log.bursts.length).toBe(1); // not 2
  });

  it('stop() flushes an in-progress burst rather than losing it (died run keeps its data)', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i <= 10; i++) t.tick(0.1, ctxAt(i * 0.1));
    t.recordDeath({ time: 1.0, pos: { x: 0, y: 0, z: 0 }, cause: 'prowler' });
    t.stop(); // died immediately after - burst never got its 2s post-window
    expect(t.log.bursts.length).toBe(1);
  });
});

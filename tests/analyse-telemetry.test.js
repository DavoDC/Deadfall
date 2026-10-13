// TELEMETRY DIGEST - paused-time follow-up to the broken-telemetry P0
// (f158c0f, 2026-08-20). That fix moved telemetry.tick() onto a wall-clock
// time base (log.state/path/waypoints/events) so sampling survives a pause,
// but log.deaths/damageTaken/damageDealt stay on game.time (sim clock,
// frozen during pause). After any pause the two clocks are offset by the
// total time spent paused, with nothing in the digest saying so.
//
// This file covers the analysis-side fix only: computePausedSeconds() walks
// the paused/resumed events log entries (recorded via telemetry.recordEvent,
// already wall-clock) to recover the total paused duration, and
// formatDigest() reports it plus labels which clock each timestamp family
// uses. No change to src/game/telemetry.js or the stored log schema.

import { describe, it, expect } from 'vitest';
import { computePausedSeconds, formatDigest } from '../src/tools/analyse-telemetry.mjs';

function baseLog(overrides = {}) {
  return {
    version: 2,
    startedAt: 1000,
    endedAt: 61000, // 60s wall-clock session by Date.now(), unaffected by pause
    difficulty: 'hunter',
    seed: 1,
    outcome: 'extracted',
    kills: 0,
    deaths: [],
    damageTaken: [],
    damageTakenBySource: {},
    damageDealt: [],
    damageDealtByTarget: {},
    shots: { fired: 0, hits: 0 },
    waypoints: [],
    events: [],
    fps: [],
    path: [],
    inputEdges: [],
    inputAggregates: [],
    state: [],
    bursts: [],
    ...overrides,
  };
}

describe('computePausedSeconds', () => {
  it('returns 0 / not-unterminated for a log with no pause events (common case)', () => {
    const log = baseLog({ events: [{ time: 5, kind: 'extraction', detail: 'committed' }] });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(0);
    expect(result.unterminated).toBe(false);
  });

  it('sums a single paused/resumed pair', () => {
    const log = baseLog({
      events: [
        { time: 10, kind: 'paused', detail: null },
        { time: 25, kind: 'resumed', detail: null },
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(15);
    expect(result.unterminated).toBe(false);
  });

  it('sums multiple non-overlapping paused/resumed pairs', () => {
    const log = baseLog({
      events: [
        { time: 5, kind: 'paused', detail: null },
        { time: 10, kind: 'resumed', detail: null },
        { time: 20, kind: 'paused', detail: null },
        { time: 23, kind: 'resumed', detail: null },
        { time: 40, kind: 'paused', detail: null },
        { time: 41.5, kind: 'resumed', detail: null },
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(5 + 3 + 1.5);
    expect(result.unterminated).toBe(false);
  });

  it('handles a repeated/nested paused event (only counts from the first open pause)', () => {
    const log = baseLog({
      events: [
        { time: 10, kind: 'paused', detail: null },
        { time: 12, kind: 'paused', detail: null }, // duplicate, ignored - already open
        { time: 20, kind: 'resumed', detail: null },
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(10);
    expect(result.unterminated).toBe(false);
  });

  it('ignores a stray resumed with no matching open paused', () => {
    const log = baseLog({
      events: [
        { time: 5, kind: 'resumed', detail: null },
        { time: 10, kind: 'paused', detail: null },
        { time: 18, kind: 'resumed', detail: null },
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(8);
    expect(result.unterminated).toBe(false);
  });

  it('an unterminated pause (session ended while paused) counts to endedAt and flags unterminated', () => {
    // startedAt/endedAt are real Date.now() epoch ms, unaffected by pause,
    // so (endedAt-startedAt)/1000 is the session's wall-clock-elapsed end.
    const log = baseLog({
      startedAt: 1000,
      endedAt: 51000, // 50s elapsed
      events: [
        { time: 30, kind: 'paused', detail: null },
        // no resumed - session ended while paused
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(20); // 50 - 30
    expect(result.unterminated).toBe(true);
  });

  it('an unterminated pause with a prior completed pair sums both', () => {
    const log = baseLog({
      startedAt: 0,
      endedAt: 100000, // 100s elapsed
      events: [
        { time: 10, kind: 'paused', detail: null },
        { time: 15, kind: 'resumed', detail: null },
        { time: 90, kind: 'paused', detail: null },
        // unterminated - runs to session end at t=100
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(5 + 10);
    expect(result.unterminated).toBe(true);
  });

  it('an unterminated pause with no endedAt (still-running log) flags unterminated without a duration for the open span', () => {
    const log = baseLog({
      endedAt: null,
      events: [
        { time: 10, kind: 'paused', detail: null },
        { time: 15, kind: 'resumed', detail: null },
        { time: 40, kind: 'paused', detail: null },
      ],
    });
    const result = computePausedSeconds(log);
    expect(result.totalPausedSec).toBe(5); // only the completed pair
    expect(result.unterminated).toBe(true);
  });
});

describe('formatDigest: clock labelling and paused-time reporting', () => {
  it('a log with zero pauses prints no PAUSED line (output unchanged for the common case)', () => {
    const log = baseLog({
      deaths: [{ time: 42, pos: { x: 1, z: 2 }, cause: 'prowler', enemy: 'prowler', waypoint: 'camp' }],
      waypoints: [{ name: 'camp', time: 50, pos: { x: 1, z: 2 } }],
    });
    const digest = formatDigest(log, { filename: 'session-a.json', size: 123 });
    expect(digest).not.toMatch(/PAUSED/);
    expect(digest).toMatch(/DEATH t=42s/);
    expect(digest).toMatch(/WAYPOINTS/);
  });

  it('labels the death (sim clock) and waypoints/events (wall clock) timestamp families', () => {
    const log = baseLog({
      deaths: [{ time: 42, pos: { x: 1, z: 2 }, cause: 'prowler', enemy: 'prowler', waypoint: 'camp' }],
      waypoints: [{ name: 'camp', time: 50, pos: { x: 1, z: 2 } }],
      events: [{ time: 12, kind: 'boss', detail: 'spawned' }],
    });
    const digest = formatDigest(log, { filename: 'session-a.json', size: 123 });
    expect(digest).toMatch(/DEATH t=42s \(sim clock\)/);
    expect(digest).toMatch(/WAYPOINTS \(wall clock\)/);
    expect(digest).toMatch(/EVENTS \(wall clock\)/);
  });

  it('a log with pause events prints a nonzero PAUSED total line', () => {
    const log = baseLog({
      startedAt: 0,
      endedAt: 60000,
      events: [
        { time: 10, kind: 'paused', detail: null },
        { time: 22, kind: 'resumed', detail: null },
      ],
      deaths: [{ time: 40, pos: { x: 0, z: 0 }, cause: 'prowler', enemy: 'prowler', waypoint: null }],
    });
    const digest = formatDigest(log, { filename: 'session-b.json', size: 456 });
    expect(digest).toMatch(/PAUSED total=12s/);
  });

  it('an unterminated pause is called out distinctly in the PAUSED line', () => {
    const log = baseLog({
      startedAt: 0,
      endedAt: 60000,
      events: [{ time: 50, kind: 'paused', detail: null }],
    });
    const digest = formatDigest(log, { filename: 'session-c.json', size: 789 });
    expect(digest).toMatch(/PAUSED total=10s/);
    expect(digest).toMatch(/unterminated/i);
  });
});

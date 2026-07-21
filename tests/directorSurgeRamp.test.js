import { describe, it, expect } from 'vitest';
import { createDirector } from '../src/enemies/director.js';
import { WORLD } from '../src/world/heightmap.js';

// Root causes 2/3 (docs/fable-brief-extraction.md): threat() used to hit
// its own ceiling the instant the player reached the beacon
// (progressNorth()*0.82), and startSurge() dumped +6 budget with a 0.1s
// first tick - the "final stand" started already at its climax instead of
// building to one. These tests exercise the pure ramp math directly; the
// emergent spawn-mix effect is what the critic (docs/fable-brief-
// extraction.md's judge) verifies at the integration level.

function makeDirector(atBeacon = true) {
  const enemyMgr = { aliveCount: () => 0, aliveList: () => [] };
  const pos = { z: atBeacon ? WORLD.extraction.z : WORLD.insertion.z };
  const playerHelpers = {
    furthestNorthPlayer: () => ({ pos, yaw: 0 }),
    nearestPlayer: () => ({ pos }),
  };
  return createDirector(enemyMgr, playerHelpers);
}

describe('director: in-hold escalation ramp', () => {
  it('threat during a surge is LOWER at the start of the hold than at the end', () => {
    const d = makeDirector();
    d.startSurge();
    d.setHoldProgress(0);
    const early = d.threat();
    d.setHoldProgress(1);
    const late = d.threat();
    expect(late).toBeGreaterThan(early);
  });

  it('setHoldProgress clamps to [0,1]', () => {
    const d = makeDirector();
    d.setHoldProgress(-5);
    expect(d.state.holdProgress).toBe(0);
    d.setHoldProgress(5);
    expect(d.state.holdProgress).toBe(1);
  });

  it('surgeIntensity is 0 outside a surge regardless of hold progress', () => {
    const d = makeDirector();
    d.setHoldProgress(1);
    expect(d.surgeIntensity()).toBe(0);
  });

  it('surgeIntensity ramps monotonically with hold progress once surging', () => {
    const d = makeDirector();
    d.startSurge();
    d.setHoldProgress(0);
    const early = d.surgeIntensity();
    d.setHoldProgress(0.5);
    const mid = d.surgeIntensity();
    d.setHoldProgress(1);
    const late = d.surgeIntensity();
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThan(late);
    expect(late).toBeLessThanOrEqual(1);
  });

  it('early-hold surge intensity is too low to unlock the juggernaut/heavy squads (min 0.5+)', () => {
    const d = makeDirector();
    d.startSurge();
    d.setHoldProgress(0);
    expect(d.surgeIntensity()).toBeLessThan(0.5);
  });

  it('late-hold surge intensity unlocks the heaviest squads (min 0.7)', () => {
    const d = makeDirector();
    d.startSurge();
    d.setHoldProgress(1);
    expect(d.surgeIntensity()).toBeGreaterThanOrEqual(0.7);
  });

  it('startSurge no longer dumps the whole opening wave on commit frame', () => {
    const d = makeDirector();
    const before = d.state.budget;
    d.startSurge();
    // the old behaviour was +6 budget and a 0.1s first tick (a wall of
    // enemies the same frame the player commits) - this must be a small
    // opening beat, not the whole surge
    expect(d.state.budget - before).toBeLessThan(3);
    expect(d.state.tickT).toBeGreaterThan(0.1);
  });

  it('startSurge resets hold progress to 0 (a fresh hold ramps from the start)', () => {
    const d = makeDirector();
    d.setHoldProgress(0.8);
    d.startSurge();
    expect(d.state.holdProgress).toBe(0);
  });

  it('reset() clears hold progress along with the rest of surge state', () => {
    const d = makeDirector();
    d.startSurge();
    d.setHoldProgress(0.9);
    d.reset();
    expect(d.state.holdProgress).toBe(0);
    expect(d.state.surge).toBe(false);
  });
});

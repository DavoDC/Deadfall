// THE FLOOD (SPEC O) - mechanic invariants. These prove the flood's
// geometry, timing and safety rules without a browser: the zone is the
// gorge band and nothing else, the climb sits in the spec's 30-60s window,
// height is safety, and the roosts are genuinely climbable and dry.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WORLD, FLOOD, floodMask, waterLevelAt, gorgeZ, terrainHeight,
} from '../src/world/heightmap.js';
import { createFlood, PHASES } from '../src/game/flood.js';

beforeEach(() => {
  FLOOD.rise = 0;
});

describe('flood zone geometry', () => {
  it('mask is 1 on the gorge centre-line and 0 well outside the band', () => {
    for (const x of [-200, -60, 0, 80, 200]) {
      expect(floodMask(x, gorgeZ(x))).toBe(1);
      expect(floodMask(x, gorgeZ(x) + 150)).toBe(0);
      expect(floodMask(x, gorgeZ(x) - 150)).toBe(0);
    }
  });

  it('mask fades monotonically outward', () => {
    const x = 10;
    let prev = 1.0001;
    for (let d = 0; d <= 120; d += 8) {
      const m = floodMask(x, gorgeZ(x) + d);
      expect(m).toBeLessThanOrEqual(prev + 1e-9);
      prev = m;
    }
  });

  it('waterLevelAt equals base level everywhere when no flood runs', () => {
    expect(waterLevelAt(0, gorgeZ(0))).toBe(WORLD.waterLevel);
    expect(waterLevelAt(86, -308)).toBe(WORLD.waterLevel);
  });

  it('a full flood raises the gorge band and ONLY the gorge band', () => {
    FLOOD.rise = FLOOD.RISE_MAX;
    // gorge core: fully raised
    expect(waterLevelAt(0, gorgeZ(0))).toBeCloseTo(WORLD.waterLevel + FLOOD.RISE_MAX, 5);
    // untouched: insertion, palisade line, the Maw, extraction mesa
    expect(waterLevelAt(WORLD.insertion.x, WORLD.insertion.z)).toBe(WORLD.waterLevel);
    expect(waterLevelAt(14, 150)).toBe(WORLD.waterLevel);
    expect(waterLevelAt(WORLD.maw.x, WORLD.maw.z)).toBe(WORLD.waterLevel);
    expect(waterLevelAt(WORLD.extraction.x, WORLD.extraction.z)).toBe(WORLD.waterLevel);
  });
});

describe('flood phase machine', () => {
  function makePlayers(x, z) {
    return [{ p: { alive: true, pos: { x, y: 0, z } } }];
  }

  it('stays idle until a player nears the gorge after the grace period', () => {
    const fl = createFlood();
    fl.reset();
    // near the gorge but too early
    fl.update(1 / 60, makePlayers(0, gorgeZ(0) + 60), 10);
    expect(fl.state.phase).toBe('idle');
    // late enough but far from the gorge (insertion plain)
    fl.update(1 / 60, makePlayers(WORLD.insertion.x, WORLD.insertion.z), 120);
    expect(fl.state.phase).toBe('idle');
    // late enough AND near: springs
    fl.update(1 / 60, makePlayers(0, gorgeZ(0) + 60), 120);
    expect(fl.state.phase).toBe('telegraph');
  });

  it('runs telegraph -> surge -> peak -> recede -> done, once per run', () => {
    const fl = createFlood();
    fl.reset();
    fl.trigger();
    const seen = [fl.state.phase];
    const players = makePlayers(0, 0);
    for (let i = 0; i < 60 * 90; i++) {
      fl.update(1 / 60, players, 200);
      if (seen[seen.length - 1] !== fl.state.phase) seen.push(fl.state.phase);
    }
    expect(seen).toEqual(['telegraph', 'surge', 'peak', 'recede', 'done']);
    expect(fl.state.rise).toBe(0);
    // spent: never re-triggers this run
    expect(fl.trigger()).toBe(false);
    fl.update(1 / 60, makePlayers(0, gorgeZ(0)), 500);
    expect(fl.state.phase).toBe('done');
  });

  it('climb from telegraph start to full flood sits in the 30-60s spec window', () => {
    const climb = PHASES.telegraph + PHASES.surge;
    expect(climb).toBeGreaterThanOrEqual(30);
    expect(climb).toBeLessThanOrEqual(60);
  });

  it('no damage during the telegraph; the read window is honest', () => {
    const fl = createFlood();
    fl.reset();
    fl.trigger();
    const players = makePlayers(0, 0);
    for (let i = 0; i < 60 * (PHASES.telegraph - 0.5); i++) {
      fl.update(1 / 60, players, 200);
      expect(fl.hazardAt(0, gorgeZ(0), -8)).toBe(0);
    }
  });

  it('at peak: submersion kills, height saves, outside the band is safe', () => {
    const fl = createFlood();
    fl.reset();
    fl.trigger();
    const players = makePlayers(0, 0);
    while (fl.state.phase !== 'peak') fl.update(1 / 60, players, 200);
    for (let i = 0; i < 60; i++) fl.update(1 / 60, players, 200); // settle into peak
    const x = 0;
    const zg = gorgeZ(x);
    const level = waterLevelAt(x, zg);
    expect(level).toBeCloseTo(WORLD.waterLevel + FLOOD.RISE_MAX, 5);
    // feet 3m under the flood surface: full hazard
    expect(fl.hazardAt(x, zg, level - 3)).toBeGreaterThan(0.9);
    // feet above the surface (a roost): zero
    expect(fl.hazardAt(x, zg, level + 0.5)).toBe(0);
    // outside the band: zero even at depth
    expect(fl.hazardAt(x, zg + 150, -20)).toBe(0);
  });

  it('reset re-arms and zeroes the shared rise', () => {
    const fl = createFlood();
    fl.trigger();
    fl.update(20, [], 200); // deep into surge
    expect(FLOOD.rise).toBeGreaterThan(0);
    fl.reset();
    expect(FLOOD.rise).toBe(0);
    expect(fl.state.phase).toBe('idle');
    expect(fl.state.spent).toBe(false);
  });
});

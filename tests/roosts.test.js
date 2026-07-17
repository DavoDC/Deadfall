// Gorge roosts + platforms - the flood's retreat affordances must ACTUALLY
// work: every roost is near its crossing, walkable tread-by-tread from the
// bank with the stock controller step rule, and dry above the full flood.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  WORLD, FLOOD, waterLevelAt, terrainHeight, gorgeZ, isThicket,
} from '../src/world/heightmap.js';
import {
  clearPlatforms, addPlatform, platformGroundAt, platformCount,
} from '../src/world/platforms.js';
import { ROOSTS, buildRoosts } from '../src/world/roosts.js';

describe('platforms', () => {
  beforeEach(() => clearPlatforms());

  it('a disc within step height is floor; far above is ceiling; below catches falls', () => {
    addPlatform(0, 0, 2.0, 1.5);
    expect(platformGroundAt(0, 0, 1.5)).toBe(2.0);   // step up
    expect(platformGroundAt(0, 0, 0)).toBe(-Infinity); // 2m overhead: not floor
    expect(platformGroundAt(0, 0, 10)).toBe(2.0);    // falling from above: floor
    expect(platformGroundAt(5, 0, 1.5)).toBe(-Infinity); // not over it
  });

  it('overlapping discs resolve to the highest reachable tread', () => {
    addPlatform(0, 0, 1.0, 1.5);
    addPlatform(1.0, 0, 1.6, 1.5);
    // standing on the first (feet 1.0), between both: the higher is floor
    expect(platformGroundAt(0.6, 0, 1.0)).toBe(1.6);
  });
});

describe('gorge roosts', () => {
  beforeEach(() => {
    FLOOD.rise = 0;
    clearPlatforms();
    buildRoosts(new THREE.Scene(), { collidersOnly: true });
  });

  it('two roosts per crossing, one per bank', () => {
    expect(ROOSTS.length).toBe(WORLD.crossings.length * 2);
    for (let ci = 0; ci < WORLD.crossings.length; ci++) {
      const sides = ROOSTS.filter((r) => r.crossing === ci).map((r) => r.side).sort();
      expect(sides).toEqual([-1, 1]);
    }
  });

  it('every roost stands near its crossing, inside the flood band, off the sill corridor', () => {
    for (const r of ROOSTS) {
      const c = WORLD.crossings[r.crossing];
      const dToSill = Math.hypot(r.base.x - c.x, r.base.z - gorgeZ(c.x));
      expect(dToSill).toBeLessThan(50);          // findable during the telegraph
      expect(Math.abs(r.base.x - c.x)).toBeGreaterThan(11); // sill corridor stays clear
      expect(isThicket(r.base.x, r.base.z)).toBe(false);
      expect(isThicket(r.top.x, r.top.z)).toBe(false);
    }
  });

  it('every crown stays dry above the FULL flood', () => {
    FLOOD.rise = FLOOD.RISE_MAX;
    for (const r of ROOSTS) {
      expect(r.top.y).toBeGreaterThan(waterLevelAt(r.top.x, r.top.z) + 1.0);
    }
  });

  it('every roost is walkable base-to-crown with the stock step rule', () => {
    expect(platformCount()).toBeGreaterThan(0);
    for (const r of ROOSTS) {
      // start on the bank at the ramp's base and walk the tread line
      let feet = terrainHeight(r.base.x, r.base.z);
      const dist = Math.abs(r.top.x - r.base.x);
      for (let s = 0; s <= dist; s += 0.3) {
        const x = r.base.x + r.dir * s;
        const g = Math.max(
          terrainHeight(x, r.base.z),
          platformGroundAt(x, r.base.z, feet)
        );
        expect(g - feet).toBeLessThan(0.79); // never a blocked step
        if (g > feet) feet = g;
      }
      expect(feet).toBeCloseTo(r.top.y, 1);
    }
  });
});

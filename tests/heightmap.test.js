import { describe, it, expect } from 'vitest';
import { makeRng, hash2 } from '../src/core/rng.js';
import { fbm, valueNoise } from '../src/core/noise.js';
import {
  WORLD, terrainHeight, moisture, terrainNormal, moveSpeedFactor, riverX,
  gorgeZ, razorfinHazard,
} from '../src/world/heightmap.js';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('differs across seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next());
  });
  it('range stays in bounds', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });
  it('hash2 is stable and in [0,1)', () => {
    expect(hash2(3, -9, 1337)).toBe(hash2(3, -9, 1337));
    for (let i = 0; i < 500; i++) {
      const v = hash2(i * 13, -i * 7, 99);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('noise', () => {
  it('valueNoise is deterministic and bounded', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(i * 0.37, i * -0.73, 5);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(valueNoise(1.5, 2.5, 9)).toBe(valueNoise(1.5, 2.5, 9));
  });
  it('fbm bounded roughly in [-1,1]', () => {
    for (let i = 0; i < 500; i++) {
      const v = fbm(i * 0.11, i * 0.29, 77, 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('terrain layout', () => {
  it('height is deterministic', () => {
    expect(terrainHeight(12.3, -45.6)).toBe(terrainHeight(12.3, -45.6));
  });
  it('ridge is high ground, swamp is low, river is carved', () => {
    // sample averages along the run axis
    let ridge = 0, swamp = 0, river = 0, n = 0;
    for (let z = -200; z <= 200; z += 20) {
      ridge += terrainHeight(118 + 22 * Math.sin(z * 0.008 + 0.6), z);
      swamp += terrainHeight(-130, z);
      river += terrainHeight(riverX(z), z);
      n++;
    }
    ridge /= n; swamp /= n; river /= n;
    expect(ridge).toBeGreaterThan(10);       // commanding high ground
    expect(swamp).toBeLessThan(0);           // wet lowland
    expect(river).toBeLessThan(swamp + 2);   // channel is carved low
  });
  it('river is mostly under water level (wadeable channel)', () => {
    let wet = 0, n = 0;
    for (let z = -240; z <= 240; z += 10) {
      if (terrainHeight(riverX(z), z) < WORLD.waterLevel) wet++;
      n++;
    }
    expect(wet / n).toBeGreaterThan(0.7);
  });
  it('escarpment seals the map edge', () => {
    for (const [x, z] of [[380, 0], [-380, 0], [0, 380], [360, 360]]) {
      expect(terrainHeight(x, z)).toBeGreaterThan(28);
    }
  });
  it('insertion and extraction are on dry walkable ground', () => {
    const hi = terrainHeight(WORLD.insertion.x, WORLD.insertion.z);
    const he = terrainHeight(WORLD.extraction.x, WORLD.extraction.z);
    expect(hi).toBeGreaterThan(WORLD.waterLevel + 0.5);
    expect(he).toBeGreaterThan(WORLD.waterLevel + 0.5);
    expect(hi).toBeLessThan(25);
    expect(he).toBeLessThan(40); // extraction mesa is deliberately high ground
  });
  it('moisture in [0,1], wetter in swamp than on ridge', () => {
    let sw = 0, ri = 0, n = 0;
    for (let z = -150; z <= 150; z += 30) {
      sw += moisture(-130, z);
      ri += moisture(120, z);
      n++;
    }
    expect(sw / n).toBeGreaterThan(ri / n + 0.2);
    for (let i = 0; i < 200; i++) {
      const m = moisture(i * 3 - 300, (i * 7) % 600 - 300);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
  it('normals are unit length and mostly upward', () => {
    for (let i = 0; i < 100; i++) {
      const nrm = terrainNormal(i * 5 - 250, (i * 11) % 500 - 250);
      const len = Math.hypot(nrm.x, nrm.y, nrm.z);
      expect(len).toBeCloseTo(1, 5);
      expect(nrm.y).toBeGreaterThan(0);
    }
  });
  it('movement slower in swamp and water than open ground', () => {
    const open = moveSpeedFactor(30, 100);
    const swamp = moveSpeedFactor(-130, 0);
    const water = moveSpeedFactor(riverX(0), 0);
    expect(open).toBeGreaterThan(0.9);
    expect(swamp).toBeLessThan(open);
    expect(water).toBeLessThan(0.8);
  });
});

describe('gorge rift (round 2: no straight line to extraction)', () => {
  it('the gorge is deep water across the map away from the sills', () => {
    // sample x lanes at least 25m from any crossing: the rift centre there
    // must be well below the waterline (a swim, not a walk)
    let checked = 0;
    for (let x = -300; x <= 300; x += 10) {
      const nearSill = WORLD.crossings.some((c) => Math.abs(x - c.x) < 25);
      if (nearSill) continue;
      const h = terrainHeight(x, gorgeZ(x));
      expect(h, `gorge floor at x=${x}`).toBeLessThan(WORLD.waterLevel - 1.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });
  it('every crossing sill is a walkable path over the rift', () => {
    for (const c of WORLD.crossings) {
      const zg = gorgeZ(c.x);
      for (let dz = -24; dz <= 24; dz += 2) {
        const h = terrainHeight(c.x, zg + dz);
        if (Math.abs(dz) <= 12) {
          // the deck itself is dry
          expect(h, `${c.name} deck at dz=${dz}`).toBeGreaterThan(WORLD.waterLevel + 0.3);
        } else {
          // the approach may be a wade, but never razorfin-deep
          expect(h, `${c.name} approach at dz=${dz}`).toBeGreaterThan(WORLD.waterLevel - 1.05);
        }
      }
    }
  });
  it('the straight line from insertion to extraction hits razorfin water', () => {
    const a = WORLD.insertion;
    const b = WORLD.extraction;
    let worst = 0;
    for (let t = 0; t <= 1; t += 0.002) {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      worst = Math.max(worst, razorfinHazard(x, z));
    }
    expect(worst).toBeGreaterThan(0.85); // the beeline swims with razorfins
  });
  it('razorfin hazard is zero on the sills and away from the gorge', () => {
    for (const c of WORLD.crossings) {
      expect(razorfinHazard(c.x, gorgeZ(c.x))).toBe(0);
    }
    expect(razorfinHazard(0, 200)).toBe(0);
    expect(razorfinHazard(WORLD.extraction.x, WORLD.extraction.z)).toBe(0);
  });
  it('extraction mesa is commanding high ground above its surroundings', () => {
    const ex = WORLD.extraction;
    const top = terrainHeight(ex.x, ex.z);
    let ring = 0;
    let n = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      ring += terrainHeight(ex.x + Math.cos(a) * 60, ex.z + Math.sin(a) * 60);
      n++;
    }
    expect(top).toBeGreaterThan(ring / n + 4);
  });
});

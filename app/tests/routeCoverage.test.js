import { describe, it, expect } from 'vitest';
import {
  measureCoverage, ROUTES, DIFFICULTY_KEYS, HUNTERS, FAR,
} from '../src/tools/routeCoverage.js';

// The variety guarantee, through the real sim: a player walking each main
// route on each difficulty meets every hunter type within 70 m, first
// contact comes early, a new type shows up at a steady cadence, and the
// apex is cued before the drowned stair. Seeded: five seeds on the swamp
// route (the main run), two on each other route, per difficulty.

const SEEDS = { swamp: [1, 2, 3, 4, 5], river: [1, 2], ridge: [1, 2] };

describe('route coverage (real sim, scripted walker)', () => {
  for (const difficulty of DIFFICULTY_KEYS) {
    it(`${difficulty}: every hunter met along every route, early and steadily`, () => {
      for (const route of ROUTES) {
        for (const seed of SEEDS[route]) {
          const r = measureCoverage({ route, difficulty, seed });
          const tag = `${difficulty}/${route}/seed${seed}`;
          for (const type of HUNTERS) {
            const t = r.types[type];
            expect(t && t.far > 0, `${tag}: no ${type} within ${FAR} m`).toBe(true);
            expect(t.firstFarPct, `${tag}: ${type} first met too late`).toBeLessThanOrEqual(80);
          }
          // first contact early
          expect(r.contacts[0], `${tag}: first contact`).toBeLessThanOrEqual(15);
          // a new hunter type every ~10-20 percent: no empty stretch
          const firsts = HUNTERS.map((h) => r.types[h].firstFarPct).sort((a, b) => a - b);
          for (let i = 1; i < firsts.length; i++) {
            expect(firsts[i] - firsts[i - 1], `${tag}: cadence gap`).toBeLessThanOrEqual(22);
          }
          // dangerous types later than the opener
          expect(r.types.juggernaut.firstFarPct).toBeGreaterThan(r.types.prowler.firstFarPct);
          // the apex is cued before the stair (stair starts near 87 percent)
          expect(r.foreshadowPct, `${tag}: apex cue`).not.toBeNull();
          expect(r.foreshadowPct).toBeGreaterThan(60);
          expect(r.foreshadowPct).toBeLessThan(87);
          // flora is part of the mix
          expect(r.types.viperblossom?.far || 0, `${tag}: flora`).toBeGreaterThan(0);
          // performance guard: the live population stays bounded
          expect(r.peakAlive).toBeLessThanOrEqual(14);
        }
      }
    }, 120000);
  }
});

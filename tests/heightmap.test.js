import { describe, it, expect } from 'vitest';
import { makeRng, hash2 } from '../src/core/rng.js';
import { fbm, valueNoise } from '../src/core/noise.js';
import {
  WORLD, terrainHeight, moisture, terrainNormal, moveSpeedFactor, riverX,
  gorgeZ, palisadeZ, fractureZ, razorfinHazard, blockedStep, isThicket,
  LANDMARKS, landmarkPos,
} from '../src/world/heightmap.js';
import { routeWaypoints } from '../src/game/autotest.js';
import { RUIN_SITES } from '../src/world/props.js';

// Walk a straight leg on foot (grounded), obeying the round-3 movement law.
// Returns null if fully walkable, else the first blocked point.
function walkLeg(ax, az, bx, bz, step = 0.6) {
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist < 0.01) return null;
  const dx = (bx - ax) / dist;
  const dz = (bz - az) / dist;
  const n = Math.ceil(dist / step);
  for (let i = 0; i < n; i++) {
    const x = ax + dx * step * i;
    const z = az + dz * step * i;
    if (blockedStep(x, z, dx, dz, terrainHeight(x, z))) return { x, z };
  }
  return null;
}

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
    expect(he).toBeLessThan(52); // extraction mesa is a true butte (round 3)
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

describe('round 3: physical geography kills the straight line', () => {
  it('the Palisade wall cannot be crossed on foot away from its gates', () => {
    let checked = 0;
    for (let x = -300; x <= 300; x += 8) {
      if (WORLD.gates.some((g) => Math.abs(x - g.x) < 30)) continue;
      const pz = palisadeZ(x);
      const hit = walkLeg(x, pz + 42, x, pz - 42);
      expect(hit, `palisade climbable at x=${x}`).not.toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
  it('every Palisade gate is a walkable way through', () => {
    for (const g of WORLD.gates) {
      const pz = palisadeZ(g.x);
      const hit = walkLeg(g.x, pz + 38, g.x, pz - 38);
      expect(hit, `${g.name} blocked at ${hit && JSON.stringify(hit)}`).toBeNull();
    }
  });
  it('the Fracture step cannot be climbed except at Bonebridge and the Scree', () => {
    let checked = 0;
    for (let x = -300; x <= 300; x += 8) {
      if (Math.abs(x - WORLD.bonebridge.x) < 30) continue;
      if (Math.abs(x - WORLD.scree.x) < 70) continue;
      const fz = fractureZ(x);
      const hit = walkLeg(x, fz + 26, x, fz - 26);
      expect(hit, `fracture climbable at x=${x}`).not.toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
  it('the Fracture south face lets you retreat back down everywhere', () => {
    for (let x = -300; x <= 300; x += 14) {
      const fz = fractureZ(x);
      // heading SOUTH (retreat, downhill) is never a wall
      const hit = walkLeg(x, fz - 26, x, fz + 26);
      expect(hit, `cannot retreat south at x=${x}`).toBeNull();
    }
  });
  it('Bonebridge and the Scree are walkable ways onto the highlands', () => {
    for (const w of [WORLD.bonebridge, WORLD.scree]) {
      const fz = fractureZ(w.x);
      const hit = walkLeg(w.x, fz + 30, w.x, fz - 30);
      expect(hit, `${w.name} blocked at ${hit && JSON.stringify(hit)}`).toBeNull();
    }
  });
  it('the beeline from insertion to extraction is physically blocked at 3+ separate belts', () => {
    const a = WORLD.insertion;
    const b = WORLD.extraction;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / dist;
    const dz = (b.z - a.z) / dist;
    const blockedZs = [];
    for (let t = 0; t < dist; t += 0.6) {
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      if (blockedStep(x, z, dx, dz, terrainHeight(x, z))) {
        if (!blockedZs.length || Math.abs(blockedZs[blockedZs.length - 1] - z) > 40) {
          blockedZs.push(z);
        }
      }
    }
    expect(blockedZs.length, `blocked belts at z=${blockedZs.map((z) => Math.round(z))}`)
      .toBeGreaterThanOrEqual(3);
  });
  it('all three advertised routes are walkable end to end (no cliff, no thicket, no razorfin)', () => {
    for (const route of ['river', 'ridge', 'swamp']) {
      const wps = routeWaypoints(route);
      for (let i = 0; i < wps.length - 1; i++) {
        const hit = walkLeg(wps[i].x, wps[i].z, wps[i + 1].x, wps[i + 1].z);
        expect(hit, `${route} leg ${i} (${JSON.stringify(wps[i])} -> ${JSON.stringify(wps[i + 1])}) blocked at ${hit && JSON.stringify(hit)}`).toBeNull();
        // and the route never swims with razorfins
        const dist = Math.hypot(wps[i + 1].x - wps[i].x, wps[i + 1].z - wps[i].z);
        for (let t = 0; t <= dist; t += 2) {
          const x = wps[i].x + (wps[i + 1].x - wps[i].x) * (t / dist);
          const z = wps[i].z + (wps[i + 1].z - wps[i].z) * (t / dist);
          expect(razorfinHazard(x, z), `${route} razorfin at ${Math.round(x)},${Math.round(z)}`)
            .toBeLessThan(0.55);
        }
      }
    }
  });
  it('the mesa is cliff-walled except the stair wedge', () => {
    const ex = WORLD.extraction;
    const stairAz = Math.atan2(WORLD.maw.x - ex.x, WORLD.maw.z - ex.z);
    for (let a = -Math.PI; a < Math.PI; a += 0.13) {
      let da = Math.abs(a - stairAz);
      if (da > Math.PI) da = Math.PI * 2 - da;
      const sx = ex.x + Math.sin(a) * 40;
      const sz = ex.z + Math.cos(a) * 40;
      if (Math.max(Math.abs(sx), Math.abs(sz)) > WORLD.playable) continue;
      const hit = walkLeg(sx, sz, ex.x + Math.sin(a) * 10, ex.z + Math.cos(a) * 10);
      if (da < 0.35) {
        expect(hit, `stair wedge blocked at az=${a.toFixed(2)}`).toBeNull();
      } else if (da > 1.25) {
        expect(hit, `mesa climbable off-stair at az=${a.toFixed(2)}`).not.toBeNull();
      }
    }
  });
  it('Cinder Fang flanks are unclimbable (a landmark, not a route)', () => {
    const F = WORLD.fang;
    let blockedDirs = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      const sx = F.x + Math.cos(a) * 44;
      const sz = F.z + Math.sin(a) * 44;
      if (Math.max(Math.abs(sx), Math.abs(sz)) > WORLD.playable) continue;
      if (walkLeg(sx, sz, F.x, F.z)) blockedDirs++;
    }
    expect(blockedDirs).toBeGreaterThanOrEqual(5);
  });
  it('the Sunken Maw is a wet arena, escapable both back out and up the stair', () => {
    const M = WORLD.maw;
    expect(terrainHeight(M.x, M.z)).toBeLessThan(WORLD.waterLevel);
    // retreat: the west/north half of the rim (where you came from) is
    // wadeable back out. The east side is the butte's wall - intended.
    let open = 0;
    let tried = 0;
    for (let a = Math.PI * 0.4; a < Math.PI * 1.6; a += 0.2) {
      tried++;
      const hit = walkLeg(M.x, M.z, M.x + Math.cos(a) * (M.r + 18), M.z + Math.sin(a) * (M.r + 18));
      if (!hit) open++;
    }
    expect(open / tried, `only ${open}/${tried} west-rim exits open`).toBeGreaterThan(0.6);
    // and the stair itself: maw floor -> drowned ramp -> mesa top
    const path = [
      [M.x, M.z], [44, -274], [58, -284], [70, -295],
      [WORLD.extraction.x, WORLD.extraction.z],
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const hit = walkLeg(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
      expect(hit, `stair leg ${i} blocked at ${hit && JSON.stringify(hit)}`).toBeNull();
    }
  });
  it('no key location sits inside a thicket wall', () => {
    const spots = [
      [WORLD.insertion.x, WORLD.insertion.z, 'insertion'],
      [WORLD.extraction.x, WORLD.extraction.z, 'extraction'],
      [WORLD.maw.x, WORLD.maw.z, 'maw'],
      ...WORLD.crossings.map((c) => [c.x, gorgeZ(c.x), c.name]),
      ...WORLD.gates.map((g) => [g.x, palisadeZ(g.x), g.name]),
      [WORLD.bonebridge.x, fractureZ(WORLD.bonebridge.x), 'bonebridge'],
      [WORLD.scree.x, fractureZ(WORLD.scree.x), 'scree'],
      ...RUIN_SITES.map((r) => [r.x, r.z, r.name]),
    ];
    for (const [x, z, name] of spots) {
      expect(isThicket(x, z), `${name} is inside a thicket`).toBe(false);
    }
  });
  it('landmarks resolve to positions inside the playable area', () => {
    for (const l of LANDMARKS) {
      const p = landmarkPos(l);
      expect(Math.abs(p.x), l.name).toBeLessThanOrEqual(WORLD.playable);
      expect(Math.abs(p.z), l.name).toBeLessThanOrEqual(WORLD.playable);
    }
  });
});

// The level, as pure math. One seeded analytic height function defines the
// whole jungle valley, so ground collision anywhere is an exact sample - no
// physics engine needed for walking. Layout (south -> north run):
//
//   insert (z ~ +250)  ------------------>  extraction (z ~ -250)
//
//   WEST (x < -60):  swamp. Low, flat, wet, dense growth. Slow but rich.
//   CENTRE:          river snaking north. Open, fast, exposed.
//   EAST (x > +60):  ridge. High ground, sparse trees, long sightlines.
//
// The map edge rises into unclimbable escarpment so the world is naturally
// enclosed. Moisture drives vegetation density and ground tint.

import { fbm, clamp, smoothstep, lerp } from '../core/noise.js';

export const WORLD = {
  seed: 1337,
  size: 640,            // full width/depth of the terrain mesh (metres)
  playable: 270,        // |x|,|z| beyond this rises into the escarpment
  waterLevel: -3.2,
  insertion: { x: -20, z: 251 },
  extraction: { x: -24, z: -250, radius: 9 },
};

// Centre-line of the river as x = f(z). Snakes gently through the middle.
export function riverX(z) {
  return 26 * Math.sin(z * 0.011) + 14 * Math.sin(z * 0.023 + 1.7);
}

// Terrain height in metres at world (x, z).
export function terrainHeight(x, z, seed = WORLD.seed) {
  // Rolling jungle floor.
  let h = 9 * fbm(x * 0.013, z * 0.013, seed, 4);
  h += 2.2 * fbm(x * 0.06, z * 0.06, seed + 7, 2);

  // Eastern ridge: a long north-south spine with noisy crest.
  const ridgeCentre = 118 + 22 * Math.sin(z * 0.008 + 0.6);
  const ridgeT = Math.exp(-(((x - ridgeCentre) / 62) ** 2));
  const crest = 17 + 6 * fbm(z * 0.02, 3.7, seed + 31, 3);
  h += crest * ridgeT;

  // Western swamp: pull terrain down toward a flat wet floor.
  const swampT = smoothstep(-52, -118, x) * (1 - smoothstep(200, 265, Math.abs(z)));
  h = lerp(h, -2.4 + 0.9 * fbm(x * 0.05, z * 0.05, seed + 13, 2), swampT * 0.85);

  // River carve: drop a channel around the snaking centre-line.
  const dRiver = Math.abs(x - riverX(z));
  const carve = smoothstep(26, 4, dRiver);
  h -= 7.5 * carve;

  // Escarpment: world edge climbs fast so the run stays in-bounds.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += 55 * smoothstep(WORLD.playable, WORLD.playable + 55, edge);

  return h;
}

// Moisture in [0,1]: drives vegetation density + ground colour.
export function moisture(x, z, seed = WORLD.seed) {
  let m = 0.55 + 0.45 * fbm(x * 0.02 + 40, z * 0.02 - 17, seed + 57, 3);
  const dRiver = Math.abs(x - riverX(z));
  m += 0.5 * smoothstep(34, 6, dRiver);            // lush riverbanks
  m += 0.55 * smoothstep(-52, -118, x);            // swamp is soaked
  const ridgeCentre = 118 + 22 * Math.sin(z * 0.008 + 0.6);
  m -= 0.55 * Math.exp(-(((x - ridgeCentre) / 55) ** 2)); // dry ridge
  const h = terrainHeight(x, z, seed);
  if (h < WORLD.waterLevel + 0.4) m = 1;
  return clamp(m, 0, 1);
}

// Terrain normal via central differences (for slopes, decals, enemy tilt).
export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }, seed = WORLD.seed) {
  const e = 0.6;
  const hL = terrainHeight(x - e, z, seed);
  const hR = terrainHeight(x + e, z, seed);
  const hD = terrainHeight(x, z - e, seed);
  const hU = terrainHeight(x, z + e, seed);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * e;
  const len = Math.hypot(nx, ny, nz);
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

// Movement cost multiplier at a point (1 = normal). Swamp mud and deep
// water slow you down; that is the price of the covered route.
export function moveSpeedFactor(x, z, seed = WORLD.seed) {
  const h = terrainHeight(x, z, seed);
  if (h < WORLD.waterLevel - 0.9) return 0.52;      // wading deep
  if (h < WORLD.waterLevel + 0.15) return 0.68;     // shallow water
  const swampT = smoothstep(-52, -118, x) * (1 - smoothstep(200, 265, Math.abs(z)));
  return 1 - 0.22 * swampT;                          // mud drag
}

export function isUnderwater(x, z, y) {
  return y < WORLD.waterLevel;
}

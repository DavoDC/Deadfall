// The level, as pure math. One seeded analytic height function defines the
// whole jungle valley, so ground collision anywhere is an exact sample - no
// physics engine needed for walking. Layout (south -> north run):
//
//   insert (z ~ +308)  ------------------>  extraction mesa (z ~ -308)
//
//   WEST (x < -60):  swamp. Low, flat, wet, dense growth. Slow but rich.
//   CENTRE:          river snaking north. Open, fast, exposed.
//   EAST (x > +60):  ridge. High ground, sparse trees, long sightlines.
//
// ROUND 2: a flooded GORGE rift cuts the whole map east-west around z=-52.
// It is crossable on foot at exactly three sills (root causeway in the swamp,
// river rapids in the centre, the fallen giant on the ridge). The deep gorge
// water itself is a razorfin hazard - swimmable, but it costs blood. There is
// no straight line to extraction; you choose a crossing and earn it.
//
// The map edge rises into unclimbable escarpment so the world is naturally
// enclosed. Moisture drives vegetation density and ground tint.

import { fbm, clamp, smoothstep, lerp } from '../core/noise.js';

export const WORLD = {
  seed: 1337,
  size: 768,            // full width/depth of the terrain mesh (metres)
  playable: 330,        // |x|,|z| beyond this rises into the escarpment
  waterLevel: -3.2,
  insertion: { x: -40, z: 308 },
  extraction: { x: 86, z: -308, radius: 9 },
  // gorge crossings: the only dry ways north across the rift
  crossings: [
    { x: -112, w: 7.5, name: 'ROOT CAUSEWAY' },  // swamp route
    { x: -7, w: 8.5, name: 'THE RAPIDS' },       // river route
    { x: 138, w: 7.5, name: 'FALLEN GIANT' },    // ridge route
  ],
  gorge: { z: -52, wave: 16, halfWidth: 20, depth: 14 },
};

// Centre-line of the river as x = f(z). Snakes gently through the middle.
export function riverX(z) {
  return 26 * Math.sin(z * 0.011) + 14 * Math.sin(z * 0.023 + 1.7);
}

// Centre-line of the gorge rift as z = f(x). Cuts the whole map east-west.
export function gorgeZ(x) {
  return WORLD.gorge.z + WORLD.gorge.wave * Math.sin(x * 0.011 + 2.1);
}

// How much a point sits on a crossing sill, in [0,1].
function sillMask(x) {
  let s = 0;
  for (const c of WORLD.crossings) {
    s = Math.max(s, Math.exp(-(((x - c.x) / c.w) ** 2)));
  }
  return s;
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
  const swampT = smoothstep(-52, -118, x) * (1 - smoothstep(255, 320, Math.abs(z)));
  h = lerp(h, -2.4 + 0.9 * fbm(x * 0.05, z * 0.05, seed + 13, 2), swampT * 0.85);

  // River carve: drop a channel around the snaking centre-line.
  const dRiver = Math.abs(x - riverX(z));
  const carve = smoothstep(26, 4, dRiver);
  h -= 7.5 * carve;

  // Gorge rift: a deep flooded cut across the whole map. It carves to an
  // ABSOLUTE floor (so even the ridge spine is severed), and the crossing
  // sills clamp back up to a walkable causeway just above the waterline
  // (rapids stones / root mat / the fallen giant's back).
  const dg = Math.abs(z - gorgeZ(x));
  const inBand = smoothstep(WORLD.gorge.halfWidth, 6, dg);
  const sill = dg < 30 ? sillMask(x) : 0;
  if (inBand > 0) {
    const floorH = -9 + 1.2 * fbm(x * 0.05, 7.7, seed + 41, 2);
    h = lerp(h, Math.min(h, floorH), inBand * (1 - sill * 0.97));
  }
  if (sill > 0.45) {
    const along = smoothstep(26, 10, dg);      // deck fades out by ~26m
    const deck = WORLD.waterLevel + 0.55 + (sill - 0.45) * 1.1;
    h = Math.max(h, lerp(-4.0, deck, along * smoothstep(0.45, 0.7, sill)));
  }

  // Extraction mesa: the beacon sits on a raised, climbable table - the
  // final ascent of every run, and a landmark you can read from the gorge.
  const ex = WORLD.extraction;
  const dMesa = Math.hypot(x - ex.x, z - ex.z);
  h += 7.5 * smoothstep(46, 14, dMesa);

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
  const swampT = smoothstep(-52, -118, x) * (1 - smoothstep(255, 320, Math.abs(z)));
  return 1 - 0.22 * swampT;                          // mud drag
}

// Razorfin hazard in [0,1]: 1 = deep in the gorge's blood-warm water where
// the swarm feeds. Wading a sill is safe; swimming the rift is not.
export function razorfinHazard(x, z, seed = WORLD.seed) {
  const dg = Math.abs(z - gorgeZ(x));
  if (dg > WORLD.gorge.halfWidth + 4) return 0;
  const h = terrainHeight(x, z, seed);
  const depth = WORLD.waterLevel - h;         // metres of water
  if (depth < 1.1) return 0;                  // shallows are safe
  const band = smoothstep(WORLD.gorge.halfWidth + 2, 8, dg);
  return clamp(band * smoothstep(1.1, 3.2, depth), 0, 1);
}

export function isUnderwater(x, z, y) {
  return y < WORLD.waterLevel;
}

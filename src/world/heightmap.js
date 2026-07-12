// The level, as pure math. One seeded analytic height function defines the
// whole jungle valley, so ground collision anywhere is an exact sample - no
// physics engine, no navmesh. Layout (south -> north run):
//
//   insert (z ~ +308)  ------------------>  extraction mesa (z ~ -308)
//
//   WEST (x < -60):  swamp. Low, flat, wet, dense growth. Slow but rich.
//   CENTRE:          river snaking north. Open, fast, exposed.
//   EAST (x > +60):  ridge. High ground, sparse trees, long sightlines.
//
// ROUND 2: a flooded GORGE rift cuts the map east-west (~z=-52), crossable
// at exactly three sills; the deep water is a razorfin hazard.
//
// ROUND 3 - PHYSICAL geography kills the straight line. Hazard was not
// enough (David beat a near-beeline), so now GEOMETRY forces winding routes:
//
//   THE PALISADE (z ~ +150): a rocky mountain wall, genuinely unclimbable,
//     pierced only at the HOWLING GATE (west), RIVERGATE CANYON (the river's
//     slot canyon, centre) and SKYREACH SADDLE (a high pass, east).
//   THE FRACTURE (z ~ -178): the northern quarter is a highlands shelf 9m
//     up a cliff step; you get up it at BONEBRIDGE (a rock arch) or the
//     SCREE (a broad talus ramp, far east). South face stays climbable so
//     falling in never traps you.
//   THICKETS: capsule walls of impassable strangler growth stagger every
//     lane so no two fences line up - the beeline dies by geometry alone.
//   EXTRACTION MESA: raised to a true butte - 15m cliffs all round except
//     one stair ramp... which climbs straight out of THE SUNKEN MAW, the
//     flooded basin where the apex predator waits.
//   CINDER FANG: an ember-tipped rock spire in the north-east, visible over
//     the canopy everywhere - the beacon's dark counterpart for navigation.
//
// Unclimbable means unclimbable: `blockedStep` rejects movement up any grade
// steeper than MAX_GRADE (controller, enemies and bot all respect it).
// Emerging from water is exempt - you can always haul out over the roots.

import { fbm, clamp, smoothstep, lerp } from '../core/noise.js';

export const WORLD = {
  seed: 1337,
  size: 768,            // full width/depth of the terrain mesh (metres)
  playable: 330,        // |x|,|z| beyond this rises into the escarpment
  waterLevel: -3.2,
  insertion: { x: -40, z: 308 },
  extraction: { x: 86, z: -308, radius: 9 },
  // gorge crossings: the only dry ways over the rift
  crossings: [
    { x: -112, w: 7.5, name: 'ROOT CAUSEWAY' },  // swamp route
    { x: -7, w: 8.5, name: 'THE RAPIDS' },       // river route
    { x: 138, w: 7.5, name: 'FALLEN GIANT' },    // ridge route
  ],
  gorge: { z: -52, wave: 16, halfWidth: 20, depth: 14 },
  // round 3: the mountain wall and its three gates
  palisade: { z: 150, wave: 14, sigma: 9, height: 34 },
  gates: [
    { x: -98, w: 10, lift: 0, name: 'THE HOWLING GATE' },
    { x: 14, w: 9, lift: 0, name: 'RIVERGATE CANYON' },
    { x: 152, w: 12, lift: 11, name: 'SKYREACH SADDLE' },
  ],
  // round 3: the highlands step and its two ways up
  fracture: { z: -178, wave: 11, rise: 9 },
  bonebridge: { x: -64, w: 10, name: 'BONEBRIDGE' },
  scree: { x: 148, w: 26, name: 'THE SCREE' },
  // round 3: boss basin + spire landmark. The Maw is the mesa's flooded
  // moat - the stair climbs straight out of the monster's water.
  maw: { x: 44, z: -272, r: 26, name: 'THE SUNKEN MAW' },
  mesa: { h: 15 },
  fang: { x: 196, z: -96, h: 58, r: 26, name: 'CINDER FANG' },
};

// Steeper than this (rise per metre travelled) cannot be walked up.
// Natural jungle noise tops out around grade ~1.3; every deliberate wall
// (palisade, fracture step, mesa cliff, fang) is built at grade 2.5+ so
// there is clean daylight between "steep hill" and "wall".
export const MAX_GRADE = 1.6;

// Named places for HUD location callouts (popup once per run, radius-gated).
export const LANDMARKS = [
  { x: -98, z: null, gate: 0, r: 24, name: 'THE HOWLING GATE' },
  { x: 14, z: null, gate: 1, r: 24, name: 'RIVERGATE CANYON' },
  { x: 152, z: null, gate: 2, r: 26, name: 'SKYREACH SADDLE' },
  { x: -112, z: null, crossing: 0, r: 26, name: 'ROOT CAUSEWAY' },
  { x: -7, z: null, crossing: 1, r: 26, name: 'THE RAPIDS' },
  { x: 138, z: null, crossing: 2, r: 26, name: 'FALLEN GIANT' },
  { x: -64, z: null, fracture: true, r: 22, name: 'BONEBRIDGE' },
  { x: 148, z: null, fracture: true, r: 26, name: 'THE SCREE' },
  { x: 196, z: -96, r: 46, name: 'CINDER FANG' },
  { x: 44, z: -272, r: 30, name: 'THE SUNKEN MAW' },
  { x: 86, z: -308, r: 32, name: 'EXTRACTION MESA' },
  { x: -118, z: 80, r: 17, name: 'SWAMP SHRINE' },
  { x: 4, z: -14, r: 17, name: 'RAPIDS ALTAR' },
  { x: -108, z: -16, r: 17, name: 'CAUSEWAY SHRINE' },
  { x: 146, z: 34, r: 17, name: 'RIDGE WATCHPOST' },
];

// Impassable strangler-thicket walls: capsule segments (a -> b, radius r).
// Placed so that no straight lane survives; every wall leaves its route's
// corridor open (proven by the route-walkability unit tests).
export const THICKETS = [
  // south of the Palisade - break up the insertion plain
  { ax: -52, az: 268, bx: 0, bz: 260, r: 9 },
  { ax: -70, az: 206, bx: -10, bz: 194, r: 11 },
  { ax: 40, az: 218, bx: 86, bz: 196, r: 11 },
  // between the Palisade and the gorge - stagger the middle band
  { ax: -52, az: 96, bx: 4, bz: 74, r: 11 },
  { ax: 64, az: 40, bx: 118, bz: 18, r: 12 },
  { ax: -150, az: 128, bx: -196, bz: 110, r: 12 },
  // highlands - force the last kilometre to wind
  { ax: -16, az: -222, bx: 48, bz: -238, r: 11 },
  { ax: 86, az: -212, bx: 140, bz: -224, r: 11 },
  { ax: -120, az: -230, bx: -60, bz: -250, r: 12 },
];

// Centre-line of the river as x = f(z). Snakes gently through the middle.
export function riverX(z) {
  return 26 * Math.sin(z * 0.011) + 14 * Math.sin(z * 0.023 + 1.7);
}

// Centre-line of the gorge rift as z = f(x). Cuts the whole map east-west.
export function gorgeZ(x) {
  return WORLD.gorge.z + WORLD.gorge.wave * Math.sin(x * 0.011 + 2.1);
}

// Centre-line of the Palisade mountain wall as z = f(x).
export function palisadeZ(x) {
  return WORLD.palisade.z + WORLD.palisade.wave * Math.sin(x * 0.013 + 1.2);
}

// Centre-line of the Fracture (highlands cliff step) as z = f(x).
export function fractureZ(x) {
  return WORLD.fracture.z + WORLD.fracture.wave * Math.sin(x * 0.017 + 0.4);
}

// How much a point sits on a gorge crossing sill, in [0,1].
function sillMask(x) {
  let s = 0;
  for (const c of WORLD.crossings) {
    s = Math.max(s, Math.exp(-(((x - c.x) / c.w) ** 2)));
  }
  return s;
}

// Palisade wall height profile at x: full height between gates, cut to the
// gate's lift (0 = ground-level cut, >0 = a pass you climb over).
function palisadeHeightAt(x, seed) {
  const P = WORLD.palisade;
  let h = P.height + 7 * fbm(x * 0.03, 5.5, seed + 71, 3);
  for (const g of WORLD.gates) {
    const cut = Math.exp(-(((x - g.x) / g.w) ** 2));
    h = lerp(h, g.lift, cut);
  }
  return h;
}

// Thicket density in [0,1]: >THICKET_BLOCK is impassable wall-growth.
const THICKET_BLOCK = 0.5;
export function thicketAt(x, z) {
  let d = 0;
  for (const t of THICKETS) {
    const abx = t.bx - t.ax;
    const abz = t.bz - t.az;
    const len2 = abx * abx + abz * abz;
    let u = ((x - t.ax) * abx + (z - t.az) * abz) / len2;
    u = clamp(u, 0, 1);
    const dx = x - (t.ax + abx * u);
    const dz = z - (t.az + abz * u);
    const dist = Math.hypot(dx, dz);
    d = Math.max(d, clamp(1 - (dist - t.r + 2.5) / 2.5, 0, 1));
  }
  return d;
}

export function isThicket(x, z) {
  return thicketAt(x, z) > THICKET_BLOCK;
}

// Terrain height in metres at world (x, z).
export function terrainHeight(x, z, seed = WORLD.seed) {
  // Rolling jungle floor.
  let h = 9 * fbm(x * 0.013, z * 0.013, seed, 4);
  h += 2.2 * fbm(x * 0.06, z * 0.06, seed + 7, 2);

  // Eastern ridge: a long north-south spine with noisy crest. It fades out
  // in the deep south so the mesa/maw finale sits on its own ground.
  const ridgeCentre = 118 + 22 * Math.sin(z * 0.008 + 0.6);
  const ridgeT = Math.exp(-(((x - ridgeCentre) / 62) ** 2))
    * smoothstep(-320, -240, z);
  const crest = 17 + 6 * fbm(z * 0.02, 3.7, seed + 31, 3);
  h += crest * ridgeT;

  // Western swamp: pull terrain down toward a flat wet floor.
  const swampT = smoothstep(-52, -118, x) * (1 - smoothstep(255, 320, Math.abs(z)));
  h = lerp(h, -2.4 + 0.9 * fbm(x * 0.05, z * 0.05, seed + 13, 2), swampT * 0.85);

  // River carve: drop a channel around the snaking centre-line.
  const dRiver = Math.abs(x - riverX(z));
  const carve = smoothstep(26, 4, dRiver);
  h -= 7.5 * carve;

  // THE PALISADE: the mountain wall. A hard gaussian wall (grade ~2.4,
  // provably unclimbable) whose height collapses to each gate's lift.
  // The river's own carve stays subtracted, so RIVERGATE is a wet slot
  // canyon between rock faces.
  {
    const P = WORLD.palisade;
    const dp = z - palisadeZ(x);
    if (Math.abs(dp) < P.sigma * 3.2) {
      h += palisadeHeightAt(x, seed) * Math.exp(-((dp / P.sigma) ** 2));
    }
  }

  // THE FRACTURE: north of this line the land steps up 9m onto the
  // highlands shelf. The step face is cliff-steep except at BONEBRIDGE
  // (narrow rock arch) and the SCREE (broad talus ramp), where the
  // transition widens into a walkable grade.
  {
    const F = WORLD.fracture;
    const fz = fractureZ(x);
    const bb = Math.exp(-(((x - WORLD.bonebridge.x) / WORLD.bonebridge.w) ** 2));
    const sc = Math.exp(-(((x - WORLD.scree.x) / WORLD.scree.w) ** 2));
    const ease = Math.max(bb, sc);
    const half = lerp(2.2, x > 40 ? 34 : 15, ease); // ramp length at the ways up
    h += F.rise * smoothstep(fz + half, fz - half, z);
    // dry ravine shadow just south of the step - reads as a real fracture
    h -= 3 * (1 - ease) * Math.exp(-(((z - (fz + 7)) / 5) ** 2));
  }

  // CINDER FANG: the ember spire. Pure landmark - flanks are cliff-grade.
  // (Added BEFORE the gorge so the rift's absolute floor cuts its skirt.)
  {
    const F = WORLD.fang;
    const df = Math.hypot(x - F.x, z - F.z);
    if (df < F.r * 3) {
      h += F.h * Math.exp(-((df / F.r) ** 2));
    }
  }

  // Gorge rift: a deep flooded cut across the whole map (round 2). The
  // bank transition is kept below cliff grade so a swimmer can always
  // haul out - the gorge kills with razorfins, not with walls.
  const dg = Math.abs(z - gorgeZ(x));
  const inBand = smoothstep(WORLD.gorge.halfWidth + 6, 6, dg);
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

  // THE SUNKEN MAW: a flooded basin sunk into the highlands - the apex
  // predator's arena, and the only road to the mesa stair runs beside it.
  {
    const M = WORLD.maw;
    const dm = Math.hypot(x - M.x, z - M.z);
    if (dm < M.r + 14) {
      const floorH = -4.7 + 1.1 * fbm(x * 0.06, z * 0.06, seed + 87, 2);
      // 20m rim transition keeps every side of the arena climbable - the
      // Maw is a death trap because of what lives in it, not the walls
      h = lerp(h, Math.min(h, floorH), smoothstep(M.r, M.r - 20, dm));
    }
  }

  // EXTRACTION MESA: a true butte at an ABSOLUTE 30m plateau - cliff-walled
  // all round except the stair wedge: a long drowned ramp that rises out of
  // the Sunken Maw's water and climbs the butte's flank. The only way up
  // starts in the monster's moat.
  {
    const ex = WORLD.extraction;
    const dMesa = Math.hypot(x - ex.x, z - ex.z);
    if (dMesa < 96) {
      h += 3.5 * smoothstep(60, 26, dMesa); // apron hill
      const az = Math.atan2(x - ex.x, z - ex.z);
      const stairAz = Math.atan2(WORLD.maw.x - ex.x, WORLD.maw.z - ex.z);
      let da = Math.abs(az - stairAz);
      if (da > Math.PI) da = Math.PI * 2 - da;
      const wedge = smoothstep(1.0, 0.5, da);
      const top = 30 + 1.2 * fbm(x * 0.05, z * 0.05, seed + 91, 2);
      // cliff ring everywhere outside the stair wedge: ~14m over 7m, a wall
      const cliff = smoothstep(26, 19, dMesa);
      h = lerp(h, top, cliff * (1 - wedge));
      // the stair: an ABSOLUTE linear surface from moat level to the
      // plateau (constant grade ~0.86 - smoothstep midpoints and the maw
      // carve releasing would both breach MAX_GRADE)
      const rampT = clamp((56 - dMesa) / 40, 0, 1);
      const rampSurf = lerp(-4.2, top, rampT);
      h = lerp(h, rampSurf, wedge * clamp(rampT * 8, 0, 1));
    }
  }

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
  if (h > 16) m = Math.min(m, 0.45);               // rock walls grow little
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

// THE movement law of round 3: can a grounded mover take a step from
// (x, z) toward unit direction (dirX, dirZ)? False when the ground ahead
// rises steeper than MAX_GRADE (cliff wall) or the way is thicket.
// feetY: current feet height (jumping does not beat a 15m cliff).
// Emerging from water is exempt - hauling out over roots is always allowed,
// so the gorge can never trap a swimmer.
export function blockedStep(x, z, dirX, dirZ, feetY = null, seed = WORLD.seed) {
  const LOOK = 0.65;
  const nx = x + dirX * LOOK;
  const nz = z + dirZ * LOOK;
  if (isThicket(nx, nz)) return true;
  const here = terrainHeight(x, z, seed);
  const standing = feetY === null ? here : Math.max(here, feetY);
  const ahead = terrainHeight(nx, nz, seed);
  // wet-zone exemption: hauling out of water over roots is always allowed,
  // but only onto the LOW bank - a pool at a cliff's base is not a ladder
  if (standing < WORLD.waterLevel + 2.2 && ahead < WORLD.waterLevel + 2.6) return false;
  return (ahead - standing) > LOOK * MAX_GRADE;
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

// Resolve a landmark's centre (gates/crossings/fracture entries sit on
// analytic centre-lines, so their z is derived, not stored).
export function landmarkPos(l) {
  if (l.gate !== undefined) return { x: l.x, z: palisadeZ(l.x) };
  if (l.crossing !== undefined) return { x: l.x, z: gorgeZ(l.x) };
  if (l.fracture) return { x: l.x, z: fractureZ(l.x) };
  return { x: l.x, z: l.z };
}

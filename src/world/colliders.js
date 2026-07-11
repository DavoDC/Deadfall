// Static world collision: vertical cylinders (tree trunks, rocks, props)
// in a spatial hash grid, plus analytic ray tests against cylinders and a
// heightfield ray-march. This is the whole "physics engine" the game needs:
// exact, deterministic, zero dependencies.

import { terrainHeight } from './heightmap.js';

const CELL = 8;
const grid = new Map(); // "cx,cz" -> [{x,z,r,top,base}]
let all = [];

function key(cx, cz) {
  return cx + ',' + cz;
}

export function clearColliders() {
  grid.clear();
  all = [];
}

export function addCylinder(x, z, r, height, base = null) {
  const b = base === null ? terrainHeight(x, z) - 1 : base;
  const col = { x, z, r, base: b, top: b + height };
  all.push(col);
  const minCx = Math.floor((x - r) / CELL);
  const maxCx = Math.floor((x + r) / CELL);
  const minCz = Math.floor((z - r) / CELL);
  const maxCz = Math.floor((z + r) / CELL);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const k = key(cx, cz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(col);
    }
  }
  return col;
}

export function nearbyColliders(x, z, radius) {
  const out = [];
  const minCx = Math.floor((x - radius) / CELL);
  const maxCx = Math.floor((x + radius) / CELL);
  const minCz = Math.floor((z - radius) / CELL);
  const maxCz = Math.floor((z + radius) / CELL);
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const cell = grid.get(key(cx, cz));
      if (cell) for (const c of cell) if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

// Push a moving circle (player/enemy footprint) out of any overlapping
// cylinder. Returns true if position was corrected in-place.
export function pushOut(p, radius, y = null) {
  let corrected = false;
  const cols = nearbyColliders(p.x, p.z, radius + 1.5);
  for (const c of cols) {
    if (y !== null && (y > c.top || y + 1.8 < c.base)) continue;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d2 = dx * dx + dz * dz;
    const minD = radius + c.r;
    if (d2 < minD * minD && d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const push = (minD - d) / d;
      p.x += dx * push;
      p.z += dz * push;
      corrected = true;
    }
  }
  return corrected;
}

// Ray vs vertical cylinder (finite height). Returns t or Infinity.
function rayCylinder(ox, oy, oz, dx, dy, dz, c, maxDist) {
  const ex = ox - c.x;
  const ez = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return Infinity; // vertical ray; trunks don't matter
  const b = 2 * (ex * dx + ez * dz);
  const cc = ex * ex + ez * ez - c.r * c.r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > maxDist) return Infinity;
  const y = oy + dy * t;
  if (y < c.base || y > c.top) return Infinity;
  return t;
}

// Ray-march the heightfield. Coarse steps + one refinement pass.
export function rayTerrain(ox, oy, oz, dx, dy, dz, maxDist, step = 0.9) {
  let t = step;
  let prevT = 0;
  while (t <= maxDist) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const z = oz + dz * t;
    if (y < terrainHeight(x, z)) {
      // refine between prevT and t
      let lo = prevT;
      let hi = t;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        const my = oy + dy * mid;
        if (my < terrainHeight(ox + dx * mid, oz + dz * mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prevT = t;
    // stretch steps when high above ground (cheap long shots across valleys)
    const clearance = y - terrainHeight(x, z);
    t += clearance > 12 ? step * 4 : step;
  }
  return Infinity;
}

// Full static ray query: terrain + cylinders along the ray corridor.
// Returns { t, kind } for the nearest hit, or null.
export function rayStatic(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = rayTerrain(ox, oy, oz, dx, dy, dz, maxDist);
  let kind = best === Infinity ? null : 'terrain';

  // walk grid cells along the ray in the XZ plane
  const steps = Math.ceil(maxDist / CELL);
  const seen = new Set();
  for (let i = 0; i <= steps; i++) {
    const t = i * CELL;
    if (t > maxDist || t > best) break;
    const cx = Math.floor((ox + dx * t) / CELL);
    const cz = Math.floor((oz + dz * t) / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const k = key(gx, gz);
        if (seen.has(k)) continue;
        seen.add(k);
        const cell = grid.get(k);
        if (!cell) continue;
        for (const c of cell) {
          const t2 = rayCylinder(ox, oy, oz, dx, dy, dz, c, Math.min(maxDist, best));
          if (t2 < best) {
            best = t2;
            kind = 'prop';
          }
        }
      }
    }
  }
  return kind ? { t: best, kind } : null;
}

// Line-of-sight between two points (eye to eye). True if unobstructed.
export function hasLOS(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  const hit = rayStatic(ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.5);
  return hit === null;
}

export function colliderCount() {
  return all.length;
}

// Standable platforms - horizontal discs a grounded mover can step onto
// and stand on. This is the round-5 VERTICAL affordance: until now the
// only floor was the heightfield; the flood's retreat structures (gorge
// roosts) are built from these. Deliberately minimal: discs only, linear
// scan (tens of discs, not thousands), no physics beyond "is this floor".
//
// The rule mirrors real stepping: a disc is YOUR floor when you are over
// it and its top is no more than STEP above your feet (walk up) - or
// anywhere below them (land on it from above). Discs more than STEP above
// you are ceilings, not floors: you can walk beneath them.

const STEP = 0.78; // max step-up, just under the terrain MAX_GRADE * lookahead

const platforms = [];

export function clearPlatforms() {
  platforms.length = 0;
}

export function addPlatform(x, z, y, r) {
  const p = { x, z, y, r };
  platforms.push(p);
  return p;
}

// Highest platform top at (x, z) that counts as floor for feet at feetY.
// Returns -Infinity when no platform applies (caller maxes with terrain).
export function platformGroundAt(x, z, feetY) {
  let best = -Infinity;
  for (const p of platforms) {
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz > p.r * p.r) continue;
    if (p.y <= feetY + STEP && p.y > best) best = p.y;
  }
  return best;
}

export function platformCount() {
  return platforms.length;
}

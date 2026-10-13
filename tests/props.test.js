import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { buildVegetation } from '../src/world/vegetation.js';
import { buildProps } from '../src/world/props.js';
import { buildRoosts } from '../src/world/roosts.js';
import { clearColliders, nearbyColliders } from '../src/world/colliders.js';
import { WORLD, gorgeZ, terrainHeight } from '../src/world/heightmap.js';

// Player capsule radius (src/player/controller.js RADIUS) - the bot uses
// the same value via pushOut, so this is the real passage width.
const PLAYER_RADIUS = 0.42;

// Walk a straight line in small steps and report the first point where a
// player-radius capsule would collide with a STATIC PROP collider (tree
// trunk, ruin block, pillar, arch post, etc).
function firstPropBlock(ax, az, bx, bz, step = 0.5) {
  const dist = Math.hypot(bx - ax, bz - az);
  if (dist < 0.01) return null;
  const dx = (bx - ax) / dist;
  const dz = (bz - az) / dist;
  const n = Math.ceil(dist / step);
  for (let i = 0; i <= n; i++) {
    const x = ax + dx * step * i;
    const z = az + dz * step * i;
    // grounded player's feet Y at this point - matches how the real
    // controller calls pushOut(p.pos, RADIUS, p.pos.y - EYE_HEIGHT) while
    // walking, so buried/underwater decorative colliders that a standing
    // player would never actually touch are excluded (colliders.js
    // pushOut applies this exact same base/top band test).
    const feetY = terrainHeight(x, z);
    for (const c of nearbyColliders(x, z, 8)) {
      if (feetY > c.top || feetY + 1.8 < c.base) continue;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r + PLAYER_RADIUS) return { x, z, collider: c };
    }
  }
  return null;
}

describe('world props / static colliders', () => {
  beforeAll(() => {
    clearColliders();
    const scene = new THREE.Scene();
    buildVegetation(scene, { collidersOnly: true });
    buildProps(scene);
    buildRoosts(scene, { collidersOnly: true });
  });

  // Open forest legs between route waypoints are allowed to have trees in
  // the way - autotest.js's bot (and a human) is expected to dodge those,
  // and heightmap.test.js already proves the terrain itself is walkable.
  // The swamp ROOT CAUSEWAY crossing is different: routeWaypoints()
  // (src/game/autotest.js) walks it dead straight (cross()) because it is
  // a DESIGNED single-file passage (a sill over the gorge) - nothing
  // should scatter a prop collider across it. the project backlog's P1 item 3
  // (recurring soft-locks): the critic's SOFT_LOCK findings clustered
  // right on this approach - this is the geometry check that catches it,
  // a wedge a human would snag on too, not a bot-pathing quirk. Scoped to
  // this one evidenced passage - other crossings/gates/fracture breaks may
  // have their own tight-clearance decoration but are not evidenced by the
  // critic and are out of scope here (see the project backlog's item 3).
  it('the ROOT CAUSEWAY (swamp gorge crossing) passage stays clear of prop colliders', () => {
    const causeway = WORLD.crossings[0];
    const zg = gorgeZ(causeway.x);
    const passages = [{ name: causeway.name, x: causeway.x, z0: zg + 26, z1: zg - 26 }];
    for (const p of passages) {
      const hit = firstPropBlock(p.x, p.z0, p.x, p.z1);
      expect(
        hit,
        `${p.name} passage (x=${p.x}, z ${p.z0}->${p.z1}) blocked at `
          + `${hit && JSON.stringify({ x: hit.x, z: hit.z })} by collider `
          + `${hit && JSON.stringify({ x: hit.collider.x, z: hit.collider.z, r: hit.collider.r })}`
      ).toBeNull();
    }
  });
});

// GORGE ROOSTS - the flood's vertical retreat (round 5, SPEC O). At every
// gorge crossing, on BOTH banks, a fallen root-bole leans against a giant
// snag: a walkable ramp of root steps climbing to a crown perch that stays
// dry above the full nine-metre flood. When the red water comes, you climb
// - the mechanic in one image, and the trailer's money shot.
//
// Built from standable platform discs (world/platforms.js): each step is
// within stepping height of the last, so the existing controller walks
// straight up with no new movement verbs. Enemies stay on the heightfield
// - a roost is sanctuary from claws, not from spit.
//
// Placement is defensive: each roost scans candidate spots beside its
// crossing and takes the driest bank ground, so no ramp starts in the
// river channel; ramps run AWAY from the crossing so the sill corridor
// (and the bot's waypoint line) stays clear.

import * as THREE from 'three';
import { WORLD, FLOOD, gorgeZ, terrainHeight } from './heightmap.js';
import { addPlatform } from './platforms.js';
import { addCylinder } from './colliders.js';

const STEP_RISE = 0.62;   // < platforms.STEP (0.78): every step walkable
const STEP_RUN = 1.05;    // metres forward per step
const STEP_R = 1.25;      // disc radius - overlapping treads, no gaps
const CROWN_R = 2.5;     // crown disc radius = the visible orange crown (DF-158: was 2.4)
const BANK_OFF = 34;      // roost line: outside the rift, inside the band
const DRY_TOP_MARGIN = 1.6; // crown clearance above the full flood

function pickBase(cx, side) {
  // scan candidate offsets beside the crossing. A retreat structure
  // belongs on LOW ground (that is where the flood threatens), but not in
  // a river channel - so prefer terrain near a low-and-dry ideal height,
  // and spots closer to the crossing on ties. (A driest-spot rule here
  // once walked the FALLEN GIANT roost onto the Cinder Fang's skirt.)
  const IDEAL = 1.5;
  let best = null;
  for (const off of [13, -13, 18, -18, 24, -24, 30, -30]) {
    const bx = cx + off;
    const bz = gorgeZ(bx) + side * BANK_OFF;
    const g = terrainHeight(bx, bz);
    const score = -Math.abs(g - IDEAL) - Math.abs(off) * 0.08;
    if (!best || score > best.score) best = { x: bx, z: bz, g, off, score };
  }
  return best;
}

function computeRoosts() {
  const list = [];
  const peak = WORLD.waterLevel + FLOOD.RISE_MAX;
  for (let ci = 0; ci < WORLD.crossings.length; ci++) {
    const c = WORLD.crossings[ci];
    for (const side of [1, -1]) { // +1 south bank, -1 north bank
      const b = pickBase(c.x, side);
      // ramp direction: never back across the sill corridor, and prefer
      // the flatter run - a bole leaning INTO a rising hillside buries
      // its crown in the ground
      const probe = 22;
      let dir = Math.sign(b.off) || 1;
      let maxAlong = -Infinity;
      for (const d of [1, -1]) {
        let mt = -Infinity;
        let corridorHit = false;
        for (let s = 0; s <= probe; s += 1) {
          const px = b.x + d * s;
          // the true sill corridor is a rectangle around the crossing
          // CENTRE - x alone is not enough (the roost line sits 34m off
          // the rift in z, usually outside the corridor entirely)
          if (Math.abs(px - c.x) < 12 && Math.abs(b.z - gorgeZ(c.x)) < 26) {
            corridorHit = true;
            break;
          }
          mt = Math.max(mt, terrainHeight(px, b.z));
        }
        if (corridorHit) continue;
        if (maxAlong === -Infinity || mt < maxAlong) {
          maxAlong = mt;
          dir = d;
        }
      }
      if (maxAlong === -Infinity) { // both filtered (cannot happen with off>=12)
        maxAlong = b.g;
      }
      let topY = Math.max(peak + DRY_TOP_MARGIN, b.g + 3.6, maxAlong + 1.0);
      const firstY = b.g + 0.55;
      let steps = Math.max(4, Math.ceil((topY - firstY) / STEP_RISE));
      // second pass: the crown must clear the terrain along the ACTUAL
      // ramp length (the 22m probe is a guess until steps are known)
      let mt2 = -Infinity;
      for (let s = 0; s <= steps * STEP_RUN; s += 0.5) {
        mt2 = Math.max(mt2, terrainHeight(b.x + dir * s, b.z));
      }
      if (mt2 + 0.8 > topY) {
        topY = mt2 + 1.0;
        steps = Math.max(4, Math.ceil((topY - firstY) / STEP_RISE));
      }
      const top = {
        x: b.x + dir * steps * STEP_RUN,
        z: b.z,
        y: firstY + steps * STEP_RISE,
      };
      list.push({
        name: `${c.name} ROOST (${side > 0 ? 'S' : 'N'})`,
        crossing: ci,
        side,
        dir,
        steps,
        base: { x: b.x, z: b.z, y: b.g },
        firstY,
        top,
      });
    }
  }
  return list;
}

// Static and analytic, like WORLD itself - the bot and the tests read this.
export const ROOSTS = computeRoosts();

export function buildRoosts(scene, opts = {}) {
  const meshes = [];
  const barkMat = opts.collidersOnly ? null : new THREE.MeshStandardMaterial({
    color: 0x6e4a2c, roughness: 0.92, metalness: 0,
  });
  const crownMat = opts.collidersOnly ? null : new THREE.MeshStandardMaterial({
    color: 0x7a5230, roughness: 0.85, metalness: 0,
    emissive: 0xff5a2a, emissiveIntensity: 0.06, // faint ember warmth: findable at dusk
  });
  const snagMat = opts.collidersOnly ? null : new THREE.MeshStandardMaterial({
    color: 0x4e3620, roughness: 0.95, metalness: 0,
  });
  const _up = new THREE.Vector3(0, 1, 0);

  for (const r of ROOSTS) {
    // --- physics: the walkable treads + crown perch ---
    for (let i = 0; i <= r.steps; i++) {
      addPlatform(
        r.base.x + r.dir * i * STEP_RUN,
        r.base.z,
        r.firstY + i * STEP_RISE,
        i === r.steps ? CROWN_R : STEP_R
      );
    }
    // the snag trunk the bole leans on: solid, just past the crown so it
    // never blocks the ramp line
    const snagX = r.top.x + r.dir * 2.6;
    addCylinder(snagX, r.base.z, 1.1, r.top.y - terrainHeight(snagX, r.base.z) + 7);

    if (opts.collidersOnly) continue;

    // --- visuals: leaning bole, crown perch, host snag ---
    const group = new THREE.Group();
    const ax = r.base.x;
    const bx2 = r.top.x;
    const len = Math.hypot(bx2 - ax, r.top.y - r.base.y) + 2.5;
    const bole = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.15, len, 9), barkMat);
    bole.position.set((ax + bx2) / 2, (r.base.y + r.top.y) / 2 - 0.35, r.base.z);
    bole.quaternion.setFromUnitVectors(
      _up,
      new THREE.Vector3(bx2 - ax, r.top.y - r.base.y, 0).normalize()
    );
    bole.castShadow = true;
    group.add(bole);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(CROWN_R, 1.9, 0.5, 10), crownMat);
    crown.position.set(r.top.x, r.top.y - 0.25, r.top.z);
    crown.castShadow = true;
    group.add(crown);

    const snagH = r.top.y - terrainHeight(snagX, r.base.z) + 8;
    const snag = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, snagH, 8), snagMat);
    snag.position.set(snagX, terrainHeight(snagX, r.base.z) + snagH / 2, r.base.z);
    snag.castShadow = true;
    group.add(snag);

    scene.add(group);
    meshes.push(group);
  }
  return meshes;
}

export { STEP_RISE, STEP_RUN, STEP_R, CROWN_R };

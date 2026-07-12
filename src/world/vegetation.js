// The jungle. Everything here is InstancedMesh - a handful of draw calls
// for tens of thousands of plants. Placement is a seeded jittered grid
// (cheap blue noise) driven by the moisture map, so the swamp chokes with
// growth while the ridge stays open. Canopy + understory + wind sway carry
// pillar 1: readable dread.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  WORLD, terrainHeight, moisture, terrainNormal, gorgeZ, palisadeZ, fractureZ,
  thicketAt,
} from './heightmap.js';
import { addCylinder } from './colliders.js';
import { makeRng } from '../core/rng.js';
import { clamp } from '../core/noise.js';

const swayMats = [];

// Inject a cheap wind sway into any material: bends vertices by their local
// height, phase-offset by instance world position.
function windify(mat, strength = 1) {
  mat.userData.swayStrength = strength;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float phase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.47;
          float amt = ${strength.toFixed(3)} * max(0.0, position.y);
          transformed.x += sin(uTime * 1.35 + phase) * 0.045 * amt;
          transformed.z += cos(uTime * 1.02 + phase * 1.3) * 0.036 * amt;
        }`);
  };
  swayMats.push(mat);
  return mat;
}

export function tickWind(t) {
  for (const m of swayMats) {
    if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
  }
}

// ---------- geometry builders (shared by all instances of a species) ----------

function bigTreeTrunkGeo() {
  const g = new THREE.CylinderGeometry(0.42, 1.15, 15, 7);
  g.translate(0, 7.5, 0);
  return g;
}

function bigTreeCanopyGeo() {
  const parts = [];
  const blob = (x, y, z, r, squash) => {
    const s = new THREE.IcosahedronGeometry(r, 1);
    s.scale(1, squash, 1);
    s.translate(x, y, z);
    parts.push(s);
  };
  blob(0, 15.2, 0, 5.2, 0.62);
  blob(3.1, 13.9, 1.8, 3.6, 0.58);
  blob(-3.0, 13.5, -1.2, 3.9, 0.6);
  blob(0.8, 12.8, -2.8, 3.1, 0.55);
  return BufferGeometryUtils.mergeGeometries(parts);
}

function midTreeTrunkGeo() {
  const g = new THREE.CylinderGeometry(0.2, 0.4, 8.5, 6);
  g.translate(0, 4.25, 0);
  return g;
}

function midTreeCanopyGeo() {
  const parts = [];
  const a = new THREE.IcosahedronGeometry(2.7, 1);
  a.scale(1, 0.72, 1);
  a.translate(0, 8.6, 0);
  parts.push(a);
  const b = new THREE.IcosahedronGeometry(1.9, 1);
  b.scale(1, 0.6, 1);
  b.translate(1.1, 7.2, 0.7);
  parts.push(b);
  return BufferGeometryUtils.mergeGeometries(parts);
}

function snagGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.55, 9.5, 6);
  trunk.translate(0, 4.75, 0);
  parts.push(trunk);
  const b1 = new THREE.CylinderGeometry(0.07, 0.16, 3.4, 5);
  b1.rotateZ(0.9);
  b1.translate(1.1, 6.4, 0);
  parts.push(b1);
  const b2 = new THREE.CylinderGeometry(0.06, 0.13, 2.6, 5);
  b2.rotateZ(-0.8);
  b2.rotateY(1.4);
  b2.translate(-0.8, 5.2, 0.4);
  parts.push(b2);
  return BufferGeometryUtils.mergeGeometries(parts);
}

function fernGeo() {
  const parts = [];
  const frond = new THREE.PlaneGeometry(0.32, 1.5, 1, 3);
  frond.translate(0, 0.75, 0);
  for (let i = 0; i < 7; i++) {
    const f = frond.clone();
    const bend = 0.55 + (i % 3) * 0.14;
    f.rotateX(-bend);
    f.rotateY((i / 7) * Math.PI * 2);
    parts.push(f);
  }
  const g = BufferGeometryUtils.mergeGeometries(parts);
  return g;
}

function broadleafGeo() {
  const parts = [];
  const leaf = new THREE.PlaneGeometry(0.85, 2.1, 1, 3);
  // curl the paddle leaf
  const pos = leaf.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setZ(i, Math.sin((y + 1.05) / 2.1 * Math.PI) * 0.35);
  }
  leaf.translate(0, 1.05, 0);
  for (let i = 0; i < 5; i++) {
    const f = leaf.clone();
    f.rotateX(-0.5 - (i % 2) * 0.25);
    f.rotateY((i / 5) * Math.PI * 2 + 0.4);
    parts.push(f);
  }
  return BufferGeometryUtils.mergeGeometries(parts);
}

function grassGeo() {
  // three crossed tapered blades, not billboards - reads as a tuft
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(0.42, 0.55, 1, 2);
    const pos = p.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = (y + 0.275) / 0.55;         // 0 at base, 1 at tip
      pos.setX(v, pos.getX(v) * (1 - t * 0.85)); // taper to a point
      pos.setZ(v, t * t * 0.18);                  // slight droop
    }
    p.translate(0, 0.24, 0);
    p.rotateY((i / 3) * Math.PI);
    parts.push(p);
  }
  return BufferGeometryUtils.mergeGeometries(parts);
}

function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const r = makeRng(4242);
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) * (0.8 + r.next() * 0.4),
      pos.getY(i) * (0.55 + r.next() * 0.3),
      pos.getZ(i) * (0.8 + r.next() * 0.4));
  }
  g.computeVertexNormals();
  return g;
}

function lianaGeo() {
  const g = new THREE.CylinderGeometry(0.035, 0.05, 1, 4);
  g.translate(0, -0.5, 0); // hangs downward from anchor
  return g;
}

// Strangler-thicket clump: a splayed fan of tall curved canes with broad
// dark leaves - packed instances of this build the impassable walls.
function thicketGeo() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const lean = 0.18 + (i % 3) * 0.09;
    const cane = new THREE.CylinderGeometry(0.05, 0.16, 5.4, 5);
    cane.translate(0, 2.7, 0);
    cane.rotateZ(lean);
    cane.rotateY(a);
    parts.push(cane);
  }
  const leaf = new THREE.PlaneGeometry(0.9, 1.9, 1, 2);
  {
    const pos = leaf.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.sin((y + 0.95) / 1.9 * Math.PI) * 0.4);
    }
  }
  for (let i = 0; i < 7; i++) {
    const f = leaf.clone();
    f.translate(0, 0.95, 0);
    f.rotateX(-0.5 - (i % 3) * 0.3);
    f.rotateY((i / 7) * Math.PI * 2 + 0.2);
    f.translate(0, 2.4 + (i % 3) * 1.1, 0);
    parts.push(f);
  }
  return BufferGeometryUtils.mergeGeometries(parts);
}

// Warning bloom: a glowing magenta trumpet atop the wall growth - the
// fever-dream's way of saying "not through here".
function warnBloomGeo() {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.03, 0.05, 1.4, 4);
  stem.translate(0, 0.7, 0);
  parts.push(stem);
  const cone = new THREE.ConeGeometry(0.34, 0.6, 7, 1, true);
  cone.rotateX(Math.PI);
  cone.translate(0, 1.65, 0);
  parts.push(cone);
  return BufferGeometryUtils.mergeGeometries(parts);
}

// ---------- placement ----------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function makeInstanced(geo, mat, transforms, colors, shadows) {
  const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
  for (let i = 0; i < transforms.length; i++) {
    mesh.setMatrixAt(i, transforms[i]);
    if (colors) mesh.setColorAt(i, colors[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (shadows === 'cast' || shadows === 'both') mesh.castShadow = true;
  if (shadows === 'receive' || shadows === 'both') mesh.receiveShadow = true;
  mesh.frustumCulled = false; // single instanced volume spans the map anyway
  return mesh;
}

// Jittered-grid scatter. cb(x, z, rng) returns truthy to accept a spot.
function scatter(cell, seedOffset, cb) {
  const rng = makeRng(WORLD.seed + seedOffset);
  const half = WORLD.playable + 24;
  for (let gx = -half; gx < half; gx += cell) {
    for (let gz = -half; gz < half; gz += cell) {
      const x = gx + rng.next() * cell;
      const z = gz + rng.next() * cell;
      cb(x, z, rng);
    }
  }
}

function clearOf(x, z, px, pz, r) {
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz > r * r;
}

export function buildVegetation(scene, opts = {}) {
  // opts.collidersOnly: register trunk/rock colliders but build no meshes -
  // the headless playtest runner needs the physics, not the pixels
  const t0 = performance.now();
  const ins = WORLD.insertion;
  const ext = WORLD.extraction;

  const bigTrunks = [];
  const bigCanopies = [];
  const bigColors = [];
  const midTrunks = [];
  const midCanopies = [];
  const midColors = [];
  const snags = [];
  const ferns = [];
  const fernColors = [];
  const leaves = [];
  const leafColors = [];
  const grass = [];
  const grassColors = [];
  const rocks = [];
  const rockColors = [];
  const lianas = [];
  const thickets = [];
  const thicketColors = [];
  const warnBlooms = [];

  const cBigCanopy = new THREE.Color();
  const cTmp = new THREE.Color();

  // the mesa stair centreline (for keeping the ramp clear of trunks)
  const stairAz = Math.atan2(WORLD.maw.x - ext.x, WORLD.maw.z - ext.z);
  const stairUx = Math.sin(stairAz);
  const stairUz = Math.cos(stairAz);

  function nearStair(x, z) {
    // distance from the stair centreline segment (d 8..56 from mesa centre)
    const px = x - ext.x;
    const pz = z - ext.z;
    let along = px * stairUx + pz * stairUz;
    along = Math.max(8, Math.min(56, along));
    const cx = ext.x + stairUx * along;
    const cz = ext.z + stairUz * along;
    return Math.hypot(x - cx, z - cz) < 11;
  }

  function keepSpot(x, z, h) {
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable + 20) return false;
    if (!clearOf(x, z, ins.x, ins.z, 10)) return false;
    if (!clearOf(x, z, ext.x, ext.z, 13)) return false;
    // never choke a gorge crossing - the sills must stay walkable
    for (const c of WORLD.crossings) {
      if (Math.abs(x - c.x) < 11 && Math.abs(z - gorgeZ(c.x)) < 26) return false;
    }
    // round 3: keep every forced corridor readable and open
    for (const g of WORLD.gates) {
      if (Math.abs(x - g.x) < 13 && Math.abs(z - palisadeZ(g.x)) < 34) return false;
    }
    if (Math.abs(x - WORLD.bonebridge.x) < 12
      && Math.abs(z - fractureZ(WORLD.bonebridge.x)) < 30) return false;
    if (Math.abs(x - WORLD.scree.x) < 28
      && Math.abs(z - fractureZ(WORLD.scree.x)) < 42) return false;
    if (!clearOf(x, z, WORLD.maw.x, WORLD.maw.z, WORLD.maw.r + 4)) return false;
    if (nearStair(x, z)) return false;
    // thicket interior grows its own wall species, nothing else
    if (thicketAt(x, z) > 0.2) return false;
    return h > -60;
  }

  // --- big emergent trees ---
  scatter(13, 11, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    if (h < WORLD.waterLevel + 0.3) return;      // not in water
    const n = terrainNormal(x, z);
    if (n.y < 0.86) return;                       // not on cliffs
    const m = moisture(x, z);
    if (rng.next() > m * 0.62 + 0.04) return;
    const s = 0.85 + rng.next() * 0.55;
    _e.set((rng.next() - 0.5) * 0.06, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.06);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, h - 0.4, z), _q, _s.set(s, s * (0.9 + rng.next() * 0.25), s));
    bigTrunks.push(_m.clone());
    bigCanopies.push(_m.clone());
    if (rng.chance(0.3)) {
      // flowering emergent: a crown of colour above the canopy sea
      // (round 3: Far Cry New Dawn saturation push - more, hotter)
      cBigCanopy.setHSL(rng.pick([0.9, 0.02, 0.52, 0.13, 0.62]), 0.72 + rng.next() * 0.24, 0.44 + rng.next() * 0.14);
    } else {
      cBigCanopy.setHSL(0.22 + rng.next() * 0.2, 0.58 + rng.next() * 0.3, 0.28 + rng.next() * 0.14);
    }
    bigColors.push(cBigCanopy.clone());
    addCylinder(x, z, 0.95 * s, 15 * s, h - 1);

    // lianas hanging from this canopy
    const nL = rng.int(1, 3);
    for (let i = 0; i < nL; i++) {
      const lx = x + (rng.next() - 0.5) * 6 * s;
      const lz = z + (rng.next() - 0.5) * 6 * s;
      const topY = h + (11 + rng.next() * 3) * s;
      const len = topY - terrainHeight(lx, lz) - (0.5 + rng.next() * 2.5);
      if (len < 3) continue;
      _q.identity();
      _m.compose(_p.set(lx, topY, lz), _q, _s.set(1, len, 1));
      lianas.push(_m.clone());
    }
  });

  // --- mid canopy trees ---
  scatter(7.2, 23, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    if (h < WORLD.waterLevel + 0.25) return;
    const n = terrainNormal(x, z);
    if (n.y < 0.82) return;
    const m = moisture(x, z);
    if (rng.next() > m * 0.78 + 0.05) return;
    const s = 0.7 + rng.next() * 0.6;
    _e.set((rng.next() - 0.5) * 0.14, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.14);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, h - 0.3, z), _q, _s.set(s, s, s));
    midTrunks.push(_m.clone());
    midCanopies.push(_m.clone());
    if (rng.chance(0.24)) {
      cTmp.setHSL(rng.pick([0.86, 0.05, 0.48, 0.14]), 0.68 + rng.next() * 0.25, 0.42 + rng.next() * 0.12);
    } else {
      cTmp.setHSL(0.2 + rng.next() * 0.22, 0.55 + rng.next() * 0.28, 0.28 + rng.next() * 0.14);
    }
    midColors.push(cTmp.clone());
    addCylinder(x, z, 0.36 * s, 8.5 * s, h - 1);
  });

  // --- dead snags (swamp + scattered) ---
  scatter(16, 37, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    const inSwamp = x < -55 && Math.abs(z) < 265;
    const nearWater = h < WORLD.waterLevel + 1.2;
    if (!inSwamp && !(nearWater && rng.chance(0.35))) return;
    if (rng.next() > 0.5) return;
    const s = 0.8 + rng.next() * 0.7;
    _e.set((rng.next() - 0.5) * 0.2, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.2);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, h - 0.3, z), _q, _s.set(s, s, s));
    snags.push(_m.clone());
    addCylinder(x, z, 0.5 * s, 9 * s, h - 1);
  });

  // --- ferns ---
  scatter(3.4, 41, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    if (h < WORLD.waterLevel + 0.15) return;
    const m = moisture(x, z);
    if (rng.next() > (m - 0.25) * 1.15) return;
    const s = 0.65 + rng.next() * 0.9;
    _q.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
    _m.compose(_p.set(x, h - 0.05, z), _q, _s.set(s, s * (0.8 + rng.next() * 0.4), s));
    ferns.push(_m.clone());
    cTmp.setHSL(0.26 + rng.next() * 0.14, 0.5 + rng.next() * 0.25, 0.24 + rng.next() * 0.14);
    fernColors.push(cTmp.clone());
  });

  // --- broadleaf plants ---
  scatter(5.2, 53, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    if (h < WORLD.waterLevel + 0.1) return;
    const m = moisture(x, z);
    if (rng.next() > (m - 0.35) * 1.1) return;
    const s = 0.6 + rng.next() * 0.8;
    _q.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
    _m.compose(_p.set(x, h - 0.05, z), _q, _s.set(s, s, s));
    leaves.push(_m.clone());
    if (rng.chance(0.38)) {
      cTmp.setHSL(rng.pick([0.82, 0.9, 0.58, 0.12, 0.98]), 0.62 + rng.next() * 0.28, 0.38 + rng.next() * 0.14);
    } else {
      cTmp.setHSL(0.24 + rng.next() * 0.14, 0.55 + rng.next() * 0.22, 0.28 + rng.next() * 0.12);
    }
    leafColors.push(cTmp.clone());
  });

  // --- grass tufts ---
  scatter(2.1, 67, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    if (h < WORLD.waterLevel + 0.1) return;
    const m = moisture(x, z);
    if (rng.next() > m * 0.75) return;
    const s = 0.6 + rng.next() * 0.9;
    _q.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
    _m.compose(_p.set(x, h - 0.03, z), _q, _s.set(s, s, s));
    grass.push(_m.clone());
    cTmp.setHSL(0.2 + rng.next() * 0.16, 0.45 + rng.next() * 0.2, 0.22 + rng.next() * 0.12);
    grassColors.push(cTmp.clone());
  });

  // --- rocks (ridge-biased) ---
  scatter(11, 79, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    const n = terrainNormal(x, z);
    const rocky = (1 - n.y) * 2.6 + (h > 12 ? 0.35 : 0) + 0.06;
    if (rng.next() > rocky) return;
    const s = 0.5 + rng.next() * 2.1;
    _e.set(rng.next() * 0.6, rng.next() * Math.PI * 2, rng.next() * 0.6);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, h - 0.35 * s, z), _q, _s.set(s, s * (0.7 + rng.next() * 0.5), s));
    rocks.push(_m.clone());
    cTmp.setHSL(0.1, 0.05 + rng.next() * 0.06, 0.3 + rng.next() * 0.14);
    rockColors.push(cTmp.clone());
    if (s > 1.1) addCylinder(x, z, s * 0.75, s * 1.2, h - 1);
  });

  // --- thicket walls (round 3): dense, tall, glowing warnings on top ---
  scatter(2.0, 97, (x, z, rng) => {
    const d = thicketAt(x, z);
    if (d < 0.35) return;
    const h = terrainHeight(x, z);
    if (h < WORLD.waterLevel - 0.5) return;
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable + 10) return;
    const s = (0.8 + rng.next() * 0.55) * (0.7 + d * 0.5);
    _e.set((rng.next() - 0.5) * 0.12, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.12);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, h - 0.2, z), _q, _s.set(s, s * (0.85 + rng.next() * 0.4), s));
    thickets.push(_m.clone());
    // deep jungle wall: violet-greens with occasional hot accents
    if (rng.chance(0.14)) {
      cTmp.setHSL(rng.pick([0.85, 0.75, 0.98]), 0.65 + rng.next() * 0.25, 0.34 + rng.next() * 0.1);
    } else {
      cTmp.setHSL(0.3 + rng.next() * 0.12, 0.55 + rng.next() * 0.25, 0.16 + rng.next() * 0.1);
    }
    thicketColors.push(cTmp.clone());
    if (rng.chance(0.12)) {
      _q.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
      const bs = 0.9 + rng.next() * 0.8;
      _m.compose(_p.set(x + rng.range(-0.8, 0.8), h + 3.4 + rng.next() * 1.6, z + rng.range(-0.8, 0.8)), _q, _s.set(bs, bs, bs));
      warnBlooms.push(_m.clone());
    }
  });

  const counts0 = {
    bigTrees: bigTrunks.length,
    midTrees: midTrunks.length,
    snags: snags.length,
    ferns: ferns.length,
    broadleaf: leaves.length,
    grass: grass.length,
    rocks: rocks.length,
    lianas: lianas.length,
    thicket: thickets.length,
  };
  if (opts.collidersOnly) {
    counts0.ms = Math.round(performance.now() - t0);
    return counts0;
  }

  // ---------- materials + meshes ----------
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 1 });
  const barkMat2 = new THREE.MeshStandardMaterial({ color: 0x554736, roughness: 1 });
  const canopyMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true,
  }), 0.14);
  const canopyMat2 = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true,
  }), 0.2);
  const snagMat = new THREE.MeshStandardMaterial({ color: 0x6e675c, roughness: 1 });
  const fernMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
  }), 0.5);
  const leafMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
  }), 0.4);
  const grassMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
  }), 0.6);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const lianaMat = new THREE.MeshStandardMaterial({ color: 0x3c4a26, roughness: 1 });
  const thicketMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
  }), 0.22);
  const warnBloomMat = new THREE.MeshStandardMaterial({
    color: 0xff4fd0, emissive: 0xd0189a, emissiveIntensity: 1.8,
    roughness: 0.5, side: THREE.DoubleSide,
  });

  const meshes = [
    makeInstanced(bigTreeTrunkGeo(), barkMat, bigTrunks, null, 'both'),
    makeInstanced(bigTreeCanopyGeo(), canopyMat, bigCanopies, bigColors, 'cast'),
    makeInstanced(midTreeTrunkGeo(), barkMat2, midTrunks, null, 'both'),
    makeInstanced(midTreeCanopyGeo(), canopyMat2, midCanopies, midColors, 'cast'),
    makeInstanced(snagGeo(), snagMat, snags, null, 'both'),
    makeInstanced(fernGeo(), fernMat, ferns, fernColors, 'receive'),
    makeInstanced(broadleafGeo(), leafMat, leaves, leafColors, 'receive'),
    makeInstanced(grassGeo(), grassMat, grass, grassColors, 'receive'),
    makeInstanced(rockGeo(), rockMat, rocks, rockColors, 'both'),
    makeInstanced(lianaGeo(), lianaMat, lianas, null, 'none'),
    makeInstanced(thicketGeo(), thicketMat, thickets, thicketColors, 'cast'),
    makeInstanced(warnBloomGeo(), warnBloomMat, warnBlooms, null, 'none'),
  ];
  for (const m of meshes) scene.add(m);

  const counts = {
    bigTrees: bigTrunks.length,
    midTrees: midTrunks.length,
    snags: snags.length,
    ferns: ferns.length,
    broadleaf: leaves.length,
    grass: grass.length,
    rocks: rocks.length,
    lianas: lianas.length,
    ms: Math.round(performance.now() - t0),
  };
  console.log('[deadfall] vegetation', JSON.stringify(counts));
  return counts;
}

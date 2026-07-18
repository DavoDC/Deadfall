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
import { ROOSTS } from './roosts.js';
import { makeRng, hash2 } from '../core/rng.js';
import { clamp } from '../core/noise.js';
import { loadTextureSet, applyTextures } from '../core/textures.js';
import { dapplify } from './dapple.js';
import { makeFoliageAtlas, uvToTile, TILES } from './foliagetex.js';

const swayMats = [];
let swayMult = 1; // ayahuasca cranks this - the whole jungle writhes

// Round 7 wind: not a rigid per-instance wobble but a living gust field.
// A travelling gust front sweeps the map (plants downwind of each other
// move in sequence, the classic "wave through the field" read), layered
// with a per-instance breeze and a high-frequency tip flutter that only
// wakes when a gust passes. All in the vertex shader - zero CPU.
function windify(mat, strength = 1) {
  mat.userData.swayStrength = strength;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSwayMult = { value: swayMult };
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        uniform float uSwayMult;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 iwp = instanceMatrix[3].xz;
          float phase = iwp.x * 0.31 + iwp.y * 0.47;
          float amt = ${strength.toFixed(3)} * max(0.0, position.y) * uSwayMult;
          vec2 wdir = vec2(0.819, 0.574);        // prevailing wind
          float travel = dot(iwp, wdir);
          // gust front: two travelling waves moving downwind
          float gust = 0.5 + 0.5 * sin(uTime * 0.7 - travel * 0.07)
                     + 0.35 * sin(uTime * 1.83 - travel * 0.16 + phase);
          // per-plant breeze (always on, keeps calm frames alive)
          float breeze = sin(uTime * 1.35 + phase) * 0.6
                       + sin(uTime * 2.41 + phase * 1.7) * 0.4;
          // tip flutter, only when a gust is passing
          float flutter = sin(uTime * 6.8 + phase * 5.3 + position.y * 3.7)
                        * max(0.0, gust - 0.55) * 0.5;
          vec2 sway = wdir * (gust * 0.075 + breeze * 0.038)
                    + vec2(-wdir.y, wdir.x) * (breeze * 0.03 + flutter * 0.05);
          transformed.xz += sway * amt;
          // conservation bow: a bent blade's tip drops slightly
          transformed.y -= dot(sway, sway) * amt * 0.4;
        }`);
  };
  swayMats.push(mat);
  return mat;
}

export function tickWind(t) {
  for (const m of swayMats) {
    if (m.userData.shader) {
      m.userData.shader.uniforms.uTime.value = t;
      m.userData.shader.uniforms.uSwayMult.value = swayMult;
    }
  }
}

// The vine opens your eyes: the whole understory breathes with you.
export function setSwayMult(m) {
  swayMult = m;
}

// ---------- geometry builders (shared by all instances of a species) ----------

// Tile trunk UVs so bark detail reads at gameplay distance. Cylinder UVs
// span 0-1 over the whole surface: on a 15m trunk that stretches the bark
// texture 15m per tile - invisible mush at mid-distance (the round-4
// baseline's "solid grey columns" complaint). RepeatWrapping is already on.
function tileUV(g, uRep, vRep) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uRep, uv.getY(i) * vRep);
  }
  return g;
}

function bigTreeTrunkGeo() {
  const g = new THREE.CylinderGeometry(0.42, 1.15, 15, 7);
  g.translate(0, 7.5, 0);
  return tileUV(g, 2, 5);
}

// Noise-displace a canopy blob's vertices so the silhouette reads as
// leaf-mass lumps instead of a perfect geodesic polyhedron (round 7:
// "no polygons"). Flat shading is kept - the style survives, the
// geometric regularity does not.
function roughen(geo, amp, seed) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // hash on the vertex position so merged coincident verts stay merged
    const n = hash2(Math.round(x * 37 + z * 17), Math.round(y * 29 + z * 41), seed);
    const k = 1 + (n - 0.5) * amp;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function bigTreeCanopyGeo() {
  const parts = [];
  const blob = (x, y, z, r, squash, seed) => {
    const s = new THREE.IcosahedronGeometry(r, 1);
    roughen(s, 0.42, seed);
    s.scale(1, squash, 1);
    s.translate(x, y, z);
    parts.push(s);
  };
  blob(0, 15.2, 0, 5.2, 0.62, 5);
  blob(3.1, 13.9, 1.8, 3.6, 0.58, 11);
  blob(-3.0, 13.5, -1.2, 3.9, 0.6, 17);
  blob(0.8, 12.8, -2.8, 3.1, 0.55, 23);
  return BufferGeometryUtils.mergeGeometries(parts);
}

function midTreeTrunkGeo() {
  const g = new THREE.CylinderGeometry(0.2, 0.4, 8.5, 6);
  g.translate(0, 4.25, 0);
  return tileUV(g, 1.5, 3.5);
}

function midTreeCanopyGeo() {
  const parts = [];
  const a = new THREE.IcosahedronGeometry(2.7, 1);
  roughen(a, 0.4, 29);
  a.scale(1, 0.72, 1);
  a.translate(0, 8.6, 0);
  parts.push(a);
  const b = new THREE.IcosahedronGeometry(1.9, 1);
  roughen(b, 0.44, 31);
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
  // pinnate frond CARDS from the atlas - the silhouette is the leaf's,
  // not the quad's. Slight forward curl per card via segment bend.
  const parts = [];
  const frond = new THREE.PlaneGeometry(0.62, 1.55, 1, 3);
  {
    const pos = frond.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + 0.775) / 1.55;
      pos.setZ(i, t * t * 0.34); // tip curls forward
    }
  }
  uvToTile(frond, TILES.fern);
  frond.translate(0, 0.7, 0);
  for (let i = 0; i < 7; i++) {
    const f = frond.clone();
    const bend = 0.5 + (i % 3) * 0.16;
    f.rotateX(-bend);
    f.rotateY((i / 7) * Math.PI * 2);
    parts.push(f);
  }
  const g = BufferGeometryUtils.mergeGeometries(parts);
  return g;
}

function broadleafGeo() {
  const parts = [];
  const leaf = new THREE.PlaneGeometry(0.95, 2.1, 1, 3);
  // curl the paddle leaf
  const pos = leaf.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setZ(i, Math.sin((y + 1.05) / 2.1 * Math.PI) * 0.35);
  }
  uvToTile(leaf, TILES.broadleaf);
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
  // three crossed tuft CARDS - each shows ~16 curved blades + seed heads
  // from the atlas, so one instance reads as a whole wild clump with an
  // organic silhouette instead of three bare triangles
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.PlaneGeometry(0.95, 0.8, 1, 2);
    const pos = p.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = (y + 0.4) / 0.8;            // 0 at base, 1 at top
      pos.setZ(v, t * t * 0.16);            // gentle lean
    }
    uvToTile(p, TILES.grass);
    p.translate(0, 0.37, 0);
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
    uvToTile(leaf, TILES.thicket);
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

// SUNSPIRE FUNGI: a cluster of tall glowing spire-mushrooms - the light of
// the dark understory. Three spires per cluster, caps merged separately so
// the caps can burn emissive while the stalks stay matte.
function sunspireStalkGeo() {
  const parts = [];
  for (const [x, z, h, r] of [[0, 0, 2.1, 0.09], [0.34, 0.18, 1.4, 0.07], [-0.28, 0.26, 1.0, 0.06]]) {
    const s = new THREE.CylinderGeometry(r * 0.55, r, h, 5);
    s.translate(x, h / 2, z);
    parts.push(s);
  }
  return BufferGeometryUtils.mergeGeometries(parts);
}

function sunspireCapGeo() {
  const parts = [];
  for (const [x, z, h, r] of [[0, 0, 2.1, 0.09], [0.34, 0.18, 1.4, 0.07], [-0.28, 0.26, 1.0, 0.06]]) {
    const cap = new THREE.ConeGeometry(r * 3.2, r * 7, 6);
    cap.translate(x, h + r * 2.4, z);
    parts.push(cap);
    // skirt ring of gills under the cap
    const ring = new THREE.TorusGeometry(r * 2.1, r * 0.5, 5, 8);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, h + r * 0.6, z);
    parts.push(ring);
  }
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
  const sunspires = [];       // stalks + caps share one transform list

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
    // round 5: keep the gorge-roost ramps walkable - the flood retreat
    // fails if a trunk wedges you off the treads mid-climb
    for (const r of ROOSTS) {
      if (Math.abs(z - r.base.z) < 4.5
        && x > Math.min(r.base.x, r.top.x) - 3
        && x < Math.max(r.base.x, r.top.x) + 6) return false;
    }
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

  // --- grass tufts (round 7: denser - the meadow must read as GROWTH) ---
  scatter(1.6, 67, (x, z, rng) => {
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

  // --- sunspire fungi (round 5): the light of the dark understory ---
  // Moist, shaded ground only - they answer the round-4 note that the
  // canopy interior reads near-black by putting LIGHTS in it, never by
  // raising the darkness floor.
  scatter(13, 113, (x, z, rng) => {
    const h = terrainHeight(x, z);
    if (!keepSpot(x, z, h)) return;
    if (h < WORLD.waterLevel + 0.2) return;
    const m = moisture(x, z);
    if (rng.next() > (m - 0.45) * 1.4) return; // wet understory only
    const s = 0.7 + rng.next() * 1.1;
    _q.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
    _m.compose(_p.set(x, h - 0.05, z), _q, _s.set(s, s * (0.85 + rng.next() * 0.5), s));
    sunspires.push(_m.clone());
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
  // Ground-level materials are dapplified: canopy-gap sun shafts play across
  // terrain, trunks and understory together (see world/dapple.js).
  // warmed + saturated toward the palette: the old 0x4a3b28/0x554736 read
  // as uniform GREY columns at mid-distance under the desaturated bark map
  const barkMat = dapplify(new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 1 }));
  const barkMat2 = dapplify(new THREE.MeshStandardMaterial({ color: 0x715237, roughness: 1 }));
  const canopyMat = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true,
  }), 0.19);
  const canopyMat2 = windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true,
  }), 0.26);
  const snagMat = dapplify(new THREE.MeshStandardMaterial({ color: 0x6e675c, roughness: 1 }));
  // round 7: understory species draw their ORGANIC silhouettes from the
  // procedural atlas (alpha-cutout, so depth writes, shadows and the
  // legibility probe all keep working - no transparency sorting)
  const atlas = makeFoliageAtlas();
  const fernMat = dapplify(windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
    map: atlas, alphaTest: 0.45,
  }), 0.5));
  const leafMat = dapplify(windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
    map: atlas, alphaTest: 0.45,
  }), 0.4));
  const grassMat = dapplify(windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
    map: atlas, alphaTest: 0.45,
  }), 0.6));
  const rockMat = dapplify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }));
  const lianaMat = dapplify(new THREE.MeshStandardMaterial({ color: 0x3c4a26, roughness: 1 }));
  const thicketMat = dapplify(windify(new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, side: THREE.DoubleSide,
    map: atlas, alphaTest: 0.45,
  }), 0.22));
  const warnBloomMat = new THREE.MeshStandardMaterial({
    // round-6: x3.5 into true HDR so the bloom threshold (1.0 linear
    // luminance) catches the warning tell - sRGB->linear crushes 0xd0189a
    // to ~0.28 luminance per unit intensity
    color: 0xff4fd0, emissive: 0xd0189a, emissiveIntensity: 6.3,
    roughness: 0.5, side: THREE.DoubleSide,
  });
  const sunspireStalkMat = dapplify(new THREE.MeshStandardMaterial({
    color: 0xd8cfa8, roughness: 0.9,
  }));
  const sunspireCapMat = new THREE.MeshStandardMaterial({
    // round-6: x3.5 - the sunspire caps are the jungle's lanterns; in HDR
    // they bloom softly through the canopy murk
    color: 0xffb63a, emissive: 0xff8210, emissiveIntensity: 9.8, roughness: 0.4,
  });
  // Load and apply textures asynchronously (non-blocking). If loading fails,
  // materials render with their vertex-colour fallbacks. This preserves the
  // vibrant palette and keeps the game playable in all contexts (headless,
  // offline, missing files).
  loadTextureSet('bark-01', '/textures/bark-01/')
    .then((textures) => {
      applyTextures(barkMat, textures, 0.65);
    })
    .catch(() => {});
  loadTextureSet('bark-02', '/textures/bark-02/')
    .then((textures) => {
      applyTextures(barkMat2, textures, 0.65);
    })
    .catch(() => {});
  loadTextureSet('foliage', '/textures/foliage/')
    .then((textures) => {
      applyTextures(canopyMat, textures, 0.5);
      applyTextures(canopyMat2, textures, 0.5);
    })
    .catch(() => {});
  // (fern/leaf/thicket/grass now use the procedural silhouette atlas -
  // the old tiled foliage texture no longer applies to them)
  loadTextureSet('rock', '/textures/rock/')
    .then((textures) => {
      applyTextures(rockMat, textures, 0.6);
    })
    .catch(() => {});

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
    makeInstanced(sunspireStalkGeo(), sunspireStalkMat, sunspires, null, 'none'),
    makeInstanced(sunspireCapGeo(), sunspireCapMat, sunspires, null, 'none'),
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
    sunspires: sunspires.length,
    ms: Math.round(performance.now() - t0),
  };
  console.log('[deadfall] vegetation', JSON.stringify(counts));
  return counts;
}

// Terrain mesh built from the analytic heightmap, coloured per-vertex by
// height / moisture / slope so the three routes read at a glance:
// dark boggy swamp, olive riverbed, khaki-rock ridge, deep green jungle floor.

import * as THREE from 'three';
import { WORLD, terrainHeight, moisture, terrainNormal, razorfinHazard } from './heightmap.js';
import { clamp, lerp } from '../core/noise.js';
import { hash2 } from '../core/rng.js';

// Fever-dream ground palette: saturated lush greens, golden dry grass,
// warm mud - nothing crushes toward black (round-1 "too dark" fix).
const COL = {
  mud: new THREE.Color(0x5c4630),
  wetMud: new THREE.Color(0x47351f),
  lush: new THREE.Color(0x2e6b1c),
  deepLush: new THREE.Color(0x1e5416),
  dry: new THREE.Color(0x9a9040),
  rock: new THREE.Color(0x8a7c6c),
  sand: new THREE.Color(0xb89a5a),
};

export function buildTerrain(scene) {
  const segs = 320;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    terrainNormal(x, z, n);
    const m = moisture(x, z);
    const slope = 1 - n.y;

    // base colour: dry khaki -> lush deep green by moisture
    c.copy(COL.dry).lerp(COL.lush, clamp(m * 1.25, 0, 1));
    if (m > 0.75) c.lerp(COL.deepLush, (m - 0.75) * 3);

    // waterline mud banks
    const bank = clamp((WORLD.waterLevel + 1.6 - h) / 2.4, 0, 1);
    if (bank > 0) c.lerp(h < WORLD.waterLevel ? COL.wetMud : COL.mud, bank * 0.9);

    // steep = exposed rock
    if (slope > 0.25) c.lerp(COL.rock, clamp((slope - 0.25) * 3.2, 0, 0.85));
    // high ridge tops fade to rock/dry grass
    if (h > 14) c.lerp(COL.rock, clamp((h - 14) / 18, 0, 0.7));

    // per-vertex variance breaks up flat shading
    const v = hash2(Math.round(x * 2.3), Math.round(z * 2.3), 91) * 0.16 - 0.08;
    c.offsetHSL(0, 0, v * 0.35);

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);
  return mesh;
}

export function buildWater(scene) {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 64, 64);
  geo.rotateX(-Math.PI / 2);

  // per-vertex colour: living teal water, blooming BLOOD RED over the
  // razorfin gorge - the hazard telegraphs itself from a distance
  const pos = geo.attributes.position;
  const wCol = new Float32Array(pos.count * 3);
  const cSafe = new THREE.Color(0x2a9e8a);
  const cBlood = new THREE.Color(0xa01a2e);
  const cw = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const hz = razorfinHazard(pos.getX(i), pos.getZ(i));
    cw.copy(cSafe).lerp(cBlood, hz);
    wCol[i * 3] = cw.r;
    wCol[i * 3 + 1] = cw.g;
    wCol[i * 3 + 2] = cw.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    roughness: 0.3,
    metalness: 0.1,
    // DoubleSide + no depth-write: the surface stays visible from BELOW
    // (round-1 bug: wading the deep channel put the camera under the
    // single-sided plane and the water "vanished")
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.waterLevel;
  mesh.name = 'water';
  scene.add(mesh);

  // gentle swell so the river reads as liquid even without textures
  const base = geo.attributes.position.array.slice();
  mesh.userData.tick = (t) => {
    const arr = geo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      arr[i + 1] = Math.sin(t * 1.1 + x * 0.11 + z * 0.13) * 0.09
        + Math.sin(t * 0.7 + z * 0.07) * 0.06;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return mesh;
}

export function heightAt(x, z) {
  return terrainHeight(x, z);
}

export { lerp };

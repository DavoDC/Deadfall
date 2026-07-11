// Terrain mesh built from the analytic heightmap, coloured per-vertex by
// height / moisture / slope so the three routes read at a glance:
// dark boggy swamp, olive riverbed, khaki-rock ridge, deep green jungle floor.

import * as THREE from 'three';
import { WORLD, terrainHeight, moisture, terrainNormal } from './heightmap.js';
import { clamp, lerp } from '../core/noise.js';
import { hash2 } from '../core/rng.js';

const COL = {
  mud: new THREE.Color(0x3d3020),
  wetMud: new THREE.Color(0x2e2517),
  lush: new THREE.Color(0x1e3d14),
  deepLush: new THREE.Color(0x142c0e),
  dry: new THREE.Color(0x5a5a30),
  rock: new THREE.Color(0x59524a),
  sand: new THREE.Color(0x6b5f3e),
};

export function buildTerrain(scene) {
  const segs = 256;
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
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14281e,
    transparent: true,
    opacity: 0.82,
    roughness: 0.35,
    metalness: 0.1,
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

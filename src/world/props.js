// Landmarks: extraction beacon (visible over the canopy - the navigation
// promise of every run), insertion drop crate, and mossy ruin clusters that
// act as loot magnets along each route.

import * as THREE from 'three';
import { WORLD, terrainHeight } from './heightmap.js';
import { addCylinder } from './colliders.js';
import { makeRng } from '../core/rng.js';

// Ruin sites: one per route + a river crossing. Pickups spawn around these.
export const RUIN_SITES = [
  { x: -118, z: 60, name: 'swamp shrine' },
  { x: 122, z: -40, name: 'ridge watchpost' },
  { x: 6, z: -8, name: 'river crossing' },
  { x: -34, z: -150, name: 'north ruin' },
  { x: 58, z: 132, name: 'south ruin' },
];

export function buildProps(scene) {
  const group = new THREE.Group();
  group.name = 'props';

  // ---------- extraction beacon ----------
  const ext = WORLD.extraction;
  const eh = terrainHeight(ext.x, ext.z);

  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 7.2, 0.7, 24),
    new THREE.MeshStandardMaterial({ color: 0x5b5f56, roughness: 0.9 })
  );
  pad.position.set(ext.x, eh + 0.1, ext.z);
  pad.receiveShadow = true;
  group.add(pad);
  addCylinder(ext.x + 5.9, ext.z, 0.35, 3.2, eh); // corner posts
  addCylinder(ext.x - 5.9, ext.z, 0.35, 3.2, eh);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.3, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x36403a, roughness: 0.7, metalness: 0.4 })
  );
  mast.position.set(ext.x + 5.9, eh + 6, ext.z);
  mast.castShadow = true;
  group.add(mast);

  const beaconLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffc857, emissive: 0xffa030, emissiveIntensity: 3.2,
    })
  );
  beaconLamp.position.set(ext.x + 5.9, eh + 12.2, ext.z);
  group.add(beaconLamp);

  // vertical light column - visible above canopy from across the map
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 2.4, 240, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc857, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      fog: false, // pierces the murk - the one fixed point in the jungle
    })
  );
  beam.position.set(ext.x + 5.9, eh + 110, ext.z);
  group.add(beam);

  const beaconLight = new THREE.PointLight(0xffb040, 30, 40);
  beaconLight.position.set(ext.x + 5.9, eh + 12.2, ext.z);
  group.add(beaconLight);

  // ---------- insertion crate ----------
  const insH = terrainHeight(WORLD.insertion.x, WORLD.insertion.z);
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.1, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x4c5a3a, roughness: 0.85 })
  );
  crate.position.set(WORLD.insertion.x + 2.4, insH + 0.55, WORLD.insertion.z + 1.5);
  crate.rotation.y = 0.4;
  crate.castShadow = true;
  crate.receiveShadow = true;
  group.add(crate);
  addCylinder(crate.position.x, crate.position.z, 0.95, 1.2, insH);

  // ---------- ruins ----------
  const rng = makeRng(WORLD.seed + 555);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x62685a, roughness: 1 });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x3f5230, roughness: 1 });
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const blocks = [];
  const mossBlocks = [];
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();

  for (const site of RUIN_SITES) {
    const n = rng.int(6, 11);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = rng.next() * 7 + 1.5;
      const x = site.x + Math.cos(a) * r;
      const z = site.z + Math.sin(a) * r;
      const h = terrainHeight(x, z);
      const sx = 0.9 + rng.next() * 2.4;
      const sy = 0.6 + rng.next() * 2.6;
      const sz = 0.9 + rng.next() * 1.6;
      _e.set(rng.next() * 0.25, rng.next() * Math.PI, rng.next() * 0.25);
      _q.setFromEuler(_e);
      _m.compose(new THREE.Vector3(x, h + sy * 0.3, z), _q, new THREE.Vector3(sx, sy, sz));
      (rng.chance(0.45) ? mossBlocks : blocks).push(_m.clone());
      if (Math.max(sx, sz) > 1.2) addCylinder(x, z, Math.max(sx, sz) * 0.55, sy, h - 0.5);
    }
    // one broken pillar per site as a silhouette landmark
    const px = site.x + rng.range(-3, 3);
    const pz = site.z + rng.range(-3, 3);
    const ph = terrainHeight(px, pz);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.75, 4.5 + rng.next() * 3, 8),
      stoneMat
    );
    pillar.position.set(px, ph + 2.2, pz);
    pillar.rotation.z = rng.range(-0.12, 0.12);
    pillar.castShadow = true;
    group.add(pillar);
    addCylinder(px, pz, 0.8, 5, ph - 0.5);
  }

  const blockMesh = new THREE.InstancedMesh(blockGeo, stoneMat, blocks.length);
  blocks.forEach((m, i) => blockMesh.setMatrixAt(i, m));
  blockMesh.castShadow = true;
  blockMesh.receiveShadow = true;
  const mossMesh = new THREE.InstancedMesh(blockGeo, mossMat, mossBlocks.length);
  mossBlocks.forEach((m, i) => mossMesh.setMatrixAt(i, m));
  mossMesh.castShadow = true;
  mossMesh.receiveShadow = true;
  group.add(blockMesh, mossMesh);

  scene.add(group);

  // animated bits, ticked from main
  let t = 0;
  function tickProps(dt) {
    t += dt;
    const pulse = 0.6 + 0.4 * Math.sin(t * 2.4);
    beaconLamp.material.emissiveIntensity = 1.6 + pulse * 2.6;
    beaconLight.intensity = 16 + pulse * 26;
    beam.material.opacity = 0.13 + pulse * 0.11;
  }

  return { tickProps };
}

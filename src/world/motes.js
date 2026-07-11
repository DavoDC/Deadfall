// Drifting spore motes around the player - cheap depth cue that makes the
// air feel thick and alive, especially in fog and under canopy.

import * as THREE from 'three';

const COUNT = 170;
const RANGE = 22;   // half-size of the wrap box around the player

export function createMotes(scene) {
  const geo = new THREE.PlaneGeometry(0.045, 0.045);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd8e8b0, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const pts = [];
  for (let i = 0; i < COUNT; i++) {
    pts.push({
      x: (Math.random() * 2 - 1) * RANGE,
      y: Math.random() * 9 + 0.4,       // relative to player feet
      z: (Math.random() * 2 - 1) * RANGE,
      phase: Math.random() * 10,
      speed: 0.12 + Math.random() * 0.3,
    });
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();

  function wrap(v) {
    if (v > RANGE) return v - RANGE * 2;
    if (v < -RANGE) return v + RANGE * 2;
    return v;
  }

  function update(dt, t, playerPos, camQuat) {
    for (let i = 0; i < COUNT; i++) {
      const pt = pts[i];
      pt.x = wrap(pt.x + Math.sin(t * 0.31 + pt.phase) * pt.speed * dt * 2);
      pt.z = wrap(pt.z + Math.cos(t * 0.23 + pt.phase * 1.7) * pt.speed * dt * 2);
      pt.y += Math.sin(t * 0.5 + pt.phase) * dt * 0.12 - dt * 0.03;
      if (pt.y < 0.2) pt.y = 9;
      if (pt.y > 9.5) pt.y = 0.3;
      _p.set(playerPos.x + pt.x, playerPos.y - 1.66 + pt.y, playerPos.z + pt.z);
      _m.compose(_p, camQuat, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { update };
}

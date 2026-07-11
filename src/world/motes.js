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

// Drizzle for the grey-mist mood: fast thin streaks in a wrap box.
export function createDrizzle(scene) {
  const N = 420;
  const geo = new THREE.PlaneGeometry(0.012, 0.5);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xc8d4c8, transparent: true, opacity: 0.34, depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  const R = 18;
  const drops = [];
  for (let i = 0; i < N; i++) {
    drops.push({
      x: (Math.random() * 2 - 1) * R,
      y: Math.random() * 14,
      z: (Math.random() * 2 - 1) * R,
      v: 9 + Math.random() * 4,
    });
  }
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();

  function update(dt, playerPos, camYawQuat) {
    if (!mesh.visible) return;
    for (let i = 0; i < N; i++) {
      const d = drops[i];
      d.y -= d.v * dt;
      if (d.y < 0) {
        d.y = 13 + Math.random() * 2;
        d.x = (Math.random() * 2 - 1) * R;
        d.z = (Math.random() * 2 - 1) * R;
      }
      _p.set(playerPos.x + d.x, playerPos.y - 1.66 + d.y, playerPos.z + d.z);
      _m.compose(_p, camYawQuat, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    update,
    setEnabled(on) {
      mesh.visible = on;
    },
  };
}

// Pooled combat effects: tracers, impact particle bursts, acid globs' splats.
// Everything preallocated - zero garbage during fights.

import * as THREE from 'three';

const TRACER_POOL = 28;
const PARTICLE_POOL = 340;

export function createEffects(scene) {
  // ---- tracers: stretched additive boxes from muzzle toward hit ----
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: 0xffe8a0, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0, maxLife: 0 });
  }
  let tracerIdx = 0;

  const _mid = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function spawnTracer(from, to) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % TRACER_POOL;
    const dist = from.distanceTo(to);
    if (dist < 3) return;
    _dir.subVectors(to, from).normalize();
    // start a bit ahead of the muzzle so it doesn't blind the shooter
    const start = 1.2;
    const len = Math.min(dist - start, 26 + Math.random() * 8);
    if (len <= 0) return;
    _mid.copy(from).addScaledVector(_dir, start + len / 2 + Math.random() * Math.max(0, dist - start - len));
    t.mesh.position.copy(_mid);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = 0.07;
    t.maxLife = 0.07;
  }

  // ---- particles: one instanced mesh, CPU-simulated ----
  const pGeo = new THREE.PlaneGeometry(0.07, 0.07);
  const pMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    depthWrite: false,
  });
  const pMesh = new THREE.InstancedMesh(pGeo, pMat, PARTICLE_POOL);
  pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pMesh.frustumCulled = false;
  scene.add(pMesh);
  const particles = [];
  for (let i = 0; i < PARTICLE_POOL; i++) {
    particles.push({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      life: 0, maxLife: 1, size: 1, color: new THREE.Color(),
    });
  }
  let pIdx = 0;
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

  const COLORS = {
    dirt: [new THREE.Color(0x5a4630), new THREE.Color(0x3d3020)],
    wood: [new THREE.Color(0x6b5233), new THREE.Color(0x8a7048)],
    flesh: [new THREE.Color(0x571414), new THREE.Color(0x7a1f16)],
    acid: [new THREE.Color(0x9fd63a), new THREE.Color(0x5f9e1e)],
    spark: [new THREE.Color(0xffd27a), new THREE.Color(0xfff2c0)],
    crit: [new THREE.Color(0xffc030), new THREE.Color(0xff7a18)],
    bloom: [new THREE.Color(0xff7ac8), new THREE.Color(0xffe258)],
    boom: [new THREE.Color(0xffb040), new THREE.Color(0x513c28)],
    razor: [new THREE.Color(0xc02040), new THREE.Color(0x701226)],
  };

  function burst(point, kind, count = 7, speed = 3.2) {
    const cols = COLORS[kind] || COLORS.dirt;
    for (let i = 0; i < count; i++) {
      const p = particles[pIdx];
      pIdx = (pIdx + 1) % PARTICLE_POOL;
      p.pos.copy(point);
      p.vel.set(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.9 + 0.6,
        (Math.random() - 0.5) * speed
      );
      p.life = p.maxLife = 0.28 + Math.random() * 0.22;
      p.size = 0.7 + Math.random() * 1.3;
      p.color.copy(cols[i % cols.length]);
    }
  }

  const camQuat = new THREE.Quaternion();

  function update(dt, camera) {
    // tracers
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, (t.life / t.maxLife)) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    // particles
    camera.getWorldQuaternion(camQuat);
    let needsColor = false;
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const p = particles[i];
      if (p.life <= 0) {
        pMesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      p.life -= dt;
      p.vel.y -= 11 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const s = p.size * Math.max(0.1, p.life / p.maxLife);
      _m4.compose(p.pos, camQuat, _s.set(s, s, s));
      pMesh.setMatrixAt(i, _m4);
      pMesh.setColorAt(i, p.color);
      needsColor = true;
    }
    pMesh.instanceMatrix.needsUpdate = true;
    if (needsColor && pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
  }

  // prime instanceColor buffer
  for (let i = 0; i < PARTICLE_POOL; i++) pMesh.setColorAt(i, new THREE.Color(0));

  return { spawnTracer, burst, update };
}

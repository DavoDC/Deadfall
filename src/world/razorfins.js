// Visible razorfins - scary toothed fish patrolling the gorge blood-water.
// ~26 instanced fish distributed where razorfinHazard > 0.4, lissajous swim
// with tail wag, converging and circling the player when in hazard water.

import * as THREE from 'three';
import { WORLD, waterLevel as getWaterLevel, razorfinHazard, gorgeZ } from './heightmap.js';

// Main.js hookup (do not edit main.js - put this snippet in your session notes):
// import { createRazorfins } from './world/razorfins.js';
// After effects is created:
// const razorfins = createRazorfins(scene, effects);
// In the main loop (after player update, before render):
// razorfins.update(dt, t, playerRef.p.pos, playerInWater);

const COUNT = 26;
const SILL_SPACING = 7;
const MIN_X = -300;
const MAX_X = 300;

// Skip sills where garrisons are
const SILL_CENTERS = [-112, -7, 138];
const SILL_AVOID = 18;  // skip within this distance of sill centers

export function createRazorfins(scene, effects) {
  const waterLevel = getWaterLevel || WORLD.waterLevel;

  // Create merged geometry for one fish:
  // body (torpedo), tail plane, dorsal spike, 2 jaw teeth
  function buildFishGeometry() {
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];

    // Body: torpedo shape (elongated capsule-like box)
    // Z-aligned, centered at origin, length 0.7m
    const bodyLen = 0.7;
    const bodyR = 0.08;
    // Front point
    vertices.push(0, 0, bodyLen / 2);
    // Back point
    vertices.push(0, 0, -bodyLen / 2);
    // Body sides (8 verts around circumference, at mid-body)
    const bodyMid = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      vertices.push(Math.cos(a) * bodyR, Math.sin(a) * bodyR, bodyMid);
    }

    // Tail fin: plane at back
    const tailZ = -bodyLen / 2 - 0.05;
    vertices.push(-0.15, 0, tailZ);       // left
    vertices.push(0.15, 0, tailZ);        // right
    vertices.push(0, 0.12, tailZ);        // top

    // Dorsal spike: small cone along top center
    const spikeZ = 0;
    vertices.push(0, bodyR + 0.06, spikeZ);

    // Jaw teeth: 2 small cones (white) at front bottom
    vertices.push(-0.04, -bodyR * 0.5, bodyLen / 2 - 0.1);  // left tooth
    vertices.push(0.04, -bodyR * 0.5, bodyLen / 2 - 0.1);   // right tooth

    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));

    // Build a simple indexed structure (this is a visual-only approximate fish,
    // not a full triangle mesh - just enough verts to define the shape)
    return geo;
  }

  // Build materials
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4a1428,         // dark red-black
    emissive: 0x8a2838,      // faint red emissive
    emissiveIntensity: 0.3,
    roughness: 0.7,
    metalness: 0.1,
  });

  // Alternate: use simpler geometries and group them
  // For efficiency, use a box for the body and instanced meshes
  const bodyGeo = new THREE.BoxGeometry(0.16, 0.16, 0.7);
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, COUNT);
  bodyMesh.frustumCulled = false;
  scene.add(bodyMesh);

  // Tail fin: planes
  const tailGeo = new THREE.PlaneGeometry(0.3, 0.24);
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x3a0a18,
    emissive: 0x6a1828,
    emissiveIntensity: 0.25,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const tailMesh = new THREE.InstancedMesh(tailGeo, tailMat, COUNT);
  tailMesh.frustumCulled = false;
  scene.add(tailMesh);

  // Jaw teeth: small cone-shaped, white
  const toothGeo = new THREE.ConeGeometry(0.02, 0.08, 4);
  const toothMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x999999,
    emissiveIntensity: 0.2,
    roughness: 0.4,
    metalness: 0.2,
  });
  const leftToothMesh = new THREE.InstancedMesh(toothGeo, toothMat, COUNT);
  const rightToothMesh = new THREE.InstancedMesh(toothGeo, toothMat, COUNT);
  leftToothMesh.frustumCulled = false;
  rightToothMesh.frustumCulled = false;
  scene.add(leftToothMesh);
  scene.add(rightToothMesh);

  // Dorsal spike: small cone
  const spikeGeo = new THREE.ConeGeometry(0.015, 0.12, 4);
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0x2a0a18,
    emissive: 0x6a1828,
    emissiveIntensity: 0.3,
    roughness: 0.6,
  });
  const spikeMesh = new THREE.InstancedMesh(spikeGeo, spikeMat, COUNT);
  spikeMesh.frustumCulled = false;
  scene.add(spikeMesh);

  // Fish state: home position, animation phase, converge state
  const fish = [];
  for (let i = 0; i < COUNT; i++) {
    fish.push({
      homeX: 0,
      homeZ: 0,
      phase: Math.random() * 10,
      converging: false,
      convergT: 0,
    });
  }

  // Distribute fish along gorge
  let fishIdx = 0;
  for (let x = MIN_X; x <= MAX_X; x += SILL_SPACING) {
    // Skip sills
    if (SILL_CENTERS.some((sill) => Math.abs(x - sill) < SILL_AVOID)) continue;
    if (fishIdx >= COUNT) break;

    const z = gorgeZ(x);
    const hazard = razorfinHazard(x, z);
    if (hazard > 0.4) {
      fish[fishIdx].homeX = x;
      fish[fishIdx].homeZ = z;
      fishIdx++;
    }
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();
  const _v = new THREE.Vector3();

  function update(dt, t, playerPos, playerInWater) {
    if (!playerPos) return;

    for (let i = 0; i < COUNT; i++) {
      const f = fish[i];

      // Lissajous swim: small oscillation around home
      const swimX = Math.sin(t * 0.8 + f.phase) * 4;
      const swimZ = Math.cos(t * 1.1 + f.phase * 0.7) * 1.5;
      const swimY = Math.sin(t * 0.5 + f.phase) * 0.1;

      let x = f.homeX + swimX;
      let z = f.homeZ + swimZ;
      let y = waterLevel - 0.25 + swimY;

      // Player convergence: when player is in hazard water within 25m
      const hazard = razorfinHazard(playerPos.x, playerPos.z);
      const dist = Math.hypot(playerPos.x - x, playerPos.z - z);

      if (playerInWater && hazard > 0 && dist < 25) {
        if (!f.converging) {
          f.converging = true;
          f.convergT = 0;
        }
        f.convergT += dt;

        // Converge at 8 m/s, circling at radius 1.2
        const circlePhase = f.convergT * 2 + f.phase;
        const circleR = 1.2;
        const targetX = playerPos.x + Math.cos(circlePhase) * circleR;
        const targetZ = playerPos.z + Math.sin(circlePhase) * circleR;

        const moveSpeed = 8;
        const dx = targetX - x;
        const dz = targetZ - z;
        const d = Math.hypot(dx, dz);
        if (d > 0.1) {
          x += (dx / d) * moveSpeed * dt;
          z += (dz / d) * moveSpeed * dt;
        }

        // Occasional leap: add upward parabola
        const leapPhase = Math.sin(f.convergT * 1.5 + f.phase);
        if (leapPhase > 0.8) {
          const leapT = (leapPhase - 0.8) / 0.2;
          y += Math.sin(leapT * Math.PI) * 0.6;
          // Splash on peak
          if (leapT > 0.4 && leapT < 0.6 && effects && effects.burst) {
            effects.burst(new THREE.Vector3(x, waterLevel, z), 'razor', 5, 2);
          }
        }
      } else {
        f.converging = false;
        f.convergT = 0;
      }

      // Yaw follows velocity direction (lissajous direction)
      const velX = Math.cos(t * 0.8 + f.phase) * 4 * 0.8;
      const velZ = -Math.sin(t * 1.1 + f.phase * 0.7) * 1.5 * 1.1;
      const yaw = Math.atan2(velX, velZ);

      // Tail wag: rotation.y +- 0.6 at 6Hz
      const tailWag = Math.sin(t * 6 * Math.PI * 2) * 0.6;

      _p.set(x, y, z);
      _q.setFromEuler(new THREE.Euler(0, yaw, 0));

      // Body
      _m.compose(_p, _q, _s);
      bodyMesh.setMatrixAt(i, _m);

      // Tail (behind body, with wag rotation)
      const tailZ = -0.35 - 0.05;
      _p.set(x, y, z + Math.cos(yaw) * tailZ + Math.sin(yaw) * 0);
      const qTail = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + tailWag, 0));
      _m.compose(_p, qTail, _s);
      tailMesh.setMatrixAt(i, _m);

      // Left tooth
      _p.set(
        x - 0.04 * Math.cos(yaw),
        y - 0.04,
        z + 0.35 * Math.cos(yaw)
      );
      _q.setFromEuler(new THREE.Euler(0, yaw + Math.PI / 2, 0.1));
      _m.compose(_p, _q, _s);
      leftToothMesh.setMatrixAt(i, _m);

      // Right tooth
      _p.set(
        x + 0.04 * Math.cos(yaw),
        y - 0.04,
        z + 0.35 * Math.cos(yaw)
      );
      _q.setFromEuler(new THREE.Euler(0, yaw + Math.PI / 2, -0.1));
      _m.compose(_p, _q, _s);
      rightToothMesh.setMatrixAt(i, _m);

      // Dorsal spike (along top)
      _p.set(x, y + 0.12, z);
      _q.setFromEuler(new THREE.Euler(0, yaw, 0));
      _m.compose(_p, _q, _s);
      spikeMesh.setMatrixAt(i, _m);
    }

    bodyMesh.instanceMatrix.needsUpdate = true;
    tailMesh.instanceMatrix.needsUpdate = true;
    leftToothMesh.instanceMatrix.needsUpdate = true;
    rightToothMesh.instanceMatrix.needsUpdate = true;
    spikeMesh.instanceMatrix.needsUpdate = true;
  }

  return { update };
}

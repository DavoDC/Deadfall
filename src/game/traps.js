// Deception layer: booby traps - snapjaws and dart totems. Placed at run reset
// (seeded, not director-spawned). Each trap triggers the player or nearby enemies
// and deals damage + applies effects. The trap damage is reported via dmgBySource.

import * as THREE from 'three';
import { WORLD, terrainHeight, palisadeZ, fractureZ, gorgeZ } from '../world/heightmap.js';
import { makeRng } from '../core/rng.js';
import { RUIN_SITES } from '../world/props.js';
import { sfxTrapSnap, sfxDart } from '../audio/engine.js';

export function createTraps(scene, playerRef, hooks) {
  // hooks: { damagePlayer(amount, pos, source), toast(msg),
  //          onNoise() -> director.onShot() }
  const traps = {
    snapjaws: [],
    dartTotems: [],
  };

  const _v = new THREE.Vector3();

  // ---- SNAPJAW TRAPS ----
  function createSnapjaw(x, z) {
    const h = terrainHeight(x, z);
    const jawL = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.08, 5, 8, Math.PI),
      new THREE.MeshStandardMaterial({
        color: 0xd8cdb2, emissive: 0x8a7a6a, emissiveIntensity: 0.4, roughness: 0.6,
      })
    );
    jawL.position.set(x - 0.15, h + 0.15, z);
    jawL.rotation.set(Math.PI / 2, 0, Math.PI / 6);
    jawL.castShadow = true;
    scene.add(jawL);

    const jawR = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.08, 5, 8, Math.PI),
      new THREE.MeshStandardMaterial({
        color: 0xd8cdb2, emissive: 0x8a7a6a, emissiveIntensity: 0.4, roughness: 0.6,
      })
    );
    jawR.position.set(x + 0.15, h + 0.15, z);
    jawR.rotation.set(Math.PI / 2, 0, -Math.PI / 6);
    jawR.castShadow = true;
    scene.add(jawR);

    return {
      type: 'snapjaw',
      x, z, h,
      radius: 0.9,
      damage: 16,
      active: true,
      triggered: false,
      meshes: [jawL, jawR],
      triggerCooldown: 0,
    };
  }

  function updateSnapjaws(dt) {
    const pp = playerRef.p.pos;
    for (const trap of traps.snapjaws) {
      if (!trap.active) continue;
      trap.triggerCooldown = Math.max(0, trap.triggerCooldown - dt);

      const dx = pp.x - trap.x;
      const dz = pp.z - trap.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < trap.radius * trap.radius && trap.triggerCooldown <= 0) {
        // trigger: damage + slow
        trap.active = false;
        trap.triggered = true;
        sfxTrapSnap(trap.meshes[0].position);
        hooks.damagePlayer(trap.damage, new THREE.Vector3(trap.x, trap.h, trap.z), 'snapjaw');
        // slow effect: zero horizontal velocity and apply a slow multiplier
        playerRef.p.vel.x *= 0.25;
        playerRef.p.vel.z *= 0.25;
        // the trap stuns for 1.2s by modulating velocity scaling
        trap.slowEndTime = performance.now() + 1200;
        // noise: calls director.onShot() twice
        hooks.onNoise();
        hooks.onNoise();
      }

      // apply slow if still active
      if (trap.triggered && performance.now() < trap.slowEndTime) {
        playerRef.p.vel.x *= 0.25;
        playerRef.p.vel.z *= 0.25;
      }
    }
  }

  function resetSnapjaws() {
    for (const trap of traps.snapjaws) {
      for (const m of trap.meshes) scene.remove(m);
    }
    traps.snapjaws.length = 0;

    // spawn ~10 snapjaws near loot clusters (RUIN_SITES)
    const rng = makeRng(WORLD.seed + 4321);
    let placed = 0;
    for (const site of RUIN_SITES) {
      const n = rng.chance(0.6) ? 1 : 0;
      for (let i = 0; i < n && placed < 10; i++) {
        const angle = rng.next() * Math.PI * 2;
        const dist = rng.range(2, 6);
        const x = site.x + Math.cos(angle) * dist;
        const z = site.z + Math.sin(angle) * dist;
        const h = terrainHeight(x, z);
        if (h > WORLD.waterLevel + 0.2) {
          traps.snapjaws.push(createSnapjaw(x, z));
          placed++;
        }
      }
    }
  }

  // ---- DART TOTEM TRAPS ----
  function createDartTotem(x, z, corridorDir) {
    const h = terrainHeight(x, z);
    // totem: stacked carved stone boxes
    const totemBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.8, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x62685a, roughness: 1 })
    );
    totemBase.position.set(x, h + 0.4, z);
    totemBase.castShadow = true;
    scene.add(totemBase);

    const totemMid = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.6, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x62685a, roughness: 1 })
    );
    totemMid.position.set(x, h + 1.3, z);
    scene.add(totemMid);

    const totemTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.5, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x62685a, roughness: 1 })
    );
    totemTop.position.set(x, h + 2.0, z);
    scene.add(totemTop);

    // glowing rune ring
    const runeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.35, 0.06, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0x4a9aff, emissive: 0x2a6aff, emissiveIntensity: 1.2, roughness: 0.4,
      })
    );
    runeRing.position.set(x, h + 1.0, z);
    runeRing.rotation.x = Math.PI / 2.5;
    scene.add(runeRing);

    // tripwire: thin emissive line between two stakes (perpendicular to corridor)
    const wireStakeL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.8 })
    );
    wireStakeL.position.set(x - 3.5, h + 0.15, z + (corridorDir === 'z' ? 3.5 : 0));
    wireStakeL.castShadow = true;
    scene.add(wireStakeL);

    const wireStakeR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.8 })
    );
    wireStakeR.position.set(x + 3.5, h + 0.15, z + (corridorDir === 'z' ? -3.5 : 0));
    wireStakeR.castShadow = true;
    scene.add(wireStakeR);

    const wireCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 7, 6),
      new THREE.MeshStandardMaterial({
        color: 0x6abaff, emissive: 0x4a8aff, emissiveIntensity: 0.6, roughness: 0.3,
      })
    );
    if (corridorDir === 'z') {
      wireCyl.position.set(x, h + 0.15, z);
    } else {
      wireCyl.position.set(x, h + 0.15, z);
      wireCyl.rotation.z = Math.PI / 2;
    }
    scene.add(wireCyl);

    // tripwire segment for crossing detection: perpendicular to corridor
    const wireP1 = new THREE.Vector3(
      corridorDir === 'z' ? x - 3.5 : x,
      h + 0.2,
      corridorDir === 'z' ? z : z - 3.5
    );
    const wireP2 = new THREE.Vector3(
      corridorDir === 'z' ? x + 3.5 : x,
      h + 0.2,
      corridorDir === 'z' ? z : z + 3.5
    );

    return {
      type: 'dartTotem',
      x, z, h,
      totemPos: new THREE.Vector3(x, h + 1.3, z),
      wireP1, wireP2,
      corridorDir,
      active: true,
      darts: [],
      dartsLaunching: false,
      dartT: 0,
      meshes: [totemBase, totemMid, totemTop, runeRing, wireStakeL, wireStakeR, wireCyl],
    };
  }

  function segmentCrossing(p1, p2, q1, q2) {
    // check if segment p1-p2 crosses segment q1-q2 (2D, ignoring y)
    const ccw = (a, b, c) => {
      return (c.z - a.z) * (b.x - a.x) > (b.z - a.z) * (c.x - a.x);
    };
    return ccw(p1, q1, q2) !== ccw(p2, q1, q2) && ccw(p1, p2, q1) !== ccw(p1, p2, q2);
  }

  function updateDartTotems(dt) {
    const pp = playerRef.p.pos;
    for (const trap of traps.dartTotems) {
      if (!trap.active) continue;

      // check if player crosses the tripwire
      if (!trap.dartsLaunching) {
        const prevPos = _v.copy(playerRef.p.pos);
        prevPos.addScaledVector(playerRef.p.vel, -dt);
        if (segmentCrossing(prevPos, pp, trap.wireP1, trap.wireP2)) {
          // trigger: fire 3 darts
          trap.dartsLaunching = true;
          trap.dartT = 0;
          const dartTravelTime = 0.6 / 3;
          for (let i = 0; i < 3; i++) {
            trap.darts.push({
              pos: trap.totemPos.clone(),
              targetPos: pp.clone(),
              age: 0,
              duration: dartTravelTime,
              damage: 8,
              radius: 0.8,
              speed: 30,
              fired: i * (0.6 / 3),
            });
            sfxDart(trap.totemPos);
          }
          hooks.onNoise();
        }
      }

      // update darts in flight
      for (let i = trap.darts.length - 1; i >= 0; i--) {
        const dart = trap.darts[i];
        dart.age += dt;
        if (dart.age < dart.fired) continue;

        const tFlight = dart.age - dart.fired;
        const t = tFlight / dart.duration;
        if (t <= 1) {
          dart.pos.lerpVectors(trap.totemPos, dart.targetPos, t);
          // check if player is hit
          const dist = dart.pos.distanceTo(pp);
          if (dist < dart.radius) {
            hooks.damagePlayer(dart.damage, dart.pos, 'dart');
            trap.darts.splice(i, 1);
          }
        } else {
          // dart expired
          trap.darts.splice(i, 1);
        }
      }

      if (trap.darts.length === 0) {
        trap.dartsLaunching = false;
      }
    }
  }

  function resetDartTotems() {
    for (const trap of traps.dartTotems) {
      for (const m of trap.meshes) scene.remove(m);
    }
    traps.dartTotems.length = 0;

    // place ~6 dart totems in forced corridors (gates and crossing approaches)
    // gate approaches (palisade side)
    for (const gate of WORLD.gates) {
      const zg = palisadeZ(gate.x);
      const offsetX = gate.x + (Math.random() < 0.5 ? -5 : 5);
      const h = terrainHeight(offsetX, zg - 4);
      if (h > WORLD.waterLevel + 0.2) {
        traps.dartTotems.push(createDartTotem(offsetX, zg - 4, 'z'));
      }
    }

    // fracture ways (bonebridge / scree)
    for (const fracLoc of [WORLD.bonebridge, WORLD.scree]) {
      const zf = fractureZ(fracLoc.x);
      const offsetZ = zf + (Math.random() < 0.5 ? -4 : 4);
      const h = terrainHeight(fracLoc.x, offsetZ);
      if (h > WORLD.waterLevel + 0.2) {
        traps.dartTotems.push(createDartTotem(fracLoc.x, offsetZ, 'x'));
      }
    }

    // gorge crossing approaches (not on the crossing itself)
    for (const cross of WORLD.crossings) {
      const zg = gorgeZ(cross.x);
      const offsetZ = zg + (cross.x < 0 ? -6 : 6);
      const h = terrainHeight(cross.x, offsetZ);
      if (h > WORLD.waterLevel + 0.2 && traps.dartTotems.length < 6) {
        traps.dartTotems.push(createDartTotem(cross.x, offsetZ, 'z'));
      }
    }
  }

  function update(dt) {
    updateSnapjaws(dt);
    updateDartTotems(dt);
  }

  function reset() {
    resetSnapjaws();
    resetDartTotems();
  }

  return { update, reset, traps };
}

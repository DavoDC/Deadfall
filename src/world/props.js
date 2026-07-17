// Landmarks: extraction beacon (visible over the canopy - the navigation
// promise of every run), insertion drop crate, and mossy ruin clusters that
// act as loot magnets along each route.

import * as THREE from 'three';
import { WORLD, terrainHeight, gorgeZ, palisadeZ, fractureZ } from './heightmap.js';
import { addCylinder } from './colliders.js';
import { makeRng } from '../core/rng.js';
import { loadTextureSet, applyTextures } from '../core/textures.js';
import { dapplify } from './dapple.js';

// Ruin sites: loot magnets shaping each route, plus staging grounds on the
// gorge approaches and a final cache before the mesa climb.
export const RUIN_SITES = [
  { x: -118, z: 80, name: 'swamp shrine' },
  { x: 52, z: 190, name: 'south ruin' }, // moved off the Palisade line (round 3)
  { x: 146, z: 34, name: 'ridge watchpost' }, // just east of the crest walk
  { x: 4, z: -14, name: 'rapids altar' },       // south approach, river route
  { x: -108, z: -16, name: 'causeway shrine' }, // south approach, swamp route
  { x: 148, z: -110, name: 'east descent' },    // north of the fallen giant
  { x: -58, z: -176, name: 'north ruin' },      // west of the river line
  { x: 44, z: -252, name: 'mesa gate' },        // last cache before the climb
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

  // ---------- EXTRACTION IGNITION (round 6 signature moment) ----------
  // When the player commits to extraction the beacon ANSWERS: the pillar
  // ignites, the lamp goes HDR-hot (heavy bloom), and a ring of light
  // sweeps outward across the canopy. Driven from main.js via
  // igniteBeacon(k) each frame; ringPulse() fires the shockwave on the
  // commit edge and again on extraction.
  const ignitionRing = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 26, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd070, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      depthWrite: false, fog: false,
    })
  );
  ignitionRing.position.set(ext.x + 5.9, eh + 16, ext.z);
  ignitionRing.visible = false;
  group.add(ignitionRing);
  let ringT = -1; // seconds since pulse start; -1 = idle
  let igniteK = 0;
  function igniteBeacon(k) { igniteK = Math.max(0, Math.min(1, k)); }
  function ringPulse() { ringT = 0; }

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
  // Round 4: ruins were flat colour slabs (the pale column + grey boxes at
  // Ridge Vista / the olive slabs at the rapids altar). Texture + dapple.
  const stoneMat = dapplify(new THREE.MeshStandardMaterial({ color: 0x62685a, roughness: 1 }));
  const mossMat = dapplify(new THREE.MeshStandardMaterial({ color: 0x3f5230, roughness: 1 }));
  loadTextureSet('stone-ruin', '/textures/stone-ruin/')
    .then((textures) => {
      applyTextures(stoneMat, textures, 0.6);
      applyTextures(mossMat, textures, 0.55);
    })
    .catch(() => {});
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

  // ---------- gorge crossing landmarks ----------
  // Each sill gets a physical story so the crossings read from a distance.
  const barkMat = dapplify(new THREE.MeshStandardMaterial({ color: 0x5c4430, roughness: 1 }));
  loadTextureSet('bark-01', '/textures/bark-01/')
    .then((textures) => applyTextures(barkMat, textures, 0.65))
    .catch(() => {});

  // FALLEN GIANT (ridge): a colossal trunk lying along the crossing
  {
    const c = WORLD.crossings[2];
    const zg = gorgeZ(c.x);
    const giantGeo = new THREE.CylinderGeometry(2.6, 3.4, 46, 12);
    // tile bark along the 46m length so it reads as wood, not smear
    const guv = giantGeo.attributes.uv;
    for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 4, guv.getY(i) * 10);
    const trunk = new THREE.Mesh(giantGeo, barkMat);
    const hDeck = terrainHeight(c.x, zg);
    trunk.rotation.x = Math.PI / 2; // lie along z (across the gorge)
    trunk.position.set(c.x, hDeck - 1.9, zg); // mostly buried: its back IS the deck
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);
    // shattered root ball at the south end
    const roots = new THREE.Mesh(new THREE.SphereGeometry(4.2, 8, 6), barkMat);
    roots.position.set(c.x + 2, hDeck + 0.5, zg + 24);
    roots.scale.set(1, 0.9, 0.5);
    roots.castShadow = true;
    group.add(roots);
    addCylinder(c.x + 2, zg + 24, 3.4, 5, hDeck - 1);
  }

  // THE RAPIDS (river): stepping boulders scattered along the sill
  {
    const c = WORLD.crossings[1];
    const zg = gorgeZ(c.x);
    const boulderGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 9; i++) {
      const bx = c.x + rng.range(-6, 6);
      const bz = zg + rng.range(-16, 16);
      const bh = terrainHeight(bx, bz);
      const s = rng.range(0.8, 2.1);
      const rock = new THREE.Mesh(boulderGeo, stoneMat);
      rock.position.set(bx, bh + s * 0.15, bz);
      rock.scale.set(s, s * rng.range(0.55, 0.8), s);
      rock.rotation.y = rng.next() * Math.PI;
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
      if (s > 1.4) addCylinder(bx, bz, s * 0.7, s, bh - 0.5);
    }
  }

  // ROOT CAUSEWAY (swamp): arched roots vaulting over the deck
  {
    const c = WORLD.crossings[0];
    const zg = gorgeZ(c.x);
    for (let i = 0; i < 5; i++) {
      const az = zg + (i - 2) * 7;
      const ah = terrainHeight(c.x, az);
      // arch plane faces the walker (XY): you pass under it heading north
      const arch = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.32, 6, 10, Math.PI), barkMat);
      arch.position.set(c.x, ah + 0.2, az);
      arch.rotation.y = rng.range(-0.15, 0.15);
      arch.castShadow = true;
      group.add(arch);
      addCylinder(c.x - 4.2, az, 0.5, 4, ah - 0.5);
      addCylinder(c.x + 4.2, az, 0.5, 4, ah - 0.5);
    }
  }

  // ---------- round-3 landmarks ----------
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe4dcc4, roughness: 0.7 });

  // BONEBRIDGE: the ribcage of something colossal arches over the Fracture
  // step - you walk up through its chest onto the highlands.
  {
    const bx = WORLD.bonebridge.x;
    for (let i = 0; i < 6; i++) {
      const rz = fractureZ(bx) + 12 - i * 5;
      const rh = terrainHeight(bx, rz);
      const r = 7.5 - Math.abs(i - 2.5) * 0.9;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.42 - i * 0.03, 6, 14, Math.PI), boneMat);
      rib.position.set(bx, rh + 0.4, rz);
      rib.rotation.z = (i - 2.5) * 0.06;
      rib.castShadow = true;
      group.add(rib);
      addCylinder(bx - r, rz, 0.6, 4, rh - 0.5);
      addCylinder(bx + r, rz, 0.6, 4, rh - 0.5);
    }
    // the skull, half-buried at the foot of the climb
    const skull = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), boneMat);
    const sz = fractureZ(bx) + 20;
    const sh = terrainHeight(bx + 10, sz);
    skull.position.set(bx + 10, sh + 1.1, sz);
    skull.scale.set(1, 0.82, 1.15);
    skull.castShadow = true;
    group.add(skull);
    const socketGeo = new THREE.SphereGeometry(0.85, 8, 6);
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 });
    for (const sx of [-1.3, 1.3]) {
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.set(bx + 10 + sx, sh + 1.7, sz - 2.6);
      group.add(socket);
    }
    addCylinder(bx + 10, sz, 3.2, 3.5, sh - 0.5);
  }

  // THE HOWLING GATE: monolith jaws either side of the west pass. The wind
  // howls through (audio hook lives in ambience).
  {
    const g0 = WORLD.gates[0];
    const gz = palisadeZ(g0.x);
    for (const [ox, lean] of [[-8, 0.12], [8, -0.1]]) {
      const mh = terrainHeight(g0.x + ox, gz);
      const mono = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 1.8), stoneMat);
      mono.position.set(g0.x + ox, mh + 6, gz);
      mono.rotation.z = lean;
      mono.castShadow = true;
      group.add(mono);
      addCylinder(g0.x + ox, gz, 1.8, 13, mh - 0.5);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.12, 6, 16),
        new THREE.MeshStandardMaterial({
          // round-6: x3.5 into HDR so the gate rings bloom (teal beacons
          // framing the west pass)
          color: 0x7ae8d0, emissive: 0x2ab89a, emissiveIntensity: 5.6, roughness: 0.4,
        })
      );
      ring.position.set(g0.x + ox, mh + 9.5, gz + (ox < 0 ? 1 : -1) * 0.95);
      group.add(ring);
    }
  }

  // SKYREACH SADDLE: cairn stack + streamer pole on the high pass
  {
    const g2 = WORLD.gates[2];
    const gz = palisadeZ(g2.x);
    const sh = terrainHeight(g2.x + 7, gz);
    let cy = sh;
    for (let i = 0; i < 5; i++) {
      const s = 1.6 - i * 0.24;
      const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), stoneMat);
      stone.position.set(g2.x + 7, cy + s * 0.6, gz);
      stone.rotation.y = i * 0.9;
      stone.castShadow = true;
      group.add(stone);
      cy += s * 0.95;
    }
    addCylinder(g2.x + 7, gz, 1.6, 6, sh - 0.5);
  }

  // CINDER FANG: the ember at the spire's tip - the beacon's dark twin,
  // visible over the canopy for navigation from anywhere north.
  const fangH = terrainHeight(WORLD.fang.x, WORLD.fang.z);
  const ember = new THREE.Mesh(
    new THREE.OctahedronGeometry(2.6, 0),
    new THREE.MeshStandardMaterial({
      color: 0xff7a2e, emissive: 0xff4a08, emissiveIntensity: 2.8, roughness: 0.3,
    })
  );
  ember.position.set(WORLD.fang.x, fangH + 3.4, WORLD.fang.z);
  group.add(ember);
  const emberLight = new THREE.PointLight(0xff5a18, 26, 60);
  emberLight.position.copy(ember.position);
  group.add(emberLight);

  // THE SUNKEN MAW: a drowned monolith ring + bone piles - the larder
  {
    const M = WORLD.maw;
    const mawRng = makeRng(WORLD.seed + 777);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const r = M.r - 4 + mawRng.range(-3, 3);
      const mx = M.x + Math.cos(a) * r;
      const mz = M.z + Math.sin(a) * r;
      const mh = terrainHeight(mx, mz);
      const mono = new THREE.Mesh(
        new THREE.BoxGeometry(1.4 + mawRng.next(), 4 + mawRng.next() * 4, 1.2),
        mawRng.chance(0.5) ? mossMat : stoneMat
      );
      mono.position.set(mx, mh + 1.6, mz);
      mono.rotation.set(mawRng.range(-0.2, 0.2), mawRng.next() * Math.PI, mawRng.range(-0.25, 0.25));
      mono.castShadow = true;
      group.add(mono);
      addCylinder(mx, mz, 1.1, 4, mh - 0.5);
    }
    // rib bones jutting from the shallows
    for (let i = 0; i < 7; i++) {
      const a = mawRng.next() * Math.PI * 2;
      const r = mawRng.range(4, M.r - 10);
      const bx2 = M.x + Math.cos(a) * r;
      const bz2 = M.z + Math.sin(a) * r;
      const bh = terrainHeight(bx2, bz2);
      const rib = new THREE.Mesh(new THREE.TorusGeometry(mawRng.range(1.2, 2.4), 0.16, 5, 10, Math.PI * 0.7), boneMat);
      rib.position.set(bx2, bh + 0.2, bz2);
      rib.rotation.set(0, mawRng.next() * Math.PI, mawRng.range(0.3, 0.9));
      group.add(rib);
    }
  }

  // THE STAIR: paired torch-blooms light the climb out of the moat
  {
    const ex2 = WORLD.extraction;
    const az = Math.atan2(WORLD.maw.x - ex2.x, WORLD.maw.z - ex2.z);
    const ux = Math.sin(az);
    const uz = Math.cos(az);
    const px = -uz;
    const pz = ux;
    const torchMat = new THREE.MeshStandardMaterial({
      // round-6: x3.5 into HDR - the stair torches become true glowing
      // orbs lighting the climb to extraction
      color: 0xffc857, emissive: 0xff9018, emissiveIntensity: 8.4, roughness: 0.4,
    });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4438, roughness: 0.9 });
    for (let d = 20; d <= 52; d += 8) {
      for (const side of [-1, 1]) {
        const tx = ex2.x + ux * d + px * side * 8;
        const tz = ex2.z + uz * d + pz * side * 8;
        const th = terrainHeight(tx, tz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 2.6, 5), poleMat);
        pole.position.set(tx, th + 1.3, tz);
        group.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 6), torchMat);
        bulb.position.set(tx, th + 2.75, tz);
        group.add(bulb);
      }
    }
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
    // ignition quickens the beacon's heartbeat as well as brightening it
    const pulse = 0.6 + 0.4 * Math.sin(t * (2.4 + igniteK * 4));
    // round-6: HDR pulse range - the lamp crosses the bloom threshold on
    // the upstroke, so the beacon literally breathes light. Ignition sends
    // it deep into HDR: the lamp becomes the brightest thing in the world.
    beaconLamp.material.emissiveIntensity = 2.4 + pulse * 5 + igniteK * 10;
    beaconLight.intensity = 16 + pulse * 26 + igniteK * 60;
    beam.material.opacity = 0.13 + pulse * 0.11 + igniteK * 0.4;
    const beamSwell = 1 + igniteK * 2.4;
    beam.scale.set(beamSwell, 1, beamSwell);
    // the ignition shockwave: a ring of light racing across the canopy
    if (ringT >= 0) {
      ringT += dt;
      const RING_SECS = 2.6;
      const p = ringT / RING_SECS;
      if (p >= 1) {
        ringT = -1;
        ignitionRing.visible = false;
      } else {
        const r = 4 + p * p * 300; // accelerating sweep
        ignitionRing.visible = true;
        ignitionRing.scale.set(r, 1, r);
        ignitionRing.material.opacity = 0.4 * (1 - p);
      }
    }
    // the Fang's ember breathes slowly - alive, watching
    const emberPulse = 0.5 + 0.5 * Math.sin(t * 0.9 + 1.4);
    // round-6: HDR pulse range - the ember blooms at the peak of each
    // slow breath (0xff4a08 crushes to ~0.26 linear lum per unit)
    ember.material.emissiveIntensity = 3 + emberPulse * 6;
    emberLight.intensity = 16 + emberPulse * 22;
    ember.rotation.y = t * 0.25;
  }

  return { tickProps, igniteBeacon, ringPulse };
}

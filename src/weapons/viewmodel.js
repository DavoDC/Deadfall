// Procedural first-person gun models + all viewmodel animation: sway, bob,
// recoil, reload dip, pump slide, weapon raise. Built from primitives -
// silhouette and motion sell the gun, not polycount.

import * as THREE from 'three';
import { lerp, clamp } from '../core/noise.js';

const GUNMETAL = new THREE.MeshStandardMaterial({ color: 0x555d63, roughness: 0.5, metalness: 0.25 });
const POLYMER = new THREE.MeshStandardMaterial({ color: 0x4c544a, roughness: 0.9, metalness: 0.0 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x6e5232, roughness: 0.85 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0x2e3330, roughness: 0.6, metalness: 0.1 });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r1, r2, len, mat, x, y, z, rotX = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 10), mat);
  m.rotation.x = rotX;
  m.position.set(x, y, z);
  return m;
}

function buildCarbine() {
  const g = new THREE.Group();
  g.add(box(0.052, 0.07, 0.30, GUNMETAL, 0, 0, -0.02));        // receiver
  g.add(box(0.048, 0.055, 0.22, POLYMER, 0, -0.005, -0.28));   // handguard
  g.add(cyl(0.012, 0.012, 0.26, GUNMETAL, 0, 0.005, -0.47));   // barrel
  g.add(cyl(0.017, 0.017, 0.06, ACCENT, 0, 0.005, -0.575));    // muzzle device
  g.add(box(0.04, 0.14, 0.05, POLYMER, 0, -0.1, 0.02));        // grip (angled)
  g.children[4].rotation.x = 0.35;
  g.add(box(0.042, 0.16, 0.07, GUNMETAL, 0, -0.115, -0.11));   // magazine
  g.children[5].rotation.x = -0.18;
  g.add(box(0.045, 0.06, 0.2, POLYMER, 0, 0.0, 0.20));         // stock
  g.add(box(0.055, 0.085, 0.045, POLYMER, 0, -0.005, 0.31));   // stock pad
  g.add(box(0.012, 0.03, 0.012, ACCENT, 0, 0.055, -0.36));     // front sight
  g.add(box(0.03, 0.028, 0.05, ACCENT, 0, 0.055, 0.05));       // rear sight block
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.61);
  g.add(muzzle);
  return { group: g, muzzle, pump: null };
}

function buildBreacher() {
  const g = new THREE.Group();
  g.add(box(0.055, 0.075, 0.26, GUNMETAL, 0, 0, 0.03));        // receiver
  g.add(cyl(0.016, 0.016, 0.5, GUNMETAL, 0, 0.02, -0.32));     // barrel
  g.add(cyl(0.014, 0.014, 0.42, ACCENT, 0, -0.02, -0.28));     // tube mag
  const pump = box(0.06, 0.05, 0.13, WOOD, 0, -0.02, -0.3);    // pump handle
  g.add(pump);
  g.add(box(0.045, 0.12, 0.06, WOOD, 0, -0.09, 0.09));         // grip
  g.children[4].rotation.x = 0.5;
  g.add(box(0.05, 0.07, 0.24, WOOD, 0, 0.005, 0.26));          // stock
  g.add(box(0.014, 0.025, 0.014, ACCENT, 0, 0.055, -0.5));     // bead sight
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.58);
  g.add(muzzle);
  return { group: g, muzzle, pump };
}

export function createViewmodel(camera, weapons, playerRef) {
  const rig = new THREE.Group();       // sway/bob/recoil applied here
  camera.add(rig);
  rig.position.set(0.17, -0.16, -0.32);
  rig.scale.setScalar(0.55);

  const models = {
    carbine: buildCarbine(),
    breacher: buildBreacher(),
  };
  for (const key of Object.keys(models)) {
    models[key].group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        o.renderOrder = 999;           // draw over world
        o.material = o.material.clone();
        o.material.depthTest = true;
      }
    });
    rig.add(models[key].group);
    models[key].group.visible = false;
  }

  // muzzle flash: cross of two additive planes + point light
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const flashGeo = new THREE.PlaneGeometry(0.22, 0.22);
  const flash1 = new THREE.Mesh(flashGeo, flashMat);
  const flash2 = new THREE.Mesh(flashGeo, flashMat);
  flash2.rotation.z = Math.PI / 4;
  flash1.renderOrder = 1000;
  flash2.renderOrder = 1000;
  const flashGroup = new THREE.Group();
  flashGroup.add(flash1, flash2);
  const flashLight = new THREE.PointLight(0xffbb55, 0, 14);
  flashGroup.add(flashLight);

  let swayX = 0;
  let swayY = 0;
  let recoilZ = 0;
  const tmpV = new THREE.Vector3();

  function update(intent, dt) {
    const st = weapons.state;
    // show active weapon
    for (const key of Object.keys(models)) {
      models[key].group.visible = key === st.current;
    }
    const model = models[st.current];

    // look sway (lag behind mouse)
    const targetSwayX = clamp(-intent.lookDX * 0.0012, -0.05, 0.05);
    const targetSwayY = clamp(intent.lookDY * 0.0012, -0.04, 0.04);
    swayX = lerp(swayX, targetSwayX, Math.min(1, dt * 10));
    swayY = lerp(swayY, targetSwayY, Math.min(1, dt * 10));

    // walk bob (phase shared with camera bob via player)
    const bobAmp = Math.min(1, playerRef.p.speedNow / 5.1) * (playerRef.p.sprinting ? 1.5 : 1);
    const bx = Math.sin(playerRef.p.bobPhase) * 0.012 * bobAmp;
    const by = -Math.abs(Math.sin(playerRef.p.bobPhase * 2)) * 0.009 * bobAmp;

    // recoil: kick back + up, spring back
    recoilZ = lerp(recoilZ, 0, Math.min(1, dt * 12));
    if (st.anim.fire > 0.85) recoilZ = Math.min(0.09, recoilZ + (st.current === 'breacher' ? 0.07 : 0.028));

    // reload dip + tilt
    const reloadDip = st.anim.reloadPhase > 0 || st.reloading > 0 ? 1 : 0;
    const raise = st.anim.raise;

    rig.position.x = 0.17 + swayX + bx;
    rig.position.y = -0.16 + swayY + by - reloadDip * 0.14 - raise * 0.22;
    rig.position.z = -0.32 + recoilZ * 0.6;
    rig.rotation.z = swayX * 1.4 - reloadDip * 0.5 - raise * 0.4;
    rig.rotation.x = swayY * 2 + recoilZ * 1.6 - reloadDip * 0.35;

    // sprint carry: tilt gun up-left while sprinting
    if (playerRef.p.sprinting) {
      rig.rotation.x = lerp(rig.rotation.x, 0.5, 0.35);
      rig.rotation.z = lerp(rig.rotation.z, 0.3, 0.35);
      rig.position.y -= 0.04;
    }

    // pump slide
    if (model.pump) {
      const t = st.anim.pump;
      // slide back around t ~ [0.9 .. 0.4]
      const slide = t > 0.4 ? Math.sin((1 - t) * Math.PI * 1.6) : 0;
      model.pump.position.z = -0.3 + slide * 0.09;
    }

    // muzzle flash placement + decay
    const on = st.anim.fire > 0.55;
    flashMat.opacity = on ? 0.8 : Math.max(0, flashMat.opacity - dt * 12);
    flashLight.intensity = on ? 22 : Math.max(0, flashLight.intensity - dt * 300);
    if (on || flashMat.opacity > 0) {
      model.muzzle.getWorldPosition(tmpV);
      flashGroup.position.copy(tmpV);
      flashGroup.quaternion.copy(camera.quaternion);
      flashGroup.rotateZ(Math.random() * Math.PI);
      const s = (st.current === 'breacher' ? 0.7 : 0.42) * (0.85 + Math.random() * 0.3);
      flashGroup.scale.set(s, s, s);
    }
  }

  function muzzleWorld(out) {
    models[weapons.state.current].muzzle.getWorldPosition(out);
    return out;
  }

  // flash group lives in the scene (world space)
  return { update, muzzleWorld, flashGroup, rig };
}

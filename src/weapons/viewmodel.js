// Procedural first-person gun models + all viewmodel animation: sway, bob,
// recoil, reload dip, pump slide, weapon raise, ADS raise, sprint carry,
// machete swing. Built from primitives - silhouette and motion sell the gun.
//
// Pose model (round-2 rework): every frame composes ONE pose from smooth
// blend factors - hip <-> ads (from weapons.state.adsBlend) and a sprint
// blend eased here - instead of round 1's per-frame lerp fighting absolute
// assignments (which is what made the gun glitch while sprinting).

import * as THREE from 'three';
import { lerp, clamp } from '../core/noise.js';

const GUNMETAL = new THREE.MeshStandardMaterial({ color: 0x555d63, roughness: 0.5, metalness: 0.25 });
const POLYMER = new THREE.MeshStandardMaterial({ color: 0x4c544a, roughness: 0.9, metalness: 0.0 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x6e5232, roughness: 0.85 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0x2e3330, roughness: 0.6, metalness: 0.1 });
const BLADE = new THREE.MeshStandardMaterial({ color: 0xb8c4c8, roughness: 0.25, metalness: 0.7 });

// Alien hand materials
const ALIEN_SKIN = new THREE.MeshStandardMaterial({
  color: 0x3aa8a0, roughness: 0.6, metalness: 0.0,
  emissive: 0x0a4844, emissiveIntensity: 0.5
});
const ALIEN_KNUCKLE = new THREE.MeshStandardMaterial({ color: 0x1e4a48, roughness: 0.7 });
const ALIEN_CLAW = new THREE.MeshStandardMaterial({ color: 0x1e4a48, roughness: 0.6 });

const HIP = new THREE.Vector3(0.17, -0.16, -0.32);
const SPRINT_POS = new THREE.Vector3(0.04, -0.06, -0.03); // added at full sprint
const RIG_SCALE = 0.55;

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

function cone(rBase, len, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(rBase, len, 6), mat);
  m.position.set(x, y, z);
  return m;
}

function alienHand(mirror) {
  const hand = new THREE.Group();

  // Palm: box ~0.055 x 0.02 x 0.06, slightly offset for natural grip
  const palm = box(0.055, 0.02, 0.06, ALIEN_SKIN, 0, 0, 0);
  hand.add(palm);

  // Three fingers, each with 2 segments, angled inward as if wrapped around grip
  // Finger 1 (index) - outer
  const f1p1 = box(0.012, 0.012, 0.03, ALIEN_SKIN, 0.018, 0.008, -0.03);
  f1p1.rotation.z = -0.3; // angle inward
  hand.add(f1p1);
  const f1p2 = box(0.01, 0.01, 0.028, ALIEN_SKIN, 0.022, 0.012, -0.055);
  f1p2.rotation.z = -0.4;
  hand.add(f1p2);
  const f1claw = cone(0.006, 0.014, ALIEN_CLAW, 0.024, 0.014, -0.068);
  hand.add(f1claw);

  // Finger 2 (middle) - center
  const f2p1 = box(0.012, 0.012, 0.03, ALIEN_SKIN, 0, 0.012, -0.032);
  f2p1.rotation.z = -0.15;
  hand.add(f2p1);
  const f2p2 = box(0.01, 0.01, 0.03, ALIEN_SKIN, 0, 0.016, -0.06);
  f2p2.rotation.z = -0.25;
  hand.add(f2p2);
  const f2claw = cone(0.006, 0.014, ALIEN_CLAW, 0, 0.018, -0.074);
  hand.add(f2claw);

  // Finger 3 (ring) - outer
  const f3p1 = box(0.012, 0.012, 0.03, ALIEN_SKIN, -0.018, 0.008, -0.03);
  f3p1.rotation.z = 0.3; // angle inward
  hand.add(f3p1);
  const f3p2 = box(0.01, 0.01, 0.028, ALIEN_SKIN, -0.022, 0.012, -0.055);
  f3p2.rotation.z = 0.4;
  hand.add(f3p2);
  const f3claw = cone(0.006, 0.014, ALIEN_CLAW, -0.024, 0.014, -0.068);
  hand.add(f3claw);

  // Thumb (opposing) - 2 segments
  const thumbp1 = box(0.01, 0.01, 0.025, ALIEN_SKIN, 0.028, -0.005, -0.012);
  thumbp1.rotation.z = 0.8;
  hand.add(thumbp1);
  const thumbp2 = box(0.009, 0.009, 0.024, ALIEN_SKIN, 0.035, -0.008, -0.032);
  thumbp2.rotation.z = 1.0;
  hand.add(thumbp2);
  const thumbClaw = cone(0.005, 0.013, ALIEN_CLAW, 0.038, -0.009, -0.044);
  hand.add(thumbClaw);

  // Forearm: tapered cylinder from wrist back toward camera's shoulder line
  // Positioned to angle from the wrist back to the bottom-right/left
  const forearmLen = 0.16;
  const forearm = cyl(0.028, 0.021, forearmLen, ALIEN_SKIN, 0, -0.008, 0.08, 0);
  forearm.rotation.x = 0.25; // angle back toward camera
  if (mirror) forearm.rotation.y = Math.PI * 0.15; // slight outward angle for natural pose
  hand.add(forearm);

  // Wrist band: thin glowing torus
  const wristBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.018, 0.004, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x1a7a76, emissive: 0x0a9a96, emissiveIntensity: 0.8 })
  );
  wristBand.rotation.x = Math.PI / 2;
  wristBand.position.set(0, -0.010, 0.15);
  hand.add(wristBand);

  // Mirror geometry if needed
  if (mirror) {
    hand.scale.x = -1;
  }

  return hand;
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
  // Front sight + riser
  g.add(box(0.012, 0.03, 0.012, ACCENT, 0, 0.055, -0.36));     // front sight
  g.add(box(0.015, 0.008, 0.025, ACCENT, 0, 0.029, -0.36));    // front sight riser (bridges to handguard)
  // Rear sight block + riser
  g.add(box(0.03, 0.028, 0.05, ACCENT, 0, 0.055, 0.05));       // rear sight block
  g.add(box(0.03, 0.008, 0.05, ACCENT, 0, 0.039, 0.05));       // rear sight riser (bridges to receiver)
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.005, -0.61);
  g.add(muzzle);

  // Add alien hands
  const rightHand = alienHand(false);
  rightHand.position.set(0, -0.10, 0.02);
  rightHand.rotation.z = 0.35; // match grip rotation
  g.add(rightHand);
  const leftHand = alienHand(true);
  leftHand.position.set(0, -0.035, -0.28);
  leftHand.rotation.x = 0.3;
  g.add(leftHand);

  // ADS: rear sight notch to camera centre (sight top ~y 0.07 local),
  // held far enough out that the receiver doesn't swallow the view
  return { group: g, muzzle, pump: null, adsPos: new THREE.Vector3(0, -0.047, -0.3) };
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

  // Add alien hands
  const rightHand = alienHand(false);
  rightHand.position.set(0, -0.09, 0.09);
  rightHand.rotation.z = 0.5;
  g.add(rightHand);
  // Left hand ATTACHED TO PUMP MESH - money detail, animates with pump
  const leftHand = alienHand(true);
  leftHand.position.set(0, -0.035, -0.15);
  leftHand.rotation.x = 0.4;
  pump.add(leftHand);

  return { group: g, muzzle, pump, adsPos: new THREE.Vector3(0, -0.046, -0.33) };
}

function buildLongarm() {
  const g = new THREE.Group();
  g.add(box(0.05, 0.075, 0.36, WOOD, 0, 0, 0.02));             // full stock body
  g.add(cyl(0.013, 0.013, 0.52, GUNMETAL, 0, 0.012, -0.5));    // long barrel
  g.add(cyl(0.02, 0.02, 0.05, ACCENT, 0, 0.012, -0.775));      // muzzle
  g.add(box(0.04, 0.13, 0.05, WOOD, 0, -0.1, 0.1));            // grip
  g.children[3].rotation.x = 0.4;
  g.add(box(0.05, 0.07, 0.16, WOOD, 0, 0.004, 0.28));          // butt
  g.add(box(0.036, 0.1, 0.05, GUNMETAL, 0, -0.09, -0.06));     // magazine
  // scope: tube + objective + eyepiece, sitting high on the receiver
  g.add(cyl(0.021, 0.021, 0.16, GUNMETAL, 0, 0.078, -0.05));
  g.add(cyl(0.026, 0.026, 0.03, ACCENT, 0, 0.078, -0.14));
  g.add(cyl(0.024, 0.024, 0.025, ACCENT, 0, 0.078, 0.04));
  // aperture ring the player actually aims through
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 14), ACCENT);
  ring.position.set(0, 0.078, 0.055);
  g.add(ring);

  // Scope mount blocks (bridging scope to receiver top)
  g.add(box(0.016, 0.045, 0.02, GUNMETAL, 0, 0.056, -0.10));  // rear mount
  g.add(box(0.016, 0.045, 0.02, GUNMETAL, 0, 0.056, 0.0));    // front mount

  // Forend collar (bridging stock front to barrel)
  g.add(cyl(0.02, 0.02, 0.1, WOOD, 0, 0.004, -0.20, Math.PI / 2));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.81);
  g.add(muzzle);

  // Add alien hands
  const rightHand = alienHand(false);
  rightHand.position.set(0, -0.10, 0.10);
  rightHand.rotation.z = 0.4;
  g.add(rightHand);
  const leftHand = alienHand(true);
  leftHand.position.set(0, -0.045, -0.18);
  leftHand.rotation.x = 0.35;
  g.add(leftHand);

  return { group: g, muzzle, pump: null, adsPos: new THREE.Vector3(0, -0.052, -0.27) };
}

function buildMachete() {
  const g = new THREE.Group();
  g.add(box(0.03, 0.09, 0.05, WOOD, 0, -0.05, 0.06));          // handle
  const blade = box(0.008, 0.055, 0.34, BLADE, 0, 0.01, -0.14);
  g.add(blade);
  const tip = box(0.008, 0.075, 0.09, BLADE, 0, 0.02, -0.3);
  g.add(tip);

  // Add alien right hand (no left for single-handed machete)
  const rightHand = alienHand(false);
  rightHand.position.set(0, -0.05, 0.06);
  g.add(rightHand);

  return { group: g, muzzle: null, pump: null, adsPos: null };
}

export function createViewmodel(camera, weapons, playerRef) {
  const rig = new THREE.Group();       // sway/bob/recoil applied here
  camera.add(rig);
  rig.position.copy(HIP);
  rig.scale.setScalar(RIG_SCALE);

  const models = {
    carbine: buildCarbine(),
    breacher: buildBreacher(),
    longarm: buildLongarm(),
  };
  const machete = buildMachete();

  function prepModel(model) {
    model.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        o.renderOrder = 999;           // draw over world
        o.material = o.material.clone();
        o.material.depthTest = true;
      }
    });
    rig.add(model.group);
    model.group.visible = false;
  }
  for (const key of Object.keys(models)) prepModel(models[key]);
  prepModel(machete);

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
  let sprintT = 0;
  const tmpV = new THREE.Vector3();
  const _pos = new THREE.Vector3();

  function update(intent, dt) {
    const st = weapons.state;
    const meleeing = st.meleeT > 0;
    // show active weapon (or the machete mid-swing). The LONGARM hands
    // the view to the HUD scope overlay at full ADS - you aim through
    // glass, not past a polygon eyepiece.
    const scoped = st.current === 'longarm' && st.adsBlend > 0.8;
    for (const key of Object.keys(models)) {
      models[key].group.visible = !meleeing && key === st.current && !(scoped && key === 'longarm');
    }
    machete.group.visible = meleeing;
    const model = models[st.current];
    const ads = st.adsBlend;

    // sprint blend eases in/out - the fix for the round-1 sprint glitch
    // (absolute pose writes fought a per-frame lerp; now ONE pose composer)
    const sprintTarget = playerRef.p.sprinting ? 1 : 0;
    sprintT += (sprintTarget - sprintT) * Math.min(1, dt * 8);
    const sprint = sprintT * (1 - ads);

    // look sway (lag behind mouse) - damped hard when aiming
    const swayScale = 1 - ads * 0.85;
    const targetSwayX = clamp(-intent.lookDX * 0.0012, -0.05, 0.05) * swayScale;
    const targetSwayY = clamp(intent.lookDY * 0.0012, -0.04, 0.04) * swayScale;
    swayX = lerp(swayX, targetSwayX, Math.min(1, dt * 10));
    swayY = lerp(swayY, targetSwayY, Math.min(1, dt * 10));

    // walk bob (phase shared with camera bob via player) - steadied by ADS
    const bobAmp = Math.min(1, playerRef.p.speedNow / 5.1)
      * (playerRef.p.sprinting ? 1.5 : 1) * (1 - ads * 0.85);
    const bx = Math.sin(playerRef.p.bobPhase) * 0.012 * bobAmp;
    const by = -Math.abs(Math.sin(playerRef.p.bobPhase * 2)) * 0.009 * bobAmp;

    // recoil: kick back + up, spring back
    recoilZ = lerp(recoilZ, 0, Math.min(1, dt * 12));
    if (st.anim.fire > 0.85) recoilZ = Math.min(0.09, recoilZ + (st.current === 'breacher' ? 0.07 : 0.028));

    // reload dip + weapon raise
    const reloadDip = st.anim.reloadPhase > 0 || st.reloading > 0 ? 1 : 0;
    const raise = st.anim.raise;

    // ---- compose the pose: hip <-> ads base, then additive layers ----
    const adsPos = model.adsPos || HIP;
    _pos.copy(HIP).lerp(adsPos, ads);
    rig.position.set(
      _pos.x + swayX + bx + SPRINT_POS.x * sprint,
      _pos.y + swayY + by + SPRINT_POS.y * sprint - reloadDip * 0.14 - raise * 0.22,
      _pos.z + recoilZ * 0.6 + SPRINT_POS.z * sprint
    );
    rig.rotation.z = swayX * 1.4 - reloadDip * 0.5 - raise * 0.4 + 0.32 * sprint;
    rig.rotation.x = swayY * 2 + recoilZ * 1.6 - reloadDip * 0.35 + 0.5 * sprint;
    rig.rotation.y = 0;

    // machete swing: a diagonal slash across the view
    if (meleeing) {
      const t = 1 - st.meleeT / 0.34; // 0 -> 1 over the swing
      const arc = Math.sin(t * Math.PI);
      machete.group.position.set(0.12 - t * 0.3, -0.04 - arc * 0.05, -0.28);
      machete.group.rotation.set(-0.5 + arc * 1.1, 0.4 - t * 1.2, -0.4 + t * 1.0);
    }

    // pump slide
    if (model.pump) {
      const t = st.anim.pump;
      // slide back around t ~ [0.9 .. 0.4]
      const slide = t > 0.4 ? Math.sin((1 - t) * Math.PI * 1.6) : 0;
      model.pump.position.z = -0.3 + slide * 0.09;
    }

    // muzzle flash placement + decay
    const on = st.anim.fire > 0.55 && !meleeing;
    flashMat.opacity = on ? 0.8 : Math.max(0, flashMat.opacity - dt * 12);
    flashLight.intensity = on ? 22 : Math.max(0, flashLight.intensity - dt * 300);
    if ((on || flashMat.opacity > 0) && model.muzzle) {
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

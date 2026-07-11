// Procedural creature models. Distinct silhouettes carry readability:
// PROWLER - low fast quadruped, glowing eyes.
// SPITTER - hunched biped with luminous acid sacs (its tell and its weakness).
// JUGGERNAUT - huge shouldered hulk with a bone-pale face plate.
// Shared geometries/materials; each enemy gets its own group for animation.

import * as THREE from 'three';

const geoCache = {};
function G(key, make) {
  if (!geoCache[key]) geoCache[key] = make();
  return geoCache[key];
}

const MAT = {
  prowlerHide: new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.95 }),
  prowlerBelly: new THREE.MeshStandardMaterial({ color: 0x453c30, roughness: 0.95 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffd050, emissive: 0xff9820, emissiveIntensity: 2.8 }),
  spitterSkin: new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.9 }),
  sac: new THREE.MeshStandardMaterial({
    color: 0x86c832, emissive: 0x5a9e14, emissiveIntensity: 1.6, roughness: 0.4,
  }),
  juggHide: new THREE.MeshStandardMaterial({ color: 0x3d2820, roughness: 1 }),
  juggPlate: new THREE.MeshStandardMaterial({ color: 0xc9bfa8, roughness: 0.7 }),
  claw: new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.6 }),
};

function mesh(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// ---------- PROWLER (panther-like, 0.9m at shoulder) ----------
export function buildProwler() {
  const g = new THREE.Group();
  const body = mesh(G('prBody', () => {
    const b = new THREE.CapsuleGeometry(0.28, 0.85, 4, 8);
    b.rotateZ(Math.PI / 2);
    return b;
  }), MAT.prowlerHide, 0, 0.62, 0);
  g.add(body);

  const head = mesh(G('prHead', () => new THREE.BoxGeometry(0.3, 0.26, 0.38)), MAT.prowlerHide, 0, 0.74, -0.62);
  g.add(head);
  const jaw = mesh(G('prJaw', () => new THREE.BoxGeometry(0.24, 0.09, 0.3)), MAT.prowlerBelly, 0, 0.62, -0.66);
  g.add(jaw);
  const eyeL = mesh(G('prEye', () => new THREE.SphereGeometry(0.045, 6, 5)), MAT.eye, -0.09, 0.78, -0.78);
  const eyeR = mesh(G('prEye', () => new THREE.SphereGeometry(0.045, 6, 5)), MAT.eye, 0.09, 0.78, -0.78);
  eyeL.castShadow = false;
  eyeR.castShadow = false;
  g.add(eyeL, eyeR);

  const legGeo = G('prLeg', () => {
    const l = new THREE.CylinderGeometry(0.055, 0.04, 0.62, 6);
    l.translate(0, -0.31, 0);
    return l;
  });
  const legs = [];
  for (const [x, z] of [[-0.18, -0.38], [0.18, -0.38], [-0.18, 0.38], [0.18, 0.38]]) {
    const leg = mesh(legGeo, MAT.prowlerHide, x, 0.62, z);
    legs.push(leg);
    g.add(leg);
  }
  const tail = mesh(G('prTail', () => {
    const t = new THREE.CylinderGeometry(0.02, 0.045, 0.7, 5);
    t.rotateX(1.15);
    t.translate(0, 0.12, 0.42);
    return t;
  }), MAT.prowlerHide, 0, 0.66, 0.5);
  g.add(tail);

  return {
    group: g,
    refs: { body, head, legs, jaw, eyes: [eyeL, eyeR] },
    headOffset: new THREE.Vector3(0, 0.74, -0.7),
    bodyOffset: new THREE.Vector3(0, 0.62, 0),
    headR: 0.24,
    bodyR: 0.52,
  };
}

// ---------- SPITTER (hunched biped, 1.7m) ----------
export function buildSpitter() {
  const g = new THREE.Group();
  const torso = mesh(G('spTorso', () => {
    const t = new THREE.CapsuleGeometry(0.3, 0.55, 4, 8);
    t.rotateX(0.55);
    return t;
  }), MAT.spitterSkin, 0, 1.05, 0.05);
  g.add(torso);

  const head = mesh(G('spHead', () => {
    const h = new THREE.SphereGeometry(0.21, 8, 6);
    h.scale(1, 0.85, 1.25);
    return h;
  }), MAT.spitterSkin, 0, 1.38, -0.32);
  g.add(head);
  const eyeL = mesh(G('spEye', () => new THREE.SphereGeometry(0.04, 6, 5)), MAT.eye, -0.1, 1.44, -0.46);
  const eyeR = mesh(G('spEye', () => new THREE.SphereGeometry(0.04, 6, 5)), MAT.eye, 0.1, 1.44, -0.46);
  eyeL.castShadow = false;
  eyeR.castShadow = false;
  g.add(eyeL, eyeR);

  // glowing acid sacs on the back - brighten before it spits
  const sacGeo = G('spSac', () => new THREE.SphereGeometry(0.16, 8, 6));
  const sacs = [];
  for (const [x, y, z, s] of [[-0.14, 1.3, 0.3, 1], [0.16, 1.18, 0.34, 0.85], [0, 1.0, 0.4, 1.15]]) {
    const sac = new THREE.Mesh(sacGeo, MAT.sac.clone());
    sac.position.set(x, y, z);
    sac.scale.setScalar(s);
    sac.castShadow = false;
    sacs.push(sac);
    g.add(sac);
  }

  const legGeo = G('spLeg', () => {
    const l = new THREE.CylinderGeometry(0.07, 0.05, 0.85, 6);
    l.translate(0, -0.425, 0);
    return l;
  });
  const legs = [];
  for (const x of [-0.16, 0.16]) {
    const leg = mesh(legGeo, MAT.spitterSkin, x, 0.85, 0.1);
    legs.push(leg);
    g.add(leg);
  }
  const armGeo = G('spArm', () => {
    const a = new THREE.CylinderGeometry(0.045, 0.035, 0.6, 5);
    a.translate(0, -0.3, 0);
    return a;
  });
  const arms = [];
  for (const x of [-0.32, 0.32]) {
    const arm = mesh(armGeo, MAT.spitterSkin, x, 1.2, -0.05);
    arm.rotation.z = x > 0 ? -0.35 : 0.35;
    arm.rotation.x = -0.5;
    arms.push(arm);
    g.add(arm);
  }

  return {
    group: g,
    refs: { torso, head, legs, arms, sacs },
    headOffset: new THREE.Vector3(0, 1.38, -0.32),
    bodyOffset: new THREE.Vector3(0, 1.05, 0.05),
    headR: 0.26,
    bodyR: 0.5,
  };
}

// ---------- JUGGERNAUT (2.6m shouldered hulk) ----------
export function buildJuggernaut() {
  const g = new THREE.Group();
  const torso = mesh(G('juTorso', () => {
    const t = new THREE.CapsuleGeometry(0.62, 0.7, 4, 10);
    t.scale(1.25, 1, 0.9);
    return t;
  }), MAT.juggHide, 0, 1.55, 0);
  g.add(torso);

  const shoulderGeo = G('juShoulder', () => new THREE.SphereGeometry(0.42, 8, 6));
  const shL = mesh(shoulderGeo, MAT.juggHide, -0.72, 1.95, 0);
  const shR = mesh(shoulderGeo, MAT.juggHide, 0.72, 1.95, 0);
  g.add(shL, shR);

  const head = mesh(G('juHead', () => {
    const h = new THREE.BoxGeometry(0.42, 0.45, 0.42);
    return h;
  }), MAT.juggHide, 0, 2.28, -0.18);
  g.add(head);
  // bone face plate - pale, reads at range through fog
  const plate = mesh(G('juPlate', () => new THREE.BoxGeometry(0.36, 0.36, 0.08)), MAT.juggPlate, 0, 2.28, -0.42);
  g.add(plate);
  const eyeL = mesh(G('juEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.eye, -0.1, 2.33, -0.47);
  const eyeR = mesh(G('juEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.eye, 0.1, 2.33, -0.47);
  eyeL.castShadow = false;
  eyeR.castShadow = false;
  g.add(eyeL, eyeR);

  const armGeo = G('juArm', () => {
    const a = new THREE.CylinderGeometry(0.19, 0.24, 1.5, 7);
    a.translate(0, -0.75, 0);
    return a;
  });
  const arms = [];
  for (const x of [-0.82, 0.82]) {
    const arm = mesh(armGeo, MAT.juggHide, x, 1.9, 0);
    arms.push(arm);
    g.add(arm);
  }
  const clawGeo = G('juClaw', () => new THREE.ConeGeometry(0.09, 0.3, 5));
  for (const arm of arms) {
    for (let i = 0; i < 3; i++) {
      const claw = mesh(clawGeo, MAT.claw, (i - 1) * 0.12, -1.6, -0.08);
      claw.rotation.x = Math.PI;
      arm.add(claw);
    }
  }

  const legGeo = G('juLeg', () => {
    const l = new THREE.CylinderGeometry(0.24, 0.19, 1.1, 7);
    l.translate(0, -0.55, 0);
    return l;
  });
  const legs = [];
  for (const x of [-0.35, 0.35]) {
    const leg = mesh(legGeo, MAT.juggHide, x, 1.1, 0.05);
    legs.push(leg);
    g.add(leg);
  }

  return {
    group: g,
    refs: { torso, head, legs, arms, plate },
    headOffset: new THREE.Vector3(0, 2.28, -0.25),
    bodyOffset: new THREE.Vector3(0, 1.55, 0),
    headR: 0.34,
    bodyR: 1.05,
  };
}

export const BUILDERS = {
  prowler: buildProwler,
  spitter: buildSpitter,
  juggernaut: buildJuggernaut,
};

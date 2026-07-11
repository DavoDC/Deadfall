// Procedural creature models - the fauna of a vibrant Amazonian fever-dream.
// Fantastical over realistic (locked art direction), but silhouettes and
// glowing tells stay readable through fog:
//
// PROWLER     - indigo shadow-cat, coral warpaint stripes, ember eyes.
// SPITTER     - toxic frog-thing; luminous acid sacs are its tell AND its
//               weakpoint, and it visibly SWELLS as it enrages under fire.
// JUGGERNAUT  - moss-backed titan wearing orchids; bone face plate deflects
//               (shots to the skull are wasted) - the glowing amber boil on
//               its BACK is the kill. Bait the charge, punish the pass.
// STINGERWING - fist-sized wasp of cyan glass; harmless alone, a blizzard
//               in a swarm.
// CANOPY SHRIKE - magenta gibbon-wraith that lives in the leap; only ever
//               dangerous while airborne, gawky and slow on the ground.
// BLOOMCALLER - a walking orchid that screams the jungle down on you. Its
//               core is exposed only while the petals are open.
//
// Shared geometries/materials; each enemy gets its own group for animation.
// Model contract: { group, refs, headOffset, bodyOffset, headR, bodyR,
//   headMultScale?, crits?: [{ off, r, mult, when? }] }.

import * as THREE from 'three';

const geoCache = {};
function G(key, make) {
  if (!geoCache[key]) geoCache[key] = make();
  return geoCache[key];
}

const MAT = {
  // prowler: deep iridescent indigo + coral stripes
  prowlerHide: new THREE.MeshStandardMaterial({ color: 0x2a2557, roughness: 0.7, metalness: 0.15 }),
  prowlerStripe: new THREE.MeshStandardMaterial({
    color: 0xff6a5e, emissive: 0xd23a30, emissiveIntensity: 0.9, roughness: 0.6,
  }),
  emberEye: new THREE.MeshStandardMaterial({ color: 0xffd050, emissive: 0xff7810, emissiveIntensity: 3.2 }),
  // spitter: poison-frog teal/orange
  spitterSkin: new THREE.MeshStandardMaterial({ color: 0x1b7a6e, roughness: 0.55 }),
  spitterBelly: new THREE.MeshStandardMaterial({ color: 0xe8813a, roughness: 0.7 }),
  sac: new THREE.MeshStandardMaterial({
    color: 0xa8e838, emissive: 0x7ac414, emissiveIntensity: 1.6, roughness: 0.35,
  }),
  // juggernaut: mossy titan + orchid growths + amber boil
  juggHide: new THREE.MeshStandardMaterial({ color: 0x3c4a2c, roughness: 1 }),
  juggMoss: new THREE.MeshStandardMaterial({ color: 0x4f7a38, roughness: 1 }),
  juggPlate: new THREE.MeshStandardMaterial({ color: 0xd8cdb2, roughness: 0.6 }),
  juggBoil: new THREE.MeshStandardMaterial({
    color: 0xffb028, emissive: 0xff8c0a, emissiveIntensity: 2.6, roughness: 0.3,
  }),
  orchid: new THREE.MeshStandardMaterial({
    color: 0xe84fa0, emissive: 0xa02468, emissiveIntensity: 0.5, roughness: 0.6, side: THREE.DoubleSide,
  }),
  claw: new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.6 }),
  // stingerwing: cyan glass + hot abdomen
  wingBody: new THREE.MeshStandardMaterial({
    color: 0x18c8d8, emissive: 0x0a8898, emissiveIntensity: 1.4, roughness: 0.35,
  }),
  wingAbdomen: new THREE.MeshStandardMaterial({
    color: 0xff4fd8, emissive: 0xd018a8, emissiveIntensity: 2.2, roughness: 0.3,
  }),
  wingWing: new THREE.MeshStandardMaterial({
    color: 0xbafcff, transparent: true, opacity: 0.55, roughness: 0.2,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  // shrike: magenta wraith
  shrikeFur: new THREE.MeshStandardMaterial({ color: 0x571a4e, roughness: 0.85 }),
  shrikeChest: new THREE.MeshStandardMaterial({ color: 0xd84a9a, roughness: 0.7 }),
  shrikeStripe: new THREE.MeshStandardMaterial({
    color: 0x64f0c8, emissive: 0x2ac89a, emissiveIntensity: 2.4, roughness: 0.4,
  }),
  // bloomcaller: living orchid
  bloomStalk: new THREE.MeshStandardMaterial({ color: 0x2e6a34, roughness: 0.9 }),
  bloomPetal: new THREE.MeshStandardMaterial({
    color: 0xff7ac8, emissive: 0xc03a88, emissiveIntensity: 0.7, roughness: 0.6, side: THREE.DoubleSide,
  }),
  bloomCore: new THREE.MeshStandardMaterial({
    color: 0xffe258, emissive: 0xffb818, emissiveIntensity: 2.8, roughness: 0.3,
  }),
};

function mesh(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Two-segment leg: thigh pivots at hip, shin hangs from knee. Animate the
// hip (rotation.x) and the knee counter-bends in enemies.animate - real
// limbs, not stilts (round-1 feedback: "not proper legs").
function twoSegLeg(matA, matB, thighLen, shinLen, r) {
  const hip = new THREE.Group();
  const thigh = mesh(G(`thigh${thighLen}${r}`, () => {
    const g = new THREE.CylinderGeometry(r, r * 0.8, thighLen, 6);
    g.translate(0, -thighLen / 2, 0);
    return g;
  }), matA, 0, 0, 0);
  hip.add(thigh);
  const knee = new THREE.Group();
  knee.position.y = -thighLen;
  const shin = mesh(G(`shin${shinLen}${r}`, () => {
    const g = new THREE.CylinderGeometry(r * 0.75, r * 0.5, shinLen, 6);
    g.translate(0, -shinLen / 2, 0);
    return g;
  }), matB, 0, 0, 0);
  knee.add(shin);
  hip.add(knee);
  return { hip, knee };
}

// ---------- PROWLER (shadow-cat, 0.9m at shoulder) ----------
export function buildProwler() {
  const g = new THREE.Group();
  const body = mesh(G('prBody', () => {
    const b = new THREE.CapsuleGeometry(0.28, 0.85, 4, 8);
    b.rotateZ(Math.PI / 2);
    return b;
  }), MAT.prowlerHide, 0, 0.62, 0);
  g.add(body);

  // coral warpaint stripes across the flank
  for (const [z, s] of [[-0.25, 0.8], [0.02, 1], [0.28, 0.85]]) {
    const stripe = mesh(G('prStripe', () => new THREE.TorusGeometry(0.29, 0.022, 5, 10, Math.PI * 1.3)), MAT.prowlerStripe, 0, 0.62, z);
    stripe.rotation.set(0, Math.PI / 2, Math.PI * 0.85);
    stripe.scale.setScalar(s);
    stripe.castShadow = false;
    g.add(stripe);
  }

  const head = mesh(G('prHead', () => new THREE.BoxGeometry(0.3, 0.26, 0.38)), MAT.prowlerHide, 0, 0.74, -0.62);
  g.add(head);
  const jaw = mesh(G('prJaw', () => new THREE.BoxGeometry(0.24, 0.09, 0.3)), MAT.prowlerStripe, 0, 0.62, -0.66);
  g.add(jaw);
  const eyeL = mesh(G('prEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.emberEye, -0.09, 0.78, -0.78);
  const eyeR = mesh(G('prEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.emberEye, 0.09, 0.78, -0.78);
  eyeL.castShadow = false;
  eyeR.castShadow = false;
  g.add(eyeL, eyeR);

  const legs = [];
  const knees = [];
  for (const [x, z] of [[-0.18, -0.38], [0.18, -0.38], [-0.18, 0.38], [0.18, 0.38]]) {
    const { hip, knee } = twoSegLeg(MAT.prowlerHide, MAT.prowlerHide, 0.34, 0.32, 0.055);
    hip.position.set(x, 0.62, z);
    knee.rotation.x = 0.35;
    legs.push(hip);
    knees.push(knee);
    g.add(hip);
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
    refs: { body, head, legs, knees, jaw, eyes: [eyeL, eyeR] },
    headOffset: new THREE.Vector3(0, 0.74, -0.7),
    bodyOffset: new THREE.Vector3(0, 0.62, 0),
    headR: 0.24,
    bodyR: 0.52,
  };
}

// ---------- SPITTER (toxic frog-thing, 1.7m) ----------
export function buildSpitter() {
  const g = new THREE.Group();
  const torso = mesh(G('spTorso', () => {
    const t = new THREE.CapsuleGeometry(0.3, 0.55, 4, 8);
    t.rotateX(0.55);
    return t;
  }), MAT.spitterSkin, 0, 1.05, 0.05);
  g.add(torso);
  const belly = mesh(G('spBelly', () => {
    const t = new THREE.CapsuleGeometry(0.24, 0.4, 4, 8);
    t.rotateX(0.55);
    return t;
  }), MAT.spitterBelly, 0, 0.98, -0.08);
  belly.castShadow = false;
  g.add(belly);

  const head = mesh(G('spHead', () => {
    const h = new THREE.SphereGeometry(0.21, 8, 6);
    h.scale(1, 0.85, 1.25);
    return h;
  }), MAT.spitterSkin, 0, 1.38, -0.32);
  g.add(head);
  const eyeL = mesh(G('spEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.emberEye, -0.1, 1.46, -0.4);
  const eyeR = mesh(G('spEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.emberEye, 0.1, 1.46, -0.4);
  eyeL.castShadow = false;
  eyeR.castShadow = false;
  g.add(eyeL, eyeR);

  // glowing acid sacs on the back - the tell (brighten before it spits),
  // the weakpoint (crit), and the rage gauge (swell as it takes fire)
  const sacGeo = G('spSac', () => new THREE.SphereGeometry(0.16, 8, 6));
  const sacs = [];
  for (const [x, y, z, s] of [[-0.14, 1.3, 0.3, 1], [0.16, 1.18, 0.34, 0.85], [0, 1.0, 0.4, 1.15]]) {
    const sac = new THREE.Mesh(sacGeo, MAT.sac.clone());
    sac.position.set(x, y, z);
    sac.scale.setScalar(s);
    sac.userData.baseScale = s;
    sac.castShadow = false;
    sacs.push(sac);
    g.add(sac);
  }

  const legs = [];
  const knees = [];
  for (const x of [-0.16, 0.16]) {
    const { hip, knee } = twoSegLeg(MAT.spitterSkin, MAT.spitterSkin, 0.45, 0.42, 0.065);
    hip.position.set(x, 0.85, 0.1);
    knee.rotation.x = 0.4;
    legs.push(hip);
    knees.push(knee);
    g.add(hip);
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
    refs: { torso, head, legs, knees, arms, sacs },
    headOffset: new THREE.Vector3(0, 1.38, -0.32),
    bodyOffset: new THREE.Vector3(0, 1.05, 0.05),
    headR: 0.26,
    bodyR: 0.5,
    crits: [{ off: new THREE.Vector3(0, 1.16, 0.36), r: 0.3, mult: 2.3 }],
  };
}

// ---------- JUGGERNAUT (moss titan, 2.6m) ----------
export function buildJuggernaut() {
  const g = new THREE.Group();
  const torso = mesh(G('juTorso', () => {
    const t = new THREE.CapsuleGeometry(0.62, 0.7, 4, 10);
    t.scale(1.25, 1, 0.9);
    return t;
  }), MAT.juggHide, 0, 1.55, 0);
  g.add(torso);
  // moss mantle over the shoulders
  const mantle = mesh(G('juMantle', () => {
    const t = new THREE.SphereGeometry(0.78, 8, 6);
    t.scale(1.35, 0.55, 1);
    return t;
  }), MAT.juggMoss, 0, 2.0, 0.08);
  g.add(mantle);

  const shoulderGeo = G('juShoulder', () => new THREE.SphereGeometry(0.42, 8, 6));
  const shL = mesh(shoulderGeo, MAT.juggMoss, -0.72, 1.95, 0);
  const shR = mesh(shoulderGeo, MAT.juggMoss, 0.72, 1.95, 0);
  g.add(shL, shR);

  // orchid growths - the fever-dream flourish
  const petalGeo = G('juPetal', () => {
    const p = new THREE.ConeGeometry(0.09, 0.34, 5);
    p.translate(0, 0.17, 0);
    return p;
  });
  for (const [sx, sy, sz] of [[-0.72, 2.2, 0], [0.72, 2.2, 0.1], [-0.3, 2.25, 0.25]]) {
    for (let i = 0; i < 5; i++) {
      const petal = new THREE.Mesh(petalGeo, MAT.orchid);
      petal.position.set(sx, sy, sz);
      petal.rotation.set(0.85, (i / 5) * Math.PI * 2, 0);
      petal.rotateX(-0.5);
      petal.castShadow = false;
      g.add(petal);
    }
  }

  const head = mesh(G('juHead', () => new THREE.BoxGeometry(0.42, 0.45, 0.42)), MAT.juggHide, 0, 2.28, -0.18);
  g.add(head);
  // bone face plate - pale, reads at range through fog. It DEFLECTS:
  // headshots on the juggernaut are mostly wasted (headMultScale below)
  const plate = mesh(G('juPlate', () => new THREE.BoxGeometry(0.36, 0.36, 0.08)), MAT.juggPlate, 0, 2.28, -0.42);
  g.add(plate);
  const eyeL = mesh(G('juEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.emberEye, -0.1, 2.33, -0.47);
  const eyeR = mesh(G('juEye', () => new THREE.SphereGeometry(0.05, 6, 5)), MAT.emberEye, 0.1, 2.33, -0.47);
  eyeL.castShadow = false;
  eyeR.castShadow = false;
  g.add(eyeL, eyeR);

  // the amber boil on its back - the real weakpoint. Bait the charge,
  // shoot the pass.
  const boil = mesh(G('juBoil', () => new THREE.SphereGeometry(0.26, 8, 6)), MAT.juggBoil, 0, 1.72, 0.62);
  boil.castShadow = false;
  g.add(boil);

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

  const legs = [];
  for (const x of [-0.35, 0.35]) {
    const leg = mesh(G('juLeg', () => {
      const l = new THREE.CylinderGeometry(0.24, 0.19, 1.1, 7);
      l.translate(0, -0.55, 0);
      return l;
    }), MAT.juggHide, x, 1.1, 0.05);
    legs.push(leg);
    g.add(leg);
  }

  return {
    group: g,
    refs: { torso, head, legs, arms, plate, boil },
    headOffset: new THREE.Vector3(0, 2.28, -0.25),
    bodyOffset: new THREE.Vector3(0, 1.55, 0),
    headR: 0.34,
    bodyR: 1.05,
    headMultScale: 0.45, // the plate deflects - stop shooting the skull
    crits: [{ off: new THREE.Vector3(0, 1.72, 0.62), r: 0.34, mult: 2.6 }],
  };
}

// ---------- STINGERWING (glass wasp, 0.4m) ----------
export function buildStingerwing() {
  const g = new THREE.Group();
  const body = mesh(G('swBody', () => {
    const b = new THREE.CapsuleGeometry(0.09, 0.2, 3, 6);
    b.rotateX(Math.PI / 2);
    return b;
  }), MAT.wingBody, 0, 0, 0);
  g.add(body);
  const abdomen = mesh(G('swAbd', () => new THREE.SphereGeometry(0.11, 6, 5)), MAT.wingAbdomen, 0, -0.02, 0.2);
  abdomen.castShadow = false;
  g.add(abdomen);
  const stinger = mesh(G('swSting', () => new THREE.ConeGeometry(0.035, 0.16, 5)), MAT.claw, 0, -0.03, 0.34);
  stinger.rotation.x = Math.PI / 2;
  g.add(stinger);
  const wings = [];
  const wingGeo = G('swWing', () => {
    const w = new THREE.PlaneGeometry(0.34, 0.12);
    w.translate(0.17, 0, 0);
    return w;
  });
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, MAT.wingWing);
    wing.position.set(s * 0.06, 0.06, -0.02);
    wing.scale.x = s;
    wing.castShadow = false;
    wings.push(wing);
    g.add(wing);
  }
  return {
    group: g,
    refs: { body, wings },
    headOffset: new THREE.Vector3(0, 0, -0.18),
    bodyOffset: new THREE.Vector3(0, 0, 0.02),
    headR: 0.12,
    bodyR: 0.22,
  };
}

// ---------- CANOPY SHRIKE (leaping wraith, 1.4m crouched) ----------
export function buildShrike() {
  const g = new THREE.Group();
  const torso = mesh(G('shTorso', () => {
    const t = new THREE.CapsuleGeometry(0.22, 0.5, 4, 8);
    t.rotateX(0.35);
    return t;
  }), MAT.shrikeFur, 0, 0.95, 0);
  g.add(torso);
  const chest = mesh(G('shChest', () => new THREE.SphereGeometry(0.19, 7, 6)), MAT.shrikeChest, 0, 1.0, -0.14);
  chest.castShadow = false;
  g.add(chest);
  const head = mesh(G('shHead', () => {
    const h = new THREE.SphereGeometry(0.16, 8, 6);
    h.scale(1, 1.1, 1);
    return h;
  }), MAT.shrikeFur, 0, 1.32, -0.12);
  g.add(head);
  // glowing eye stripe - the airborne streak you track through the trees
  const stripe = mesh(G('shStripe', () => new THREE.BoxGeometry(0.3, 0.05, 0.1)), MAT.shrikeStripe, 0, 1.34, -0.24);
  stripe.castShadow = false;
  g.add(stripe);

  // long two-segment arms - it swings, you duck
  const arms = [];
  const elbows = [];
  for (const x of [-0.28, 0.28]) {
    const { hip: shoulder, knee: elbow } = twoSegLeg(MAT.shrikeFur, MAT.shrikeFur, 0.5, 0.55, 0.05);
    shoulder.position.set(x, 1.18, 0);
    shoulder.rotation.z = x > 0 ? -0.5 : 0.5;
    elbow.rotation.x = -0.4;
    arms.push(shoulder);
    elbows.push(elbow);
    g.add(shoulder);
  }
  const legs = [];
  const knees = [];
  for (const x of [-0.13, 0.13]) {
    const { hip, knee } = twoSegLeg(MAT.shrikeFur, MAT.shrikeFur, 0.38, 0.4, 0.055);
    hip.position.set(x, 0.72, 0.06);
    hip.rotation.x = -0.7;
    knee.rotation.x = 1.2;
    legs.push(hip);
    knees.push(knee);
    g.add(hip);
  }
  const tail = mesh(G('shTail', () => {
    const t = new THREE.CylinderGeometry(0.018, 0.04, 0.85, 5);
    t.rotateX(1.3);
    t.translate(0, 0.1, 0.5);
    return t;
  }), MAT.shrikeFur, 0, 0.9, 0.3);
  g.add(tail);

  return {
    group: g,
    refs: { torso, head, arms, elbows, legs, knees, stripe },
    headOffset: new THREE.Vector3(0, 1.32, -0.12),
    bodyOffset: new THREE.Vector3(0, 0.98, 0),
    headR: 0.22,
    bodyR: 0.42,
  };
}

// ---------- BLOOMCALLER (walking orchid, 2.2m) ----------
export function buildBloomcaller() {
  const g = new THREE.Group();
  const stalk = mesh(G('blStalk', () => {
    const s = new THREE.CylinderGeometry(0.16, 0.3, 1.5, 7);
    s.translate(0, 0.75, 0);
    return s;
  }), MAT.bloomStalk, 0, 0.3, 0);
  g.add(stalk);

  // bulb head with a ring of petals that OPEN when it calls
  const bulb = mesh(G('blBulb', () => new THREE.SphereGeometry(0.34, 8, 7)), MAT.bloomStalk, 0, 2.0, 0);
  g.add(bulb);
  const core = mesh(G('blCore', () => new THREE.SphereGeometry(0.2, 8, 6)), MAT.bloomCore, 0, 2.05, -0.12);
  core.castShadow = false;
  g.add(core);
  const petals = [];
  const petalGeo = G('blPetal', () => {
    const p = new THREE.PlaneGeometry(0.3, 0.62, 1, 2);
    const pos = p.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.sin((y + 0.31) / 0.62 * Math.PI) * 0.12);
    }
    p.translate(0, 0.31, 0);
    return p;
  });
  for (let i = 0; i < 7; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.95, 0);
    pivot.rotation.y = (i / 7) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, MAT.bloomPetal);
    petal.position.set(0, 0, 0.2);
    petal.rotation.x = 0.25; // closed: petals hug the bulb
    petal.castShadow = false;
    pivot.add(petal);
    petals.push(petal);
    g.add(pivot);
  }

  // vine arms + stumpy root legs
  for (const x of [-0.4, 0.4]) {
    const vine = mesh(G('blVine', () => {
      const v = new THREE.CylinderGeometry(0.045, 0.02, 1.1, 5);
      v.translate(0, -0.55, 0);
      return v;
    }), MAT.bloomStalk, x, 1.6, 0.05);
    vine.rotation.z = x > 0 ? -0.6 : 0.6;
    vine.rotation.x = 0.3;
    g.add(vine);
  }
  const legs = [];
  for (const [x, z] of [[-0.2, -0.08], [0.2, -0.08], [0, 0.18]]) {
    const leg = mesh(G('blLeg', () => {
      const l = new THREE.CylinderGeometry(0.09, 0.05, 0.5, 5);
      l.translate(0, -0.25, 0);
      return l;
    }), MAT.bloomStalk, x, 0.42, z);
    legs.push(leg);
    g.add(leg);
  }

  return {
    group: g,
    refs: { stalk, bulb, core, petals, legs },
    headOffset: new THREE.Vector3(0, 2.0, 0),
    bodyOffset: new THREE.Vector3(0, 1.1, 0),
    headR: 0.4,
    bodyR: 0.5,
    // the core is only exposed while it blooms (petals open); it protrudes
    // past the bulb so a centred shot hits the crit, not the 'head'
    crits: [{ off: new THREE.Vector3(0, 2.05, -0.2), r: 0.3, mult: 3.0, when: 'bloom' }],
  };
}

export const BUILDERS = {
  prowler: buildProwler,
  spitter: buildSpitter,
  juggernaut: buildJuggernaut,
  stingerwing: buildStingerwing,
  shrike: buildShrike,
  bloomcaller: buildBloomcaller,
};

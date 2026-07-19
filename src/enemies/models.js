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
import { dapplify } from '../world/dapple.js';

const geoCache = {};
function G(key, make) {
  if (!geoCache[key]) geoCache[key] = make();
  return geoCache[key];
}

const MAT = {
  // prowler: deep iridescent indigo + coral stripes
  prowlerHide: new THREE.MeshStandardMaterial({ color: 0x37306e, roughness: 0.7, metalness: 0.15 }),
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
  // chest self-glow + hotter stripe (round 4): the dark wraith was the one
  // archetype whose contrast DROPPED under dappled light in the violet
  // mood (N=12 probe: 22.9 -> 13.9) - shafts brighten the foliage ring
  // around it while the near-black fur stays dark. Emissive tells are
  // lighting-independent, so they hold through the dapple.
  shrikeChest: new THREE.MeshStandardMaterial({
    color: 0xd84a9a, emissive: 0x8a1a5e, emissiveIntensity: 0.9, roughness: 0.7,
  }),
  shrikeStripe: new THREE.MeshStandardMaterial({
    color: 0x64f0c8, emissive: 0x2ac89a, emissiveIntensity: 3.4, roughness: 0.4,
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

// Creatures pass through the canopy light-shafts and light up in them, the
// same as the world does. This is both correct-looking and load-bearing for
// legibility: when a shaft brightens the foliage BEHIND an enemy, the enemy
// brightens with it, so the contrast between them survives the dappling.
// (Emissive tells - eyes, sacs, boils - are unaffected by lighting.)
for (const m of Object.values(MAT)) dapplify(m);

function mesh(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// A READABLE eye (round-3 legibility pass - "cant make out eyes"): a dark
// socket ring behind a big emissive iris with a dark pupil. The contrast
// ring is what makes it read at 25m through fog, the size sells character.
const SOCKET_MAT = new THREE.MeshStandardMaterial({ color: 0x0e0b08, roughness: 1 });
const PUPIL_MAT = new THREE.MeshStandardMaterial({ color: 0x14060a, roughness: 0.4 });
function eye(r, irisMat, x, y, z, fwdZ = -1, slit = false) {
  const g = new THREE.Group();
  const socket = new THREE.Mesh(G(`eyeSock${r}`, () => {
    const s = new THREE.SphereGeometry(r * 1.35, 8, 6);
    s.scale(1, 1, 0.55);
    return s;
  }), SOCKET_MAT);
  g.add(socket);
  const iris = new THREE.Mesh(G(`eyeIris${r}`, () => new THREE.SphereGeometry(r, 8, 6)), irisMat);
  iris.position.z = fwdZ * r * 0.45;
  iris.castShadow = false;
  g.add(iris);
  const pupil = new THREE.Mesh(G(`eyePup${r}`, () => new THREE.SphereGeometry(r * 0.4, 6, 5)), PUPIL_MAT);
  pupil.position.z = fwdZ * r * 1.15;
  pupil.castShadow = false;
  if (slit) pupil.scale.set(0.45, 2.1, 1); // vertical cat-slit - menace, not googly
  g.add(pupil);
  g.position.set(x, y, z);
  return g;
}

// Curved-profile lathe: revolve a 2D taper profile around Y. points =
// [[radius, y], ...] in ascending y. The organic alternative to a straight
// two-radius cylinder: fat where muscle sits, narrow at the joint, closed
// at both ends so no open rim ever shows. computeVertexNormals gives the
// smooth organic shading (hard/armour parts keep their faceted look).
function lathe(key, points, segs = 8) {
  return G(key, () => {
    const pts = points.map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, segs);
    g.computeVertexNormals();
    return g;
  });
}

// Two-segment leg: thigh pivots at hip, shin hangs from knee. Animate the
// hip (rotation.x) and the knee counter-bends in enemies.animate - real
// limbs, not stilts (round-1 feedback: "not proper legs").
// Round-8 creature pass: segments are lathed muscle profiles now - a thigh
// bulges where the muscle sits and tapers hard (~55%) into the knee, the
// shin carries a calf swell and runs to a fine ankle, and a ball of flesh
// rides the knee joint so the two segments stay visually continuous at any
// bend angle. Same refs contract ({ hip, knee }) as always.
function twoSegLeg(matA, matB, thighLen, shinLen, r) {
  const hip = new THREE.Group();
  const thigh = mesh(lathe(`thigh2:${thighLen}:${r}`, [
    [0.001, -thighLen - 0.01],
    [r * 0.5, -thighLen],
    [r * 0.78, -thighLen * 0.62],
    [r * 1.14, -thighLen * 0.26],
    [r * 0.98, 0],
    [0.001, thighLen * 0.09],
  ]), matA, 0, 0, 0);
  hip.add(thigh);
  const knee = new THREE.Group();
  knee.position.y = -thighLen;
  // knee ball - hides the hinge gap however far the shin swings
  const ball = mesh(G(`kneeBall:${r}`, () => new THREE.SphereGeometry(r * 0.62, 7, 6)), matA, 0, 0, 0);
  knee.add(ball);
  const shin = mesh(lathe(`shin2:${shinLen}:${r}`, [
    [0.001, -shinLen - 0.01],
    [r * 0.32, -shinLen],
    [r * 0.46, -shinLen * 0.6],
    [r * 0.68, -shinLen * 0.24],
    [r * 0.56, 0],
    [0.001, shinLen * 0.07],
  ]), matB, 0, 0, 0);
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

  // neck wedge: the head no longer floats off the pill - it grows out of it
  const neck = mesh(G('prNeck', () => {
    const n = new THREE.CylinderGeometry(0.14, 0.2, 0.3, 7);
    n.rotateX(Math.PI / 2 - 0.5);
    return n;
  }), MAT.prowlerHide, 0, 0.7, -0.48);
  g.add(neck);
  // brisket: a chest mass under the neck root, so neck + shoulders read as
  // one muscled front instead of a tube meeting a pill
  const brisket = mesh(G('prBrisket', () => {
    const s = new THREE.SphereGeometry(0.21, 8, 6);
    s.scale(1, 1.02, 1.4);
    return s;
  }), MAT.prowlerHide, 0, 0.58, -0.36);
  g.add(brisket);
  const head = mesh(G('prHead', () => {
    const h = new THREE.BoxGeometry(0.3, 0.26, 0.38);
    // taper the muzzle end so the skull reads feline, not brick
    const pos = h.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < -0.1) {
        pos.setX(i, pos.getX(i) * 0.72);
        pos.setY(i, pos.getY(i) * 0.8 + 0.01);
      }
    }
    h.computeVertexNormals();
    return h;
  }), MAT.prowlerHide, 0, 0.74, -0.62);
  g.add(head);
  // jaw sits flush under the muzzle now (was floating), coral for contrast
  const jaw = mesh(G('prJaw', () => new THREE.BoxGeometry(0.2, 0.08, 0.28)), MAT.prowlerStripe, 0, 0.645, -0.63);
  g.add(jaw);
  // coral throat blaze: bright emissive counter-shade under the chin. It is
  // load-bearing for legibility - the slit-eye face pass shrank the bright
  // pixel area and the contrast probe dipped below band without it.
  const blaze = mesh(G('prBlaze', () => {
    const b = new THREE.SphereGeometry(0.14, 7, 6);
    b.scale(1, 0.8, 1.4);
    return b;
  }), MAT.prowlerStripe, 0, 0.56, -0.5);
  blaze.castShadow = false;
  g.add(blaze);
  // bared fangs at the jaw's leading edge - predator, not pet
  const fangGeo = G('prFang', () => new THREE.ConeGeometry(0.022, 0.09, 5));
  for (const ex of [-0.07, 0.07]) {
    const fang = mesh(fangGeo, MAT.juggPlate, ex, 0.63, -0.76);
    fang.rotation.x = Math.PI; // point down
    g.add(fang);
  }
  // ember cat-eyes with SLIT pupils, tucked under a coral brow ridge that
  // reads against the dark head - glare, not googly (round-5 face pass)
  const eyeL = eye(0.062, MAT.emberEye, -0.082, 0.775, -0.775, -1, true);
  const eyeR = eye(0.062, MAT.emberEye, 0.082, 0.775, -0.775, -1, true);
  eyeL.rotation.z = -0.22; // slant outer corners down: angry, feline
  eyeR.rotation.z = 0.22;
  g.add(eyeL, eyeR);
  const browGeo = G('prBrow', () => new THREE.BoxGeometry(0.13, 0.045, 0.14));
  for (const ex of [-0.08, 0.08]) {
    const brow = mesh(browGeo, MAT.prowlerStripe, ex, 0.845, -0.76);
    brow.rotation.z = ex > 0 ? -0.3 : 0.3; // V-angle over the eyes
    brow.rotation.x = -0.2;
    brow.castShadow = false;
    g.add(brow);
  }
  const earGeo = G('prEar', () => new THREE.ConeGeometry(0.06, 0.14, 5));
  for (const ex of [-0.11, 0.11]) {
    const ear = mesh(earGeo, MAT.prowlerHide, ex, 0.9, -0.5);
    ear.rotation.x = -0.35;
    ear.rotation.z = ex > 0 ? -0.2 : 0.2;
    g.add(ear);
  }

  // shoulder + haunch muscle masses - breaks the pill silhouette
  const shoulderGeo = G('prShoulder', () => {
    const s = new THREE.SphereGeometry(0.2, 7, 6);
    s.scale(1, 1.15, 1.2);
    return s;
  });
  for (const [x, z] of [[-0.14, -0.34], [0.14, -0.34]]) {
    g.add(mesh(shoulderGeo, MAT.prowlerHide, x, 0.66, z));
  }
  const haunchGeo = G('prHaunch', () => {
    const s = new THREE.SphereGeometry(0.24, 7, 6);
    s.scale(0.85, 1.2, 1.3);
    return s;
  });
  for (const [x, z] of [[-0.15, 0.36], [0.15, 0.36]]) {
    g.add(mesh(haunchGeo, MAT.prowlerHide, x, 0.64, z));
  }
  // topline: one long low ellipsoid riding the spine, filling the dips
  // between shoulder mass, body pill, and haunch mass - the side silhouette
  // reads as ONE flowing back, not three lumps
  const topline = mesh(G('prTopline', () => {
    const s = new THREE.SphereGeometry(0.2, 8, 6);
    s.scale(0.85, 0.75, 2.3);
    return s;
  }), MAT.prowlerHide, 0, 0.74, 0.02);
  g.add(topline);
  // coral spine ridge - fantastical crest, glows like the stripes
  const spikeGeo = G('prSpike', () => new THREE.ConeGeometry(0.035, 0.14, 5));
  for (let i = 0; i < 4; i++) {
    const spike = mesh(spikeGeo, MAT.prowlerStripe, 0, 0.92 - i * 0.008, -0.28 + i * 0.2);
    spike.rotation.x = 0.25 + i * 0.12; // rake back toward the tail
    spike.castShadow = false;
    g.add(spike);
  }

  const legs = [];
  const knees = [];
  for (const [x, z] of [[-0.18, -0.38], [0.18, -0.38], [-0.18, 0.38], [0.18, 0.38]]) {
    const { hip, knee } = twoSegLeg(MAT.prowlerHide, MAT.prowlerHide, 0.34, 0.32, 0.085);
    hip.position.set(x, 0.62, z);
    knee.rotation.x = 0.35;
    // paw at the shin's end - feet ground the silhouette
    const paw = mesh(G('prPaw', () => {
      const s = new THREE.SphereGeometry(0.065, 6, 5);
      s.scale(1.1, 0.7, 1.3);
      return s;
    }), MAT.prowlerStripe, 0, -0.32, -0.02);
    knee.add(paw);
    legs.push(hip);
    knees.push(knee);
    g.add(hip);
  }
  const tail = mesh(G('prTail2', () => {
    // curved-taper lathe: thick at the root, whips to a fine tip
    const t = new THREE.LatheGeometry([
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.052, 0.02),
      new THREE.Vector2(0.048, 0.16),
      new THREE.Vector2(0.034, 0.38),
      new THREE.Vector2(0.018, 0.56),
      new THREE.Vector2(0.001, 0.7),
    ], 7);
    t.computeVertexNormals();
    t.translate(0, -0.35, 0);
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
  const torso = mesh(G('spTorso2', () => {
    // wider than tall, and vertex-pinched behind the shoulders so the
    // silhouette is an amphibian teardrop, not a pill
    const t = new THREE.CapsuleGeometry(0.3, 0.55, 4, 10);
    t.rotateX(0.55);
    t.scale(1.3, 1, 1.08);
    const pos = t.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < -0.15) { // shoulder end narrows toward the head
        const k = 1 - Math.min(1, (-z - 0.15) / 0.45) * 0.28;
        pos.setX(i, pos.getX(i) * k);
      }
    }
    t.computeVertexNormals();
    return t;
  }), MAT.spitterSkin, 0, 1.05, 0.05);
  g.add(torso);
  const belly = mesh(G('spBelly', () => {
    const t = new THREE.CapsuleGeometry(0.24, 0.4, 4, 8);
    t.rotateX(0.55);
    t.scale(1.25, 1, 1.05);
    return t;
  }), MAT.spitterBelly, 0, 0.98, -0.08);
  belly.castShadow = false;
  g.add(belly);
  // hip mass: frogs are all haunch - a wide rear dome the legs grow out of
  const hips = mesh(G('spHips', () => {
    const s = new THREE.SphereGeometry(0.3, 9, 7);
    s.scale(1.45, 0.95, 1.1);
    return s;
  }), MAT.spitterSkin, 0, 0.92, 0.26);
  g.add(hips);
  // shoulder hunch: merges the skull into the back - no neck, pure frog
  const hunch = mesh(G('spHunch', () => {
    const s = new THREE.SphereGeometry(0.26, 9, 7);
    s.scale(1.2, 0.9, 1.15);
    return s;
  }), MAT.spitterSkin, 0, 1.26, -0.14);
  g.add(hunch);
  // vocal pouch: pale throat bubble under the jaw - instant amphibian tell
  const pouch = mesh(G('spPouch', () => {
    const s = new THREE.SphereGeometry(0.16, 8, 6);
    s.scale(1.3, 0.95, 1.05);
    return s;
  }), MAT.spitterBelly, 0, 1.18, -0.4);
  pouch.castShadow = false;
  g.add(pouch);

  const head = mesh(G('spHead2', () => {
    const h = new THREE.SphereGeometry(0.24, 9, 7);
    h.scale(1.05, 0.82, 1.25);
    return h;
  }), MAT.spitterSkin, 0, 1.38, -0.32);
  g.add(head);
  // frog eyes on raised turrets atop the head - unmistakably an amphibian
  const turretGeo = G('spTurret', () => new THREE.SphereGeometry(0.085, 7, 6));
  for (const ex of [-0.11, 0.11]) {
    const turret = mesh(turretGeo, MAT.spitterSkin, ex, 1.53, -0.36);
    g.add(turret);
    g.add(eye(0.07, MAT.emberEye, ex, 1.56, -0.41));
  }
  // wide dark mouth slit + two fang nubs (the bite is real - 7dmg)
  const mouth = mesh(G('spMouth', () => {
    const s = new THREE.BoxGeometry(0.3, 0.045, 0.16);
    return s;
  }), SOCKET_MAT, 0, 1.3, -0.5);
  g.add(mouth);
  const fangGeoSp = G('spFang', () => new THREE.ConeGeometry(0.022, 0.07, 5));
  for (const ex of [-0.09, 0.09]) {
    const fang = mesh(fangGeoSp, MAT.juggPlate, ex, 1.26, -0.53);
    fang.rotation.x = Math.PI;
    g.add(fang);
  }

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
  const haunchGeoSp = G('spHaunch', () => {
    const s = new THREE.SphereGeometry(0.19, 8, 6);
    s.scale(0.9, 1.15, 1.3);
    return s;
  });
  for (const x of [-0.22, 0.22]) {
    // thigh mass the leg grows out of - the leg meets muscle, not surface
    g.add(mesh(haunchGeoSp, MAT.spitterSkin, x, 0.86, 0.26));
    const { hip, knee } = twoSegLeg(MAT.spitterSkin, MAT.spitterSkin, 0.45, 0.42, 0.105);
    hip.position.set(x * 0.85, 0.85, 0.16);
    // crouch pivot: the walk swing drives hip.rotation.x absolutely, so the
    // frog-fold base angle lives on a wrapper group the animation never sees
    const crouch = new THREE.Group();
    crouch.position.copy(hip.position);
    hip.position.set(0, 0, 0);
    crouch.rotation.x = -0.38;
    crouch.add(hip);
    knee.rotation.x = 0.75;
    // webbed foot: broad flat toe fan grounding the stance
    const foot = mesh(G('spFoot', () => {
      const s = new THREE.SphereGeometry(0.085, 7, 5);
      s.scale(1.3, 0.55, 1.7);
      return s;
    }), MAT.spitterSkin, 0, -0.42, -0.05);
    knee.add(foot);
    legs.push(hip);
    knees.push(knee);
    g.add(crouch);
  }
  // forelimbs: real two-segment arms planted forward like a sitting frog,
  // not noodle cylinders hanging off the flank
  const arms = [];
  const shoulderGeoSp = G('spShoulder2', () => new THREE.SphereGeometry(0.11, 7, 6));
  for (const x of [-0.28, 0.28]) {
    // shoulder ball buried in the torso side - the arm grows out of it
    g.add(mesh(shoulderGeoSp, MAT.spitterSkin, x * 0.9, 1.18, -0.14));
    const { hip: shoulder, knee: elbow } = twoSegLeg(MAT.spitterSkin, MAT.spitterSkin, 0.3, 0.32, 0.06);
    shoulder.position.set(x, 1.16, -0.16);
    shoulder.rotation.z = x > 0 ? -0.3 : 0.3;
    shoulder.rotation.x = -0.35;
    elbow.rotation.x = 0.5; // forearm plants down and forward
    // three-toed hand
    const toeGeo = G('spToe', () => {
      const s = new THREE.SphereGeometry(0.035, 6, 5);
      s.scale(1, 0.7, 1.6);
      return s;
    });
    for (const tx of [-0.045, 0, 0.045]) {
      const toe = mesh(toeGeo, MAT.spitterSkin, tx, -0.33, -0.04 - Math.abs(tx) * -0.5);
      elbow.add(toe);
    }
    arms.push(shoulder);
    g.add(shoulder);
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
  const torso = mesh(G('juTorso2', () => {
    // gorilla mass distribution: chest and shoulders carry the width, the
    // silhouette tapers into the hips - not a uniform pill
    const t = new THREE.CapsuleGeometry(0.62, 0.7, 4, 12);
    t.scale(1.34, 1, 0.92);
    const pos = t.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      let k = 1;
      if (y > 0.12) k = 1 + Math.min(1, (y - 0.12) / 0.6) * 0.18; // chest flares
      else if (y < -0.12) k = 1 - Math.min(1, (-y - 0.12) / 0.75) * 0.2; // hips narrow
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    t.computeVertexNormals();
    return t;
  }), MAT.juggHide, 0, 1.55, 0);
  g.add(torso);
  // neck: the skull grew straight out of empty air above the mantle before -
  // now a thick trunk of hide bridges torso top into the head box
  const neck = mesh(G('juNeck', () => {
    const n = new THREE.CylinderGeometry(0.24, 0.34, 0.5, 9);
    n.rotateX(0.35);
    return n;
  }), MAT.juggHide, 0, 2.12, -0.14);
  g.add(neck);
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
  // eye SLOTS cut into the plate: dark recesses with embers burning deep -
  // the skull-mask reads as armour, the eyes read as alive
  for (const ex of [-0.1, 0.1]) {
    const slot = mesh(G('juSlot', () => new THREE.BoxGeometry(0.11, 0.07, 0.06)), SOCKET_MAT, ex, 2.33, -0.45);
    g.add(slot);
    g.add(eye(0.055, MAT.emberEye, ex, 2.33, -0.47));
  }
  // tusks curving up from the jawline - silhouette hook at any range
  const tuskGeo = G('juTusk', () => {
    const t = new THREE.ConeGeometry(0.05, 0.34, 6);
    t.rotateX(-0.9);
    return t;
  });
  for (const ex of [-0.19, 0.19]) {
    const tusk = mesh(tuskGeo, MAT.juggPlate, ex, 2.13, -0.5);
    tusk.rotation.z = ex > 0 ? -0.22 : 0.22;
    g.add(tusk);
  }
  // moss drape bridging mantle to torso (there was a visible gap line)
  const drapeGeo = G('juDrape', () => {
    const s = new THREE.SphereGeometry(0.5, 8, 6);
    s.scale(0.55, 0.8, 0.9);
    return s;
  });
  for (const ex of [-0.62, 0.62]) {
    const drape = mesh(drapeGeo, MAT.juggMoss, ex, 1.75, 0.04);
    g.add(drape);
  }

  // the amber boil on its back - the real weakpoint. Bait the charge,
  // shoot the pass.
  const boil = mesh(G('juBoil', () => new THREE.SphereGeometry(0.26, 8, 6)), MAT.juggBoil, 0, 1.72, 0.62);
  boil.castShadow = false;
  g.add(boil);

  // arms: lathed muscle profile - deltoid buried in the shoulder sphere,
  // bicep swell, elbow waist, forearm swell, wrist - not a plumbing pipe
  const armGeo = lathe('juArm2', [
    [0.001, -1.56],
    [0.15, -1.5],
    [0.2, -1.15],
    [0.27, -0.75],
    [0.21, -0.5],
    [0.32, -0.12],
    [0.34, 0.06],
    [0.001, 0.14],
  ], 9);
  const arms = [];
  for (const x of [-0.82, 0.82]) {
    const arm = mesh(armGeo, MAT.juggHide, x, 1.9, 0);
    arms.push(arm);
    g.add(arm);
  }
  const clawGeo = G('juClaw', () => new THREE.ConeGeometry(0.09, 0.3, 5));
  const knuckleGeo = G('juKnuckle', () => {
    const s = new THREE.SphereGeometry(0.17, 8, 6);
    s.scale(1.15, 0.85, 1.1);
    return s;
  });
  for (const arm of arms) {
    // knuckle mass at the hand end - the claws grow out of a fist
    arm.add(mesh(knuckleGeo, MAT.juggHide, 0, -1.52, -0.04));
    for (let i = 0; i < 3; i++) {
      const claw = mesh(clawGeo, MAT.claw, (i - 1) * 0.12, -1.66, -0.08);
      claw.rotation.x = Math.PI;
      arm.add(claw);
    }
  }

  // legs: lathed - thigh into knee waist into calf swell into ankle
  const legGeo = lathe('juLeg2', [
    [0.001, -1.12],
    [0.16, -1.05],
    [0.25, -0.72],
    [0.21, -0.5],
    [0.3, -0.18],
    [0.31, 0.04],
    [0.001, 0.1],
  ], 9);
  const haunchGeoJu = G('juHaunch', () => {
    const s = new THREE.SphereGeometry(0.33, 9, 7);
    s.scale(1.05, 1.15, 1.15);
    return s;
  });
  const legs = [];
  for (const x of [-0.35, 0.35]) {
    // glute/haunch mass burying the leg root into the pelvis
    g.add(mesh(haunchGeoJu, MAT.juggHide, x, 1.12, 0.08));
    const leg = mesh(legGeo, MAT.juggHide, x, 1.1, 0.05);
    // stone-toed foot - the titan stands ON something now
    const foot = mesh(G('juFoot', () => {
      const f = new THREE.BoxGeometry(0.34, 0.14, 0.44);
      return f;
    }), MAT.juggPlate, 0, -1.08, -0.06);
    leg.add(foot);
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
  // a face: head bulb + two big forward eyes - it flies AT yours, so the
  // last thing you see should have a last thing to see you with
  const swHead = mesh(G('swHead', () => new THREE.SphereGeometry(0.075, 7, 6)), MAT.wingBody, 0, 0.02, -0.16);
  g.add(swHead);
  for (const ex of [-0.045, 0.045]) {
    g.add(eye(0.038, MAT.wingAbdomen, ex, 0.045, -0.2));
  }
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
  const torso = mesh(G('shTorso2', () => {
    // gibbon chest: broad shoulder girdle tapering to a narrow waist -
    // vertex-reshaped before the forward lean so the rule tracks the spine
    const t = new THREE.CapsuleGeometry(0.22, 0.5, 4, 10);
    const pos = t.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      let k = 1;
      if (y > 0.08) k = 1 + Math.min(1, (y - 0.08) / 0.3) * 0.32; // shoulders
      else if (y < -0.04) k = 1 - Math.min(1, (-y - 0.04) / 0.4) * 0.22; // waist
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * (k > 1 ? 1 + (k - 1) * 0.5 : 1));
    }
    t.computeVertexNormals();
    t.rotateX(0.35);
    return t;
  }), MAT.shrikeFur, 0, 0.95, 0);
  g.add(torso);
  // hip mass: the legs fold out of a real pelvis, not the capsule tip
  const pelvis = mesh(G('shPelvis', () => {
    const s = new THREE.SphereGeometry(0.17, 8, 6);
    s.scale(1.25, 0.95, 1.1);
    return s;
  }), MAT.shrikeFur, 0, 0.74, 0.09);
  g.add(pelvis);
  // neck wedge: the skull grows out of the shoulder girdle (prowler pattern)
  const neck = mesh(G('shNeck', () => {
    const n = new THREE.CylinderGeometry(0.09, 0.14, 0.22, 7);
    n.rotateX(-0.35);
    return n;
  }), MAT.shrikeFur, 0, 1.2, -0.08);
  g.add(neck);
  const chest = mesh(G('shChest', () => new THREE.SphereGeometry(0.19, 7, 6)), MAT.shrikeChest, 0, 1.0, -0.14);
  chest.castShadow = false;
  g.add(chest);
  const head = mesh(G('shHead', () => {
    const h = new THREE.SphereGeometry(0.16, 8, 6);
    h.scale(1, 1.1, 1);
    return h;
  }), MAT.shrikeFur, 0, 1.32, -0.12);
  g.add(head);
  // glowing brow stripe - the airborne streak you track through the trees
  const stripe = mesh(G('shStripe', () => new THREE.BoxGeometry(0.3, 0.05, 0.1)), MAT.shrikeStripe, 0, 1.4, -0.22);
  stripe.castShadow = false;
  g.add(stripe);
  // two big cyan eyes UNDER the brow - a face, not a smear. Pushed proud of
  // the skull surface (they were buried inside the head sphere and never
  // actually rendered - the stripe was carrying the whole face).
  for (const ex of [-0.075, 0.075]) {
    g.add(eye(0.06, MAT.shrikeStripe, ex, 1.31, -0.29));
  }

  // long two-segment arms - it swings, you duck
  const arms = [];
  const elbows = [];
  const shoulderGeoSh = G('shShoulder', () => {
    const s = new THREE.SphereGeometry(0.11, 8, 6);
    s.scale(1.15, 1, 1);
    return s;
  });
  for (const x of [-0.28, 0.28]) {
    // deltoid ball buried across torso edge and arm root - the reaching
    // limb grows out of the girdle instead of swinging beside it
    g.add(mesh(shoulderGeoSh, MAT.shrikeFur, x * 0.88, 1.19, -0.02));
    const { hip: shoulder, knee: elbow } = twoSegLeg(MAT.shrikeFur, MAT.shrikeFur, 0.5, 0.55, 0.062);
    shoulder.position.set(x, 1.18, 0);
    shoulder.rotation.z = x > 0 ? -0.5 : 0.5;
    elbow.rotation.x = -0.4;
    // knuckled hand: a wrist ball with three hooked claws fanned forward
    // (it swings; now you see with what)
    const hand = mesh(G('shHand', () => new THREE.SphereGeometry(0.055, 7, 6)), MAT.shrikeFur, 0, -0.54, -0.01);
    elbow.add(hand);
    const clawGeoSh = G('shClaw', () => {
      const s = new THREE.ConeGeometry(0.03, 0.15, 5);
      s.rotateX(Math.PI * 0.5);
      return s;
    });
    for (const [cx, cz] of [[-0.045, -0.05], [0, -0.08], [0.045, -0.05]]) {
      const clawHand = mesh(clawGeoSh, MAT.claw, cx, -0.56, cz);
      elbow.add(clawHand);
    }
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
  const tail = mesh(G('shTail2', () => {
    // curved-taper lathe - thick root whipping to a fine tip
    const t = new THREE.LatheGeometry([
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.048, 0.02),
      new THREE.Vector2(0.042, 0.2),
      new THREE.Vector2(0.028, 0.5),
      new THREE.Vector2(0.014, 0.7),
      new THREE.Vector2(0.001, 0.85),
    ], 7);
    t.computeVertexNormals();
    t.translate(0, -0.42, 0);
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
  // the core is an EYEBALL that watches you while it screams - iris ring
  // + pupil on the golden sphere (crit zone unchanged)
  const core = mesh(G('blCore', () => new THREE.SphereGeometry(0.2, 8, 6)), MAT.bloomCore, 0, 2.05, -0.12);
  core.castShadow = false;
  g.add(core);
  const coreIris = mesh(G('blIris', () => {
    const s = new THREE.SphereGeometry(0.105, 8, 6);
    s.scale(1, 1, 0.5);
    return s;
  }), MAT.orchid, 0, 2.05, -0.29);
  coreIris.castShadow = false;
  g.add(coreIris);
  const corePupil = mesh(G('blPupil', () => {
    const s = new THREE.SphereGeometry(0.055, 6, 5);
    s.scale(1, 1, 0.5);
    return s;
  }), SOCKET_MAT, 0, 2.05, -0.315);
  corePupil.castShadow = false;
  g.add(corePupil);
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

// ---------- THE MIREMOTHER (apex serpent of the Sunken Maw, ~22m) ----------
// The finale's set-piece. The model group stays at the ORIGIN: the boss
// behaviour writes world positions into refs.head / refs.segments each
// frame (a follow-the-leader chain), so there is no group transform.
// Hood open = strike tell AND crit window (enemies.js special-cases her).
const MIRE = {
  scale: new THREE.MeshStandardMaterial({ color: 0x1e6e4e, roughness: 0.55, metalness: 0.1 }),
  scaleGlow: new THREE.MeshStandardMaterial({
    color: 0x2ee8c8, emissive: 0x14b898, emissiveIntensity: 1.1, roughness: 0.4,
  }),
  belly: new THREE.MeshStandardMaterial({ color: 0xd8d2b4, roughness: 0.8 }),
  hood: new THREE.MeshStandardMaterial({
    color: 0x8a2456, emissive: 0xd0186a, emissiveIntensity: 0.7,
    roughness: 0.6, side: THREE.DoubleSide,
  }),
  fang: new THREE.MeshStandardMaterial({ color: 0xf2ecd8, roughness: 0.4 }),
  maw: new THREE.MeshStandardMaterial({ color: 0x40060e, roughness: 0.9 }),
};

export function buildMiremother() {
  const g = new THREE.Group();

  // head: broad wedge skull with a hinged jaw
  const head = new THREE.Group();
  const skull = mesh(G('mmSkull', () => {
    const s = new THREE.SphereGeometry(1.05, 10, 8);
    s.scale(1.15, 0.8, 1.5);
    return s;
  }), MIRE.scale, 0, 0, 0);
  head.add(skull);
  const snout = mesh(G('mmSnout', () => {
    const s = new THREE.SphereGeometry(0.62, 8, 6);
    s.scale(1, 0.62, 1.3);
    return s;
  }), MIRE.scale, 0, -0.12, -1.35);
  head.add(snout);
  // the maw: dark open throat + upper fangs (readable even mid-lunge)
  const throat = mesh(G('mmThroat', () => {
    const s = new THREE.SphereGeometry(0.5, 8, 6);
    s.scale(1, 0.5, 1.1);
    return s;
  }), MIRE.maw, 0, -0.42, -1.3);
  head.add(throat);
  const jaw = mesh(G('mmJaw', () => {
    const s = new THREE.SphereGeometry(0.55, 8, 6);
    s.scale(1, 0.35, 1.35);
    return s;
  }), MIRE.scale, 0, -0.62, -1.25);
  head.add(jaw);
  const fangGeo = G('mmFang', () => new THREE.ConeGeometry(0.09, 0.55, 6));
  for (const [fx, fz] of [[-0.42, -1.9], [0.42, -1.9], [-0.6, -1.4], [0.6, -1.4]]) {
    const fang = mesh(fangGeo, MIRE.fang, fx, -0.42, fz);
    fang.rotation.x = Math.PI; // points down
    head.add(fang);
  }
  // eyes: HUGE amber slits in dark sockets - she must read at 60m
  const eyes = [];
  for (const ex of [-0.62, 0.62]) {
    const socket = mesh(G('mmSocket', () => new THREE.SphereGeometry(0.34, 8, 6)), MIRE.maw, ex, 0.3, -0.75);
    head.add(socket);
    const eye = mesh(G('mmEye', () => {
      const s = new THREE.SphereGeometry(0.26, 8, 6);
      s.scale(1, 1.45, 0.6);
      return s;
    }), MAT.emberEye.clone(), ex, 0.3, -0.92);
    eye.castShadow = false;
    eyes.push(eye);
    head.add(eye);
  }
  // the hood: two membrane fans that FLARE as the strike tell
  const hoodGeo = G('mmHood', () => {
    const p = new THREE.PlaneGeometry(1.7, 2.4, 2, 3);
    const pos = p.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      pos.setZ(i, -Math.abs(x) * 0.4 + Math.sin((y + 1.2) / 2.4 * Math.PI) * 0.3);
    }
    return p;
  });
  const hoodL = new THREE.Mesh(hoodGeo, MIRE.hood);
  hoodL.position.set(-0.7, 0.5, 0.4);
  hoodL.rotation.set(0.25, 0.55, 0.9); // folded flat against the neck
  const hoodR = new THREE.Mesh(hoodGeo, MIRE.hood);
  hoodR.position.set(0.7, 0.5, 0.4);
  hoodR.rotation.set(0.25, -0.55, -0.9);
  head.add(hoodL, hoodR);
  g.add(head);

  // body: tapering segment chain, glow-banded so her coils read in murk
  const segments = [];
  const N_SEG = 13;
  for (let i = 0; i < N_SEG; i++) {
    const t = i / (N_SEG - 1);
    const r = 0.95 * (1 - t * 0.72);
    const seg = new THREE.Group();
    const scaleMesh = mesh(G(`mmSeg${i}`, () => {
      const s = new THREE.SphereGeometry(r, 9, 7);
      s.scale(1, 0.92, 1.35);
      return s;
    }), i % 3 === 1 ? MIRE.scaleGlow : MIRE.scale, 0, 0, 0);
    seg.add(scaleMesh);
    const bellyMesh = mesh(G(`mmBelly${i}`, () => {
      const s = new THREE.SphereGeometry(r * 0.82, 8, 6);
      s.scale(1.05, 0.6, 1.3);
      return s;
    }), MIRE.belly, 0, -r * 0.42, 0);
    bellyMesh.castShadow = false;
    seg.add(bellyMesh);
    // dorsal spines on the fore-body
    if (i < 7 && i % 2 === 0) {
      const spine = mesh(G(`mmSpine${i}`, () => new THREE.ConeGeometry(r * 0.28, r * 1.3, 5)), MIRE.hood, 0, r * 0.95, 0);
      seg.add(spine);
    }
    g.add(seg);
    segments.push(seg);
  }

  return {
    group: g,
    refs: { head, jaw, hoodL, hoodR, eyes, segments },
    // ray-test spheres are DYNAMIC (chain positions) - enemies.rayEnemies
    // special-cases the miremother; these statics are never used
    headOffset: new THREE.Vector3(0, 0, 0),
    bodyOffset: new THREE.Vector3(0, 0, 0),
    headR: 1.15,
    bodyR: 0.95,
  };
}

// ---------- VIPERBLOSSOM (dormant flower mimic, 0.9m) ----------
export function buildViperblossom() {
  const g = new THREE.Group();
  const stalk = mesh(G('vbStalk', () => {
    const s = new THREE.CylinderGeometry(0.12, 0.2, 1.2, 6);
    s.translate(0, 0.6, 0);
    return s;
  }), MAT.bloomStalk, 0, 0.15, 0);
  g.add(stalk);

  // bulb head: closed petals hugging it
  const bulb = mesh(G('vbBulb', () => new THREE.SphereGeometry(0.28, 8, 7)), MAT.bloomStalk, 0, 1.45, 0);
  g.add(bulb);

  // petals: arranged around the bulb, closed position hugs it tight
  const petals = [];
  const petalGeo = G('vbPetal', () => {
    const p = new THREE.PlaneGeometry(0.24, 0.5, 1, 2);
    const pos = p.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, Math.sin((y + 0.25) / 0.5 * Math.PI) * 0.08);
    }
    p.translate(0, 0.25, 0);
    return p;
  });
  for (let i = 0; i < 6; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.4, 0);
    pivot.rotation.y = (i / 6) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, MAT.bloomPetal);
    petal.position.set(0, 0, 0.15);
    petal.rotation.x = 0.05; // closed: petals hug the bulb tight
    petal.castShadow = false;
    pivot.add(petal);
    petals.push(petal);
    g.add(pivot);
  }

  // the eye: dark socket + amber iris, hidden until burst
  const eyeSocket = mesh(G('vbSocket', () => new THREE.SphereGeometry(0.16, 6, 5)), MAT.juggHide, 0, 1.55, -0.22);
  eyeSocket.castShadow = false;
  g.add(eyeSocket);
  const eyeIris = mesh(G('vbIris', () => new THREE.SphereGeometry(0.12, 6, 5)), MAT.emberEye.clone(), 0, 1.55, -0.28);
  eyeIris.castShadow = false;
  g.add(eyeIris);

  // fanged maw: a small dark opening
  const maw = mesh(G('vbMaw', () => new THREE.SphereGeometry(0.14, 6, 5)), MAT.juggHide, 0, 1.25, -0.15);
  maw.castShadow = false;
  g.add(maw);

  return {
    group: g,
    refs: { stalk, bulb, petals, eyeIris, maw },
    headOffset: new THREE.Vector3(0, 1.55, -0.25),
    bodyOffset: new THREE.Vector3(0, 1.45, 0),
    headR: 0.25,
    bodyR: 0.4,
    // the eye is a crit only when petals are open (burst/lash states)
    crits: [{ off: new THREE.Vector3(0, 1.55, -0.28), r: 0.15, mult: 2.5, when: 'burst' },
            { off: new THREE.Vector3(0, 1.55, -0.28), r: 0.15, mult: 2.5, when: 'lash' }],
  };
}

export const BUILDERS = {
  prowler: buildProwler,
  spitter: buildSpitter,
  juggernaut: buildJuggernaut,
  stingerwing: buildStingerwing,
  shrike: buildShrike,
  bloomcaller: buildBloomcaller,
  miremother: buildMiremother,
  viperblossom: buildViperblossom,
};

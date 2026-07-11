// Resource pickups - the reason to leave the straight line (pillar 3) and
// the currency of every fight (pillar 4). Clustered at ruins, richest in the
// swamp, scattered thinly elsewhere. Juggernauts drop a cache on death.
// Instanced meshes; a taken pickup collapses its instance to zero scale.

import * as THREE from 'three';
import { WORLD, terrainHeight, moisture } from '../world/heightmap.js';
import { RUIN_SITES } from '../world/props.js';
import { makeRng } from '../core/rng.js';
import { sfxPickup } from '../audio/engine.js';

const POOL_PER_TYPE = 90;

const TYPES = {
  rifleAmmo: { color: 0xd8a437, emissive: 0x8a5f10, size: [0.42, 0.26, 0.3], amount: 30 },
  shells: { color: 0xb04a32, emissive: 0x701f10, size: [0.34, 0.22, 0.26], amount: 8 },
  medkit: { color: 0xd8e2d4, emissive: 0x3f7a3a, size: [0.4, 0.28, 0.4], amount: 45 },
  longRounds: { color: 0x7a86d8, emissive: 0x2c3a9a, size: [0.46, 0.2, 0.24], amount: 8 },
  grenade: { color: 0x53645a, emissive: 0x28483a, size: [0.22, 0.28, 0.22], amount: 1 },
  ayahuasca: { color: 0xc75fe8, emissive: 0x8a18b8, size: [0.26, 0.42, 0.26], amount: 0 },
};

export function createPickups(scene, playerRef, weapons, hooks) {
  // hooks: { heal(amount) -> actualHealed, toast(msg),
  //          addGrenade(n) -> added, drinkBrew() -> bool }
  const meshes = {};
  const items = []; // { type, pos, active, idx }
  const free = {};
  for (const key of Object.keys(TYPES)) free[key] = [];

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

  for (const [key, def] of Object.entries(TYPES)) {
    const geo = new THREE.BoxGeometry(...def.size);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, emissive: def.emissive, emissiveIntensity: 1.1, roughness: 0.5,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, POOL_PER_TYPE);
    mesh.frustumCulled = false;
    for (let i = 0; i < POOL_PER_TYPE; i++) {
      mesh.setMatrixAt(i, HIDDEN);
      free[key].push(i);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    meshes[key] = mesh;
  }

  function place(type, x, z) {
    if (free[type].length === 0) return null;
    const idx = free[type].pop();
    const item = {
      type, idx, active: true,
      pos: new THREE.Vector3(x, terrainHeight(x, z) + 0.35, z),
      phase: Math.random() * 10,
    };
    items.push(item);
    return item;
  }

  function scatterWorld() {
    const rng = makeRng(WORLD.seed + 999);
    // ruins: reliable caches
    for (const site of RUIN_SITES) {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const type = rng.pick(['rifleAmmo', 'rifleAmmo', 'shells', 'medkit', 'grenade']);
        place(type, site.x + rng.range(-5, 5), site.z + rng.range(-5, 5));
      }
      if (rng.chance(0.8)) place('medkit', site.x + rng.range(-4, 4), site.z + rng.range(-4, 4));
    }
    // LONGARM rounds live at the watchful places - the marksman rifle is
    // carried empty; feeding it means visiting them
    for (const siteName of ['ridge watchpost', 'east descent', 'mesa gate', 'north ruin']) {
      const site = RUIN_SITES.find((s) => s.name === siteName);
      if (site) place('longRounds', site.x + rng.range(-4, 4), site.z + rng.range(-4, 4));
    }
    // the vine grows at the shrines - drink it and see
    for (const siteName of ['swamp shrine', 'rapids altar', 'causeway shrine']) {
      const site = RUIN_SITES.find((s) => s.name === siteName);
      if (site && rng.chance(0.85)) {
        place('ayahuasca', site.x + rng.range(-3, 3), site.z + rng.range(-3, 3));
      }
    }
    // scattered: moisture-weighted (swamp = rich)
    let placed = 0;
    for (let tries = 0; tries < 1100 && placed < 34; tries++) {
      const x = rng.range(-WORLD.playable + 15, WORLD.playable - 15);
      const z = rng.range(-WORLD.playable + 15, WORLD.playable - 15);
      const h = terrainHeight(x, z);
      if (h < WORLD.waterLevel + 0.2) continue;
      const m = moisture(x, z);
      const density = x < -55 ? 0.75 : 0.28 + m * 0.2; // swamp bonus
      if (!rng.chance(density * 0.5)) continue;
      const type = rng.pick(['rifleAmmo', 'rifleAmmo', 'shells', 'shells', 'medkit', 'grenade', 'longRounds']);
      place(type, x, z);
      placed++;
    }
    // starter cache at insertion
    place('rifleAmmo', WORLD.insertion.x - 2.5, WORLD.insertion.z - 2);
    place('grenade', WORLD.insertion.x + 2.8, WORLD.insertion.z - 1.5);
  }

  // juggernaut / kill drops
  function dropAt(x, z, generous) {
    place(generous ? 'medkit' : 'rifleAmmo', x + 0.6, z);
    if (generous) {
      place('rifleAmmo', x - 0.7, z + 0.5);
      place('shells', x, z - 0.8);
    }
  }

  function tryPickup(item) {
    if (item.type === 'medkit') {
      const healed = hooks.heal(TYPES.medkit.amount);
      if (healed <= 0) {
        hooks.toast('HEALTH FULL');
        return false;
      }
      hooks.toast(`+${healed} HEALTH`);
    } else if (item.type === 'grenade') {
      const added = hooks.addGrenade ? hooks.addGrenade(1) : 0;
      if (added <= 0) {
        hooks.toast('GRENADES FULL');
        return false;
      }
      hooks.toast('+1 GRENADE');
    } else if (item.type === 'ayahuasca') {
      if (!hooks.drinkBrew || !hooks.drinkBrew()) return false;
      // toast handled by the buff itself
    } else {
      const kind = item.type === 'rifleAmmo' ? 'carbine'
        : item.type === 'longRounds' ? 'longarm' : 'breacher';
      const added = weapons.addAmmo(kind, TYPES[item.type].amount);
      if (added <= 0) {
        hooks.toast('AMMO FULL');
        return false;
      }
      const label = item.type === 'rifleAmmo' ? `+${added} 5.56`
        : item.type === 'longRounds' ? `+${added} LONG ROUNDS` : `+${added} SHELLS`;
      hooks.toast(label);
    }
    sfxPickup(item.type === 'medkit' ? 'medkit' : 'ammo');
    return true;
  }

  let t = 0;
  function update(dt) {
    t += dt;
    const pp = playerRef.p.pos;
    for (const item of items) {
      if (!item.active) continue;
      // magnet radius
      const dx = item.pos.x - pp.x;
      const dz = item.pos.z - pp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.7 * 1.7 && Math.abs(item.pos.y - (pp.y - 1.2)) < 2.4) {
        if (tryPickup(item)) {
          item.active = false;
          meshes[item.type].setMatrixAt(item.idx, HIDDEN);
          meshes[item.type].instanceMatrix.needsUpdate = true;
          free[item.type].push(item.idx);
          continue;
        }
      }
      // idle animation: bob + slow spin (only when player is near enough to see)
      if (d2 < 60 * 60) {
        const bobY = item.pos.y + Math.sin(t * 2 + item.phase) * 0.07 + 0.05;
        _q.setFromAxisAngle(UP, t * 0.9 + item.phase);
        _m.compose(_s.set(item.pos.x, bobY, item.pos.z), _q, ONE);
        meshes[item.type].setMatrixAt(item.idx, _m);
        meshes[item.type].instanceMatrix.needsUpdate = true;
      }
    }
  }

  function reset() {
    for (const item of items) {
      if (item.active) {
        meshes[item.type].setMatrixAt(item.idx, HIDDEN);
      }
      free[item.type].push(item.idx);
    }
    items.length = 0;
    for (const key of Object.keys(free)) {
      free[key] = Array.from({ length: POOL_PER_TYPE }, (_, i) => i);
      meshes[key].instanceMatrix.needsUpdate = true;
    }
    scatterWorld();
  }

  const UP = new THREE.Vector3(0, 1, 0);
  const ONE = new THREE.Vector3(1, 1, 1);

  scatterWorld();
  return { update, reset, dropAt, items };
}

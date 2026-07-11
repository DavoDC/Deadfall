// Weapon system: hitscan with spread bloom, recoil kick into the player's
// camera, magazine + scarce reserve ammo, distinct handling per gun.
// Damage falloff makes the shotgun a commitment and the carbine a scalpel.
//
// Round 2: aim-down-sights (hold RMB - tighter spread, slower move, zoomed
// FOV, raised sight picture), the LONGARM marksman rifle (carried empty -
// its ammunition is loot), a machete that never runs dry, and weakpoint
// multipliers routed from the enemy ray test.

import * as THREE from 'three';
import { rayStatic } from '../world/colliders.js';
import { sfxGunshot, sfxDryFire, sfxReload, sfxHitmarker, sfxMelee } from '../audio/engine.js';

export const WEAPON_DEFS = {
  carbine: {
    name: 'CARBINE',
    auto: true,
    rpm: 640,
    damage: 13,
    headMult: 1.9,
    pellets: 1,
    spreadDeg: 0.55,
    bloomPerShot: 0.5,
    bloomMax: 2.6,
    bloomRecover: 5.5,
    moveSpreadDeg: 1.1,
    kick: 0.013,
    kickYaw: 0.005,
    magSize: 30,
    startReserve: 90,
    maxReserve: 180,
    reloadTime: 1.85,
    range: 160,
    falloffStart: 60,
    minDamageFrac: 0.55,
    shellReload: false,
    adsFov: 52,
    adsSpread: 0.28,
    adsMove: 0.62,
    adsTime: 0.13,
  },
  breacher: {
    name: 'BREACHER',
    auto: false,
    rpm: 68,             // pump cycle governs real cadence
    damage: 9,
    headMult: 1.5,
    pellets: 8,
    spreadDeg: 3.6,
    bloomPerShot: 0,
    bloomMax: 0,
    bloomRecover: 8,
    moveSpreadDeg: 0.8,
    kick: 0.035,
    kickYaw: 0.010,
    magSize: 6,
    startReserve: 18,
    maxReserve: 36,
    reloadTime: 0.62,    // per shell
    range: 46,
    falloffStart: 9,
    minDamageFrac: 0.2,
    shellReload: true,
    adsFov: 62,
    adsSpread: 0.6,
    adsMove: 0.66,
    adsTime: 0.15,
  },
  longarm: {
    name: 'LONGARM',
    auto: false,
    rpm: 100,
    damage: 52,
    headMult: 2.3,
    pellets: 1,
    spreadDeg: 1.8,      // punishing from the hip...
    bloomPerShot: 0.8,
    bloomMax: 2.4,
    bloomRecover: 4,
    moveSpreadDeg: 1.6,
    kick: 0.030,
    kickYaw: 0.007,
    magSize: 8,
    startReserve: 0,     // carried empty - its ammo is LOOT
    maxReserve: 32,
    reloadTime: 2.3,
    range: 280,
    falloffStart: 150,
    minDamageFrac: 0.7,
    shellReload: false,
    adsFov: 34,          // ...surgical down the glass
    adsSpread: 0.05,
    adsMove: 0.5,
    adsTime: 0.2,
  },
};

export const MELEE = {
  name: 'MACHETE',
  damage: 42,
  range: 2.7,
  arcCos: 0.55,       // ~56 degree half-cone
  cooldown: 0.55,
  hitAt: 0.16,        // seconds into the swing when the edge lands
  swingTime: 0.34,
};

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _to = new THREE.Vector3();

export function createWeapons(camera, playerRef, hooks) {
  // hooks: { rayEnemies(origin, dir, maxDist) -> {t, enemy, zone, zoneMult, headshot}|null,
  //          onTracer(from, to), onImpact(point, kind),
  //          onEnemyHit(enemy, dmg, headshot, point, crit), onShot(),
  //          onHitmarker(kill, crit), enemiesNear() -> aliveList }
  const slots = ['carbine', 'breacher', 'longarm'];
  const state = {
    current: 'carbine',
    mag: {},
    reserve: {},
    cooldown: 0,
    reloading: 0,       // time left on current reload step
    switching: 0,
    bloom: 0,
    pumpNeeded: false,
    pumping: 0,
    lastShotAt: -10,
    adsBlend: 0,        // 0 = hip, 1 = down the sights
    aiming: false,
    meleeT: 0,          // time left on current swing
    meleeCd: 0,
    meleeDidHit: false,
    // viewmodel animation signals (consumed by viewmodel.js)
    anim: { fire: 0, reloadPhase: 0, pump: 0, raise: 0, melee: 0 },
  };
  for (const key of slots) {
    state.mag[key] = WEAPON_DEFS[key].magSize;
    state.reserve[key] = WEAPON_DEFS[key].startReserve;
  }
  state.mag.longarm = 0; // found empty: mag fills from looted ammo

  function def() {
    return WEAPON_DEFS[state.current];
  }

  function tryStartReload() {
    const d = def();
    if (state.reloading > 0 || state.switching > 0) return;
    if (state.mag[state.current] >= d.magSize) return;
    if (state.reserve[state.current] <= 0) return;
    state.reloading = d.reloadTime;
    state.anim.reloadPhase = 1;
    sfxReload(d.shellReload ? 'shell' : 'out');
  }

  function finishReloadStep() {
    const d = def();
    const key = state.current;
    if (d.shellReload) {
      state.mag[key] += 1;
      state.reserve[key] -= 1;
      sfxReload('in');
      if (state.mag[key] < d.magSize && state.reserve[key] > 0) {
        state.reloading = d.reloadTime; // chain next shell
      } else {
        state.anim.reloadPhase = 0;
      }
    } else {
      const want = d.magSize - state.mag[key];
      const take = Math.min(want, state.reserve[key]);
      state.mag[key] += take;
      state.reserve[key] -= take;
      state.anim.reloadPhase = 0;
      sfxReload('in');
    }
  }

  function switchTo(name) {
    if (name === state.current || state.switching > 0) return;
    state.current = name;
    state.switching = 0.45;
    state.reloading = 0;
    state.anim.reloadPhase = 0;
    state.anim.raise = 1;
    state.pumpNeeded = false;
    state.pumping = 0;
  }

  function fire(now) {
    const d = def();
    const key = state.current;
    if (state.mag[key] <= 0) {
      sfxDryFire();
      state.cooldown = 0.28;
      tryStartReload();
      return;
    }
    state.mag[key] -= 1;
    state.cooldown = 60 / d.rpm;
    state.lastShotAt = now;
    state.anim.fire = 1;
    if (d.shellReload) {
      state.pumpNeeded = true;
      state.pumping = 0.55;
      state.anim.pump = 1;
    }

    // recoil into the camera (ADS steadies the kick a little)
    const adsKick = 1 - state.adsBlend * 0.25;
    playerRef.p.kickPitch += d.kick * (0.85 + Math.random() * 0.3) * adsKick;
    playerRef.p.kickYaw += (Math.random() - 0.5) * 2 * d.kickYaw * adsKick;
    playerRef.p.camShake = Math.min(1, playerRef.p.camShake + 0.05);

    sfxGunshot(d.shellReload ? 'shotgun' : 'rifle');
    if (hooks.onShot) hooks.onShot();

    // spread: (base + bloom + movement), narrowed hard by ADS
    const moveFrac = Math.min(1, playerRef.p.speedNow / 6);
    const adsMult = 1 - state.adsBlend * (1 - d.adsSpread);
    const spreadRad = THREE.MathUtils.degToRad(
      (d.spreadDeg + state.bloom + d.moveSpreadDeg * moveFrac) * adsMult
    );
    state.bloom = Math.min(d.bloomMax, state.bloom + d.bloomPerShot);

    camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const origin = camera.position;

    let anyHit = false;
    let anyKill = false;
    let anyCrit = false;
    for (let i = 0; i < d.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spreadRad;
      const shotDir = _dir.clone()
        .addScaledVector(_right, Math.cos(a) * r)
        .addScaledVector(_up, Math.sin(a) * r)
        .normalize();

      // world geometry stops the ray
      const staticHit = rayStatic(origin.x, origin.y, origin.z,
        shotDir.x, shotDir.y, shotDir.z, d.range);
      const staticT = staticHit ? staticHit.t : d.range;

      // enemies closer than the wall?
      const eHit = hooks.rayEnemies
        ? hooks.rayEnemies(origin, shotDir, staticT)
        : null;

      if (eHit) {
        const dist = eHit.t;
        const fall = dist <= d.falloffStart ? 1
          : Math.max(d.minDamageFrac, 1 - (dist - d.falloffStart) / (d.range - d.falloffStart) * (1 - d.minDamageFrac));
        let dmg = d.damage * fall;
        // zone multipliers: head takes the weapon's headMult scaled by the
        // enemy's plating; crit zones carry their own multiplier
        const crit = eHit.zone === 'crit';
        if (eHit.zone === 'head') dmg *= d.headMult * eHit.zoneMult;
        else if (crit) dmg *= eHit.zoneMult;
        const point = origin.clone().addScaledVector(shotDir, dist);
        const res = hooks.onEnemyHit(eHit.enemy, dmg, eHit.headshot, point, crit);
        anyHit = true;
        if (res === 'kill') anyKill = true;
        if (crit) anyCrit = true;
        if (hooks.onTracer) hooks.onTracer(origin, point, shotDir);
        if (hooks.onImpact) hooks.onImpact(point, 'flesh');
      } else if (staticHit) {
        const point = origin.clone().addScaledVector(shotDir, staticHit.t);
        if (hooks.onTracer) hooks.onTracer(origin, point, shotDir);
        if (hooks.onImpact) hooks.onImpact(point, staticHit.kind === 'terrain' ? 'dirt' : 'wood');
      } else {
        const point = origin.clone().addScaledVector(shotDir, d.range);
        if (hooks.onTracer) hooks.onTracer(origin, point, shotDir);
      }
    }
    if (anyHit) {
      sfxHitmarker(anyKill);
      if (hooks.onHitmarker) hooks.onHitmarker(anyKill, anyCrit);
    }
  }

  // Machete swing: cone check against every living enemy - it is a panic
  // button and a silent ammo-free killer, not a rifle.
  function meleeStrike() {
    camera.getWorldDirection(_dir);
    const origin = camera.position;
    let hitAny = false;
    let kill = false;
    const list = hooks.enemiesNear ? hooks.enemiesNear() : [];
    for (const e of list) {
      _to.set(e.pos.x - origin.x, (e.pos.y + 0.8) - origin.y, e.pos.z - origin.z);
      const dist = _to.length();
      if (dist > MELEE.range + e.def.radius) continue;
      _to.normalize();
      if (_to.dot(_dir) < MELEE.arcCos) continue;
      const point = origin.clone().addScaledVector(_to, Math.max(0.3, dist - e.def.radius));
      const res = hooks.onEnemyHit(e, MELEE.damage, false, point, false);
      hitAny = true;
      if (res === 'kill') kill = true;
    }
    sfxMelee(hitAny);
    if (hitAny) {
      sfxHitmarker(kill);
      if (hooks.onHitmarker) hooks.onHitmarker(kill, false);
    }
  }

  function update(intent, dt, now) {
    const d = def();
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.switching = Math.max(0, state.switching - dt);
    state.bloom = Math.max(0, state.bloom - d.bloomRecover * dt * (d.spreadDeg * 0.15 + 0.5));
    state.anim.fire = Math.max(0, state.anim.fire - dt * 7);
    state.anim.pump = Math.max(0, state.anim.pump - dt * 2.4);
    state.anim.raise = Math.max(0, state.anim.raise - dt * 3);
    state.meleeCd = Math.max(0, state.meleeCd - dt);

    // --- aim-down-sights blend ---
    // No ADS while sprinting, switching, or mid-swing; reloading drops you
    // back to the hip. Aiming cancels sprint via the controller.
    const wantAds = !!intent.aim && state.switching <= 0 && state.reloading <= 0
      && state.meleeT <= 0 && !playerRef.p.sprinting;
    state.aiming = wantAds;
    const rate = dt / d.adsTime;
    state.adsBlend = wantAds
      ? Math.min(1, state.adsBlend + rate)
      : Math.max(0, state.adsBlend - rate * 1.4);
    // the controller reads these: ADS slows you and steadies the mouse
    playerRef.p.aimBlend = state.adsBlend;
    playerRef.p.moveMult = 1 - state.adsBlend * (1 - d.adsMove);

    // --- melee swing ---
    if (state.meleeT > 0) {
      const before = state.meleeT;
      state.meleeT -= dt;
      // the edge lands partway through the swing
      const hitMark = MELEE.swingTime - MELEE.hitAt;
      if (before > hitMark && state.meleeT <= hitMark && !state.meleeDidHit) {
        state.meleeDidHit = true;
        meleeStrike();
      }
      state.anim.melee = Math.max(0, state.meleeT / MELEE.swingTime);
    } else if (intent.melee && state.meleeCd <= 0 && state.switching <= 0) {
      state.meleeT = MELEE.swingTime;
      state.meleeCd = MELEE.cooldown;
      state.meleeDidHit = false;
      state.anim.melee = 1;
      // swinging interrupts a reload
      state.reloading = 0;
      state.anim.reloadPhase = 0;
    }

    if (state.pumping > 0) {
      state.pumping -= dt;
      if (state.pumping <= 0) {
        state.pumpNeeded = false;
        sfxReload('pump');
      }
    }

    if (state.reloading > 0) {
      state.reloading -= dt;
      if (state.reloading <= 0) {
        state.reloading = 0;
        finishReloadStep();
      }
    }

    if (intent.weapon1) switchTo('carbine');
    if (intent.weapon2) switchTo('breacher');
    if (intent.weapon3) switchTo('longarm');
    if (intent.swap) {
      const idx = slots.indexOf(state.current);
      switchTo(slots[(idx + 1) % slots.length]);
    }
    if (intent.reload) tryStartReload();

    const wantsFire = d.auto ? intent.firing : intent.fireDown;
    const canFire = state.cooldown <= 0 && state.switching <= 0
      && state.meleeT <= 0
      && !(state.pumpNeeded && state.pumping > 0)
      && !(state.reloading > 0 && !d.shellReload);

    if (wantsFire && canFire) {
      // firing interrupts shell-by-shell reload
      if (d.shellReload && state.reloading > 0) {
        if (state.mag[state.current] > 0) {
          state.reloading = 0;
          state.anim.reloadPhase = 0;
        } else {
          return;
        }
      }
      fire(now);
    }
  }

  function addAmmo(kind, amount) {
    const d = WEAPON_DEFS[kind];
    const before = state.reserve[kind];
    state.reserve[kind] = Math.min(d.maxReserve, before + amount);
    return state.reserve[kind] - before;
  }

  function reset() {
    state.current = 'carbine';
    for (const key of slots) {
      state.mag[key] = WEAPON_DEFS[key].magSize;
      state.reserve[key] = WEAPON_DEFS[key].startReserve;
    }
    state.mag.longarm = 0;
    state.cooldown = 0;
    state.reloading = 0;
    state.switching = 0;
    state.bloom = 0;
    state.pumpNeeded = false;
    state.adsBlend = 0;
    state.aiming = false;
    state.meleeT = 0;
    state.meleeCd = 0;
    state.anim.fire = 0;
    state.anim.reloadPhase = 0;
    state.anim.pump = 0;
    state.anim.raise = 0;
    state.anim.melee = 0;
  }

  return {
    state,
    def,
    update,
    addAmmo,
    reset,
    slots,
    get spreadNow() {
      const d = def();
      const moveFrac = Math.min(1, playerRef.p.speedNow / 6);
      const adsMult = 1 - state.adsBlend * (1 - d.adsSpread);
      return (d.spreadDeg + state.bloom + d.moveSpreadDeg * moveFrac) * adsMult;
    },
  };
}

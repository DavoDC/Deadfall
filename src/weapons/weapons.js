// Weapon system: hitscan with spread bloom, recoil kick into the player's
// camera, magazine + scarce reserve ammo, distinct handling per gun.
// Damage falloff makes the shotgun a commitment and the carbine a scalpel.

import * as THREE from 'three';
import { rayStatic } from '../world/colliders.js';
import { sfxGunshot, sfxDryFire, sfxReload, sfxHitmarker } from '../audio/engine.js';

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
  },
};

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function createWeapons(camera, playerRef, hooks) {
  // hooks: { rayEnemies(origin, dir, maxDist) -> {t, enemy, headshot}|null,
  //          onTracer(from, to), onImpact(point, kind, normalish),
  //          onEnemyHit(enemy, dmg, headshot, point), onShot() }
  const slots = ['carbine', 'breacher'];
  const state = {
    current: 'carbine',
    mag: { carbine: WEAPON_DEFS.carbine.magSize, breacher: WEAPON_DEFS.breacher.magSize },
    reserve: { carbine: WEAPON_DEFS.carbine.startReserve, breacher: WEAPON_DEFS.breacher.startReserve },
    cooldown: 0,
    reloading: 0,       // time left on current reload step
    switching: 0,
    bloom: 0,
    pumpNeeded: false,
    pumping: 0,
    lastShotAt: -10,
    // viewmodel animation signals (consumed by viewmodel.js)
    anim: { fire: 0, reloadPhase: 0, pump: 0, raise: 0 },
  };

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

    // recoil into the camera
    playerRef.p.kickPitch += d.kick * (0.85 + Math.random() * 0.3);
    playerRef.p.kickYaw += (Math.random() - 0.5) * 2 * d.kickYaw;
    playerRef.p.camShake = Math.min(1, playerRef.p.camShake + 0.05);

    sfxGunshot(d.shellReload ? 'shotgun' : 'rifle');
    if (hooks.onShot) hooks.onShot();

    // spread: base + bloom + movement
    const moveFrac = Math.min(1, playerRef.p.speedNow / 6);
    const spreadRad = THREE.MathUtils.degToRad(
      d.spreadDeg + state.bloom + d.moveSpreadDeg * moveFrac
    );
    state.bloom = Math.min(d.bloomMax, state.bloom + d.bloomPerShot);

    camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const origin = camera.position;

    let anyHit = false;
    let anyKill = false;
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
        if (eHit.headshot) dmg *= d.headMult;
        const point = origin.clone().addScaledVector(shotDir, dist);
        const res = hooks.onEnemyHit(eHit.enemy, dmg, eHit.headshot, point);
        anyHit = true;
        if (res === 'kill') anyKill = true;
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
      if (hooks.onHitmarker) hooks.onHitmarker(anyKill);
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
    if (intent.swap) switchTo(state.current === 'carbine' ? 'breacher' : 'carbine');
    if (intent.reload) tryStartReload();

    const wantsFire = d.auto ? intent.firing : intent.fireDown;
    const canFire = state.cooldown <= 0 && state.switching <= 0
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
    state.mag.carbine = WEAPON_DEFS.carbine.magSize;
    state.mag.breacher = WEAPON_DEFS.breacher.magSize;
    state.reserve.carbine = WEAPON_DEFS.carbine.startReserve;
    state.reserve.breacher = WEAPON_DEFS.breacher.startReserve;
    state.cooldown = 0;
    state.reloading = 0;
    state.switching = 0;
    state.bloom = 0;
    state.pumpNeeded = false;
    state.anim.fire = 0;
    state.anim.reloadPhase = 0;
    state.anim.pump = 0;
    state.anim.raise = 0;
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
      return d.spreadDeg + state.bloom + d.moveSpreadDeg * moveFrac;
    },
  };
}

// First-person character controller. Ground = exact heightfield sample;
// props = circle push-out. Movement is acceleration/friction based so it
// has weight; sprint drains stamina; swamp mud and water drag you down.

import * as THREE from 'three';
import { terrainHeight, moveSpeedFactor, blockedStep, WORLD } from '../world/heightmap.js';
import { pushOut } from '../world/colliders.js';
import { clamp, lerp } from '../core/noise.js';

const EYE_HEIGHT = 1.66;
const RADIUS = 0.42;
const GRAVITY = 22;
const JUMP_V = 6.4;
const WALK = 5.1;
const SPRINT = 7.9;
const ACCEL = 42;
const FRICTION = 11;
const AIR_CONTROL = 0.25;

export function createPlayer(camera) {
  const p = {
    pos: new THREE.Vector3(WORLD.insertion.x, 0, WORLD.insertion.z),
    vel: new THREE.Vector3(),
    yaw: 0, // face north (toward -z; camera rotation 0 looks down -z)
    pitch: 0,
    grounded: true,
    stamina: 1,
    hp: 100,
    maxHp: 100,
    alive: true,
    speedNow: 0,       // horizontal speed, for bob/audio
    bobPhase: 0,
    landImpact: 0,     // set on landing, decays; hooks camera dip + audio
    inWater: false,
    sprinting: false,
    aimBlend: 0,       // 0..1, written by weapons.update (ADS state)
    moveMult: 1,       // ADS slow, written by weapons.update
    buffT: 0,          // ayahuasca seconds remaining (sim decrements)
    sensitivity: 0.0021,
    kickPitch: 0,      // weapon recoil kick, decays
    kickYaw: 0,
    camShake: 0,
    onStep: null,      // audio hook (footstep)
    onLand: null,
    bleedoutT: 0,      // seconds remaining in bleedout state (0 = not bleeding out)
    reviveProgress: 0, // progress toward revive (0-1), reset when teammate stops holding E
  };
  p.pos.y = terrainHeight(p.pos.x, p.pos.z) + EYE_HEIGHT;

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();

  function update(intent, dt) {
    if (!p.alive) return;

    // --- look (ADS steadies the hand) ---
    const sens = p.sensitivity * (1 - p.aimBlend * 0.45);
    p.yaw -= intent.lookDX * sens;
    p.pitch -= intent.lookDY * sens;
    p.pitch = clamp(p.pitch, -1.45, 1.45);

    // recoil kick decays back
    p.kickPitch = lerp(p.kickPitch, 0, Math.min(1, dt * 9));
    p.kickYaw = lerp(p.kickYaw, 0, Math.min(1, dt * 9));

    // --- movement basis (yaw only) ---
    fwd.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    right.set(-fwd.z, 0, fwd.x);
    wish.set(0, 0, 0);
    wish.addScaledVector(fwd, -intent.moveZ);
    wish.addScaledVector(right, intent.moveX);
    if (wish.lengthSq() > 1) wish.normalize();

    const moving = wish.lengthSq() > 0.01;
    // aiming cancels sprint; the vine (ayahuasca) makes sprint free
    const wantSprint = intent.sprint && moving && intent.moveZ < 0
      && p.stamina > 0.05 && !intent.aim;
    p.sprinting = wantSprint;
    if (wantSprint && p.buffT <= 0) p.stamina = Math.max(0, p.stamina - dt * 0.22);
    else p.stamina = Math.min(1, p.stamina + dt * 0.14);

    const terrainFactor = moveSpeedFactor(p.pos.x, p.pos.z);
    const buffMult = p.buffT > 0 ? 1.22 : 1;
    const targetSpeed = (wantSprint ? SPRINT : WALK) * terrainFactor * p.moveMult * buffMult;

    // --- integrate horizontal velocity ---
    const control = p.grounded ? 1 : AIR_CONTROL;
    p.vel.x += wish.x * ACCEL * control * dt;
    p.vel.z += wish.z * ACCEL * control * dt;
    if (p.grounded) {
      const f = Math.max(0, 1 - FRICTION * dt);
      if (!moving) {
        p.vel.x *= f;
        p.vel.z *= f;
      }
    }
    const hSpeed = Math.hypot(p.vel.x, p.vel.z);
    if (hSpeed > targetSpeed) {
      const s = targetSpeed / hSpeed;
      p.vel.x *= s;
      p.vel.z *= s;
    }
    p.speedNow = Math.hypot(p.vel.x, p.vel.z);

    // --- jump + gravity ---
    if (intent.jump && p.grounded && !p.inWater) {
      p.vel.y = JUMP_V;
      p.grounded = false;
    }
    p.vel.y -= GRAVITY * dt;

    // --- the round-3 movement law: cliffs and thicket are WALLS ---
    // Reject horizontal motion onto unclimbable grade / strangler growth,
    // with axis-separated fallback so you slide along the wall face.
    const hv = Math.hypot(p.vel.x, p.vel.z);
    if (hv > 0.01) {
      const feetY = p.pos.y - EYE_HEIGHT;
      if (blockedStep(p.pos.x, p.pos.z, p.vel.x / hv, p.vel.z / hv, feetY)) {
        const sx = Math.sign(p.vel.x);
        const sz = Math.sign(p.vel.z);
        if (sx !== 0 && !blockedStep(p.pos.x, p.pos.z, sx, 0, feetY)) {
          p.vel.z = 0;
        } else if (sz !== 0 && !blockedStep(p.pos.x, p.pos.z, 0, sz, feetY)) {
          p.vel.x = 0;
        } else {
          p.vel.x = 0;
          p.vel.z = 0;
        }
      }
    }

    // --- integrate position ---
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    p.pos.y += p.vel.y * dt;

    // props push-out (feet circle)
    pushOut(p.pos, RADIUS, p.pos.y - EYE_HEIGHT);

    // ground clamp
    const ground = terrainHeight(p.pos.x, p.pos.z) + EYE_HEIGHT;
    if (p.pos.y <= ground) {
      if (!p.grounded && p.vel.y < -7) {
        p.landImpact = Math.min(1, -p.vel.y / 16);
        if (p.onLand) p.onLand(p.landImpact);
      }
      p.pos.y = ground;
      p.vel.y = 0;
      p.grounded = true;
    } else if (p.pos.y > ground + 0.05) {
      p.grounded = false;
    }

    const feetY = p.pos.y - EYE_HEIGHT;
    p.inWater = feetY < WORLD.waterLevel - 0.25;

    // --- head bob + footsteps ---
    if (p.grounded && p.speedNow > 0.5) {
      const stride = p.sprinting ? 5.4 : 4.4;
      const prev = p.bobPhase;
      p.bobPhase += dt * p.speedNow * (Math.PI * 2) / stride;
      if (Math.floor(p.bobPhase / Math.PI) > Math.floor(prev / Math.PI)) {
        if (p.onStep) p.onStep(p.inWater, p.sprinting);
      }
    }
    p.landImpact = Math.max(0, p.landImpact - dt * 3);
    p.camShake = Math.max(0, p.camShake - dt * 4);

    // --- write camera ---
    const bobY = Math.sin(p.bobPhase * 2) * 0.035 * Math.min(1, p.speedNow / WALK);
    const bobX = Math.sin(p.bobPhase) * 0.02 * Math.min(1, p.speedNow / WALK);
    const dip = -p.landImpact * 0.22;
    const shake = p.camShake;
    camera.position.set(
      p.pos.x + bobX * Math.cos(p.yaw) + (Math.random() - 0.5) * shake * 0.05,
      p.pos.y + bobY + dip + (Math.random() - 0.5) * shake * 0.05,
      p.pos.z + bobX * Math.sin(p.yaw) + (Math.random() - 0.5) * shake * 0.05
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = p.yaw + p.kickYaw;
    camera.rotation.x = p.pitch + p.kickPitch;
    camera.rotation.z = Math.sin(p.bobPhase) * 0.0035 * Math.min(1, p.speedNow / WALK);
  }

  function damage(amount) {
    if (!p.alive || p.bleedoutT > 0) return; // can't damage while bleeding out
    p.hp = Math.max(0, p.hp - amount);
    p.camShake = Math.min(1, p.camShake + amount * 0.02);
    if (p.hp <= 0) {
      p.alive = false; // hp=0 triggers bleedout (managed by sim)
    }
  }

  function heal(amount) {
    p.hp = Math.min(p.maxHp, p.hp + amount);
  }

  function reset() {
    p.pos.set(WORLD.insertion.x, 0, WORLD.insertion.z);
    p.pos.y = terrainHeight(p.pos.x, p.pos.z) + EYE_HEIGHT;
    p.vel.set(0, 0, 0);
    p.yaw = 0;
    p.pitch = 0;
    p.hp = p.maxHp;
    p.alive = true;
    p.stamina = 1;
    p.kickPitch = 0;
    p.kickYaw = 0;
    p.camShake = 0;
    p.aimBlend = 0;
    p.moveMult = 1;
    p.buffT = 0;
    p.bleedoutT = 0;
    p.reviveProgress = 0;
  }

  return { p, update, damage, heal, reset, EYE_HEIGHT, RADIUS };
}

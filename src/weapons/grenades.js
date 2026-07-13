// Frag grenades - the second tactical verb. Hold G to raise (a dotted arc
// previews the throw against real physics), release to commit. Grenades
// bounce off terrain, cook on a fixed fuse from release, and detonate with
// area damage that does not care whose side you are on. Explosions are LOUD:
// the director hears them.

import * as THREE from 'three';
import { terrainHeight, WORLD } from '../world/heightmap.js';
import { sfxThrow, sfxExplosion } from '../audio/engine.js';

const POOL = 6;
const PREVIEW_DOTS = 16;
const GRAVITY = 14;
const THROW_SPEED = 17;
const THROW_UP = 3.6;
const FUSE = 2.1;
const RESTITUTION = 0.38;
const RADIUS = 6.5;
const DAMAGE = 95;
const SELF_DAMAGE = 60;

export function createGrenades(scene, camera, playerRef, effects, hooks) {
  // hooks: { enemies() -> aliveList, damageEnemy(e, dmg, point),
  //          damagePlayer(amount, srcPos), onNoise(mult), toast(msg) }
  const state = { count: 2, max: 4 };

  const nadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const nadeMat = new THREE.MeshStandardMaterial({ color: 0x2c3226, roughness: 0.5, metalness: 0.3 });
  const nades = [];
  for (let i = 0; i < POOL; i++) {
    const m = new THREE.Mesh(nadeGeo, nadeMat);
    m.visible = false;
    m.castShadow = true;
    scene.add(m);
    nades.push({ mesh: m, vel: new THREE.Vector3(), alive: false, fuse: 0 });
  }

  // arc preview: pooled additive dots
  const dotGeo = new THREE.SphereGeometry(0.05, 6, 5);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffe8a0, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dots = [];
  for (let i = 0; i < PREVIEW_DOTS; i++) {
    const m = new THREE.Mesh(dotGeo, dotMat);
    m.visible = false;
    scene.add(m);
    dots.push(m);
  }

  // explosion light (single, pooled - two explosions in the same 300ms share)
  const boomLight = new THREE.PointLight(0xffb040, 0, 30);
  scene.add(boomLight);
  let boomT = 0;

  const _dir = new THREE.Vector3();
  const _v = new THREE.Vector3();

  function throwOrigin(out) {
    camera.getWorldDirection(_dir);
    out.copy(camera.position).addScaledVector(_dir, 0.4);
    out.y -= 0.15;
    return out;
  }

  function throwVelocity(out) {
    camera.getWorldDirection(_dir);
    out.copy(_dir).multiplyScalar(THROW_SPEED);
    out.y += THROW_UP;
    // a little of your own momentum rides along
    out.addScaledVector(playerRef.p.vel, 0.35);
    return out;
  }

  function explode(pos) {
    effects.burst(pos, 'boom', 26, 9);
    effects.burst(pos, 'spark', 12, 12);
    sfxExplosion(pos);
    boomLight.position.copy(pos);
    boomLight.position.y += 1;
    boomLight.intensity = 60;
    boomT = 0.3;
    if (hooks.onNoise) hooks.onNoise(4); // the jungle HEARD that

    // enemies
    for (const e of hooks.enemies()) {
      const d = _v.set(e.pos.x - pos.x, (e.pos.y + 0.8) - pos.y, e.pos.z - pos.z).length();
      if (d < RADIUS + e.def.radius) {
        const frac = Math.max(0.25, 1 - d / RADIUS);
        const point = _v.copy(e.pos);
        point.y += 0.8;
        hooks.damageEnemy(e, DAMAGE * frac, point);
      }
    }
    // the thrower is not exempt
    const pd = _v.subVectors(playerRef.p.pos, pos).length();
    if (pd < RADIUS * 0.8) {
      const frac = Math.max(0.15, 1 - pd / (RADIUS * 0.8));
      hooks.damagePlayer(SELF_DAMAGE * frac, pos);
    }
    playerRef.p.camShake = Math.min(1, playerRef.p.camShake + Math.max(0, 0.7 - pd * 0.04));
  }

  function throwNade() {
    if (state.count <= 0) {
      if (hooks.toast) hooks.toast('NO GRENADES');
      return false;
    }
    const g = nades.find((n) => !n.alive);
    if (!g) return false;
    state.count -= 1;
    g.alive = true;
    g.fuse = FUSE;
    g.mesh.visible = true;
    throwOrigin(g.mesh.position);
    throwVelocity(g.vel);
    sfxThrow();
    return true;
  }

  function updatePreview(show) {
    if (!show) {
      for (const d of dots) d.visible = false;
      return;
    }
    // simulate the real physics forward in fixed steps
    const p = throwOrigin(_v.clone());
    const v = throwVelocity(new THREE.Vector3());
    const step = 0.09;
    for (let i = 0; i < PREVIEW_DOTS; i++) {
      for (let s = 0; s < 2; s++) {
        v.y -= GRAVITY * step * 0.5;
        p.addScaledVector(v, step * 0.5);
        const ground = terrainHeight(p.x, p.z) + 0.1;
        if (p.y < ground) {
          p.y = ground;
          v.y = Math.abs(v.y) * RESTITUTION;
          v.x *= 0.6;
          v.z *= 0.6;
        }
      }
      dots[i].position.copy(p);
      dots[i].visible = true;
      dots[i].scale.setScalar((1 - i / PREVIEW_DOTS * 0.6) * 1.6);
    }
  }

  function update(intent, dt) {
    // hold = preview, release edge = throw
    updatePreview(!!intent.grenadeHold && state.count > 0);
    if (intent.grenadeThrow) throwNade();

    for (const g of nades) {
      if (!g.alive) continue;
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      const p = g.mesh.position;
      const ground = terrainHeight(p.x, p.z) + 0.09;
      if (p.y < ground) {
        p.y = ground;
        if (Math.abs(g.vel.y) > 1.5) {
          g.vel.y = Math.abs(g.vel.y) * RESTITUTION;
          g.vel.x *= 0.6;
          g.vel.z *= 0.6;
        } else {
          g.vel.set(0, 0, 0);
        }
      }
      if (g.fuse <= 0) {
        g.alive = false;
        g.mesh.visible = false;
        explode(p);
      }
    }

    if (boomT > 0) {
      boomT -= dt;
      boomLight.intensity = Math.max(0, boomT / 0.3) * 60;
    }
  }

  function add(n) {
    const before = state.count;
    state.count = Math.min(state.max, state.count + n);
    return state.count - before;
  }

  function reset(startCount) {
    state.count = startCount;
    for (const g of nades) {
      g.alive = false;
      g.mesh.visible = false;
    }
    for (const d of dots) d.visible = false;
    boomLight.intensity = 0;
  }

  return { update, add, reset, state };
}

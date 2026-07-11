// Enemy manager: spawning, AI, steering, attacks, hit detection, deaths,
// and the spitter's acid projectiles. Every enemy is a hunter - the director
// spawns them because of you, and they advance with intent (pillar 4).
//
// AI is a per-type state machine over a shared chassis:
//   hunt -> (in range) attack behaviors -> windup -> strike/lunge/charge
//   any -> dying -> removed
// Perception: refreshed player fix every few seconds (noisy), exact on LOS.

import * as THREE from 'three';
import { BUILDERS } from './models.js';
import { terrainHeight, moveSpeedFactor, WORLD } from '../world/heightmap.js';
import { pushOut, hasLOS } from '../world/colliders.js';
import { clamp, lerp } from '../core/noise.js';
import { sfxCreature, sfxAcidSpit, sfxAcidSplat } from '../audio/engine.js';

export const ENEMY_DEFS = {
  prowler: {
    hp: 55,
    speed: 6.6,
    turnRate: 5.5,
    aggroSight: 30,
    attackRange: 2.3,
    windup: 0.32,
    strikeDamage: 14,
    strikeCooldown: 1.15,
    lungeSpeed: 13.5,
    lungeTime: 0.32,
    zigzag: 0.55,
    callEvery: [2.6, 4.8],
    radius: 0.5,
    xp: 1,
  },
  spitter: {
    hp: 85,
    speed: 3.4,
    turnRate: 3.2,
    aggroSight: 34,
    attackRange: 26,     // spit range
    keepMin: 13,         // backs away inside this
    windup: 0.62,
    spitCooldown: [2.6, 3.8],
    spitSpeed: 17,
    spitDamage: 13,
    splashRadius: 2.4,
    biteDamage: 7,
    callEvery: [3.5, 6],
    radius: 0.5,
    xp: 2,
  },
  juggernaut: {
    hp: 430,
    speed: 2.5,
    turnRate: 2.2,
    aggroSight: 30,
    attackRange: 3.0,
    windup: 0.5,
    strikeDamage: 30,
    strikeCooldown: 1.6,
    chargeSpeed: 9.5,
    chargeWindup: 0.85,
    chargeTime: 2.4,
    chargeDamage: 38,
    chargeCooldown: 7,
    callEvery: [5, 9],
    radius: 1.0,
    xp: 5,
  },
};

const GLOB_POOL = 14;

export function createEnemyManager(scene, playerRef, effects, hooks) {
  // hooks: { damagePlayer(amount, srcPos), onKill(type) }
  const enemies = [];
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  // ---- acid globs ----
  const globGeo = new THREE.SphereGeometry(0.16, 8, 6);
  const globMat = new THREE.MeshStandardMaterial({
    color: 0x9fe040, emissive: 0x70b520, emissiveIntensity: 2.4,
  });
  const globs = [];
  for (let i = 0; i < GLOB_POOL; i++) {
    const m = new THREE.Mesh(globGeo, globMat);
    m.visible = false;
    scene.add(m);
    globs.push({ mesh: m, vel: new THREE.Vector3(), alive: false, age: 0 });
  }

  function throwGlob(from, target) {
    const g = globs.find((x) => !x.alive);
    if (!g) return;
    g.alive = true;
    g.age = 0;
    g.mesh.visible = true;
    g.mesh.position.copy(from);
    // lob: aim at target with lead + upward arc
    const d = _v.subVectors(target, from);
    const dist = Math.hypot(d.x, d.z);
    const def = ENEMY_DEFS.spitter;
    const t = clamp(dist / def.spitSpeed, 0.3, 1.6);
    g.vel.set(d.x / t, d.y / t + 0.5 * 9.5 * t, d.z / t);
    sfxAcidSpit(from);
  }

  function updateGlobs(dt) {
    for (const g of globs) {
      if (!g.alive) continue;
      g.age += dt;
      g.vel.y -= 9.5 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      const p = g.mesh.position;
      const hitGround = p.y < terrainHeight(p.x, p.z) + 0.1;
      const toPlayer = _v.subVectors(playerRef.p.pos, p).length();
      const directHit = toPlayer < 1.1;
      if (hitGround || directHit || g.age > 6) {
        if (hitGround || directHit) {
          effects.burst(p, 'acid', 10, 4);
          sfxAcidSplat(p);
          const def = ENEMY_DEFS.spitter;
          const splash = _v.subVectors(playerRef.p.pos, p).length();
          if (splash < def.splashRadius) {
            const frac = directHit ? 1 : 1 - splash / def.splashRadius * 0.6;
            hooks.damagePlayer(def.spitDamage * frac, p);
          }
        }
        g.alive = false;
        g.mesh.visible = false;
      }
    }
  }

  // ---- enemy lifecycle ----
  function spawn(type, x, z) {
    let e = enemies.find((en) => en.dead && en.type === type);
    if (!e) {
      const model = BUILDERS[type]();
      e = { type, model };
      scene.add(model.group);
      enemies.push(e);
    }
    const def = ENEMY_DEFS[type];
    e.def = def;
    e.hp = def.hp;
    e.dead = false;
    e.dying = 0;
    e.state = 'hunt';
    e.stateT = 0;
    e.pos = e.pos || new THREE.Vector3();
    e.pos.set(x, terrainHeight(x, z), z);
    e.heading = Math.random() * Math.PI * 2;
    e.walkPhase = Math.random() * 10;
    e.attackCd = 0;
    e.chargeCd = type === 'juggernaut' ? 3 : 0;
    e.losTimer = Math.random() * 0.35;
    e.hasLOS = false;
    e.fix = new THREE.Vector3().copy(playerRef.p.pos); // last known player pos
    e.fixTimer = 0;
    e.callTimer = 1 + Math.random() * 3;
    e.zigPhase = Math.random() * 10;
    e.flash = 0;
    e.lungeVec = e.lungeVec || new THREE.Vector3();
    e.model.group.visible = true;
    e.model.group.position.copy(e.pos);
    e.model.group.rotation.set(0, e.heading, 0);
    e.model.group.scale.setScalar(type === 'juggernaut' ? 1 : 0.9 + Math.random() * 0.25);
    return e;
  }

  function die(e) {
    e.state = 'dying';
    e.dying = 0;
    e.stateT = 0;
    if (hooks.onKill) hooks.onKill(e.type, e.pos);
    sfxCreature(e.type, e.pos, 1.4);
  }

  function applyDamage(e, dmg, headshot, point) {
    if (e.dead || e.state === 'dying') return 'dead';
    e.hp -= dmg;
    e.flash = 1;
    effects.burst(point, 'flesh', headshot ? 10 : 6, 2.6);
    // getting shot reveals the player exactly
    e.fix.copy(playerRef.p.pos);
    if (e.hp <= 0) {
      die(e);
      return 'kill';
    }
    return 'hit';
  }

  // ---- per-type behaviors ----
  function moveToward(e, target, speed, dt, zigzag = 0) {
    const dx = target.x - e.pos.x;
    const dz = target.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return dist;
    let want = Math.atan2(dx, dz);
    if (zigzag > 0 && dist > 7) {
      want += Math.sin(performance.now() / 1000 * 2.6 + e.zigPhase) * zigzag;
    }
    // separation from other enemies
    let sepX = 0;
    let sepZ = 0;
    for (const o of enemies) {
      if (o === e || o.dead || o.state === 'dying') continue;
      const ox = e.pos.x - o.pos.x;
      const oz = e.pos.z - o.pos.z;
      const od2 = ox * ox + oz * oz;
      const minD = e.def.radius + o.def.radius + 0.6;
      if (od2 < minD * minD && od2 > 1e-6) {
        const od = Math.sqrt(od2);
        sepX += ox / od * (minD - od);
        sepZ += oz / od * (minD - od);
      }
    }
    // smooth turn toward desired heading
    let dh = want - e.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    e.heading += clamp(dh, -e.def.turnRate * dt, e.def.turnRate * dt);

    const sf = moveSpeedFactor(e.pos.x, e.pos.z);
    const v = speed * sf;
    e.pos.x += (Math.sin(e.heading) * v + sepX * 2.2) * dt;
    e.pos.z += (Math.cos(e.heading) * v + sepZ * 2.2) * dt;
    pushOut(e.pos, e.def.radius, e.pos.y);
    e.pos.y = terrainHeight(e.pos.x, e.pos.z);
    e.walkPhase += dt * v * 2.2;
    return dist;
  }

  function updatePerception(e, dt) {
    e.losTimer -= dt;
    if (e.losTimer <= 0) {
      e.losTimer = 0.28 + Math.random() * 0.12;
      const eye = _v.set(e.pos.x, e.pos.y + 1.2, e.pos.z);
      const pp = playerRef.p.pos;
      e.hasLOS = hasLOS(eye.x, eye.y, eye.z, pp.x, pp.y, pp.z);
    }
    e.fixTimer -= dt;
    if (e.hasLOS) {
      e.fix.copy(playerRef.p.pos);
      e.fixTimer = 0.5;
    } else if (e.fixTimer <= 0) {
      // hunters re-acquire a noisy fix periodically - they track, not teleport
      e.fixTimer = 2.4 + Math.random() * 1.2;
      e.fix.set(
        playerRef.p.pos.x + (Math.random() - 0.5) * 9,
        playerRef.p.pos.y,
        playerRef.p.pos.z + (Math.random() - 0.5) * 9
      );
    }
  }

  function creatureCall(e, dt, distToPlayer) {
    e.callTimer -= dt;
    if (e.callTimer <= 0) {
      const [a, b] = e.def.callEvery;
      e.callTimer = a + Math.random() * (b - a);
      const intensity = clamp(1.6 - distToPlayer / 40, 0.35, 1.3);
      sfxCreature(e.type, e.pos, intensity);
    }
  }

  function updateProwler(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);
    e.attackCd = Math.max(0, e.attackCd - dt);

    if (e.state === 'hunt') {
      moveToward(e, e.fix, e.def.speed, dt, e.def.zigzag);
      if (dist < e.def.attackRange + 0.4 && e.attackCd <= 0) {
        e.state = 'windup';
        e.stateT = 0;
        sfxCreature('prowler', e.pos, 1.5);
      }
    } else if (e.state === 'windup') {
      e.stateT += dt;
      // crouch aim at player
      moveToward(e, pp, 0.4, dt);
      if (e.stateT >= e.def.windup) {
        e.state = 'lunge';
        e.stateT = 0;
        _v2.subVectors(pp, e.pos);
        _v2.y = 0;
        _v2.normalize();
        e.lungeVec.copy(_v2);
      }
    } else if (e.state === 'lunge') {
      e.stateT += dt;
      e.pos.x += e.lungeVec.x * e.def.lungeSpeed * dt;
      e.pos.z += e.lungeVec.z * e.def.lungeSpeed * dt;
      pushOut(e.pos, e.def.radius, e.pos.y);
      e.pos.y = terrainHeight(e.pos.x, e.pos.z);
      const d2 = _v.subVectors(pp, e.pos).length();
      if (d2 < 1.6) {
        hooks.damagePlayer(e.def.strikeDamage, e.pos);
        e.state = 'hunt';
        e.attackCd = e.def.strikeCooldown;
      } else if (e.stateT > e.def.lungeTime) {
        e.state = 'hunt';
        e.attackCd = e.def.strikeCooldown * 0.6;
      }
    }
  }

  function updateSpitter(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);
    e.attackCd = Math.max(0, e.attackCd - dt);

    if (e.state === 'hunt') {
      if (dist > e.def.attackRange * 0.8 || !e.hasLOS) {
        moveToward(e, e.fix, e.def.speed, dt);
      } else if (dist < e.def.keepMin) {
        // back away, keep facing player
        _v2.set(e.pos.x * 2 - pp.x, 0, e.pos.z * 2 - pp.z);
        moveToward(e, _v2, e.def.speed * 0.85, dt);
      }
      if (dist < 2.2 && e.attackCd <= 0) {
        hooks.damagePlayer(e.def.biteDamage, e.pos);
        e.attackCd = 1.4;
      } else if (dist < e.def.attackRange && e.hasLOS && e.attackCd <= 0) {
        e.state = 'windup';
        e.stateT = 0;
        sfxCreature('spitter', e.pos, 1.2);
      }
    } else if (e.state === 'windup') {
      e.stateT += dt;
      // sacs brighten - the readable tell
      for (const sac of e.model.refs.sacs) {
        sac.material.emissiveIntensity = 1.6 + (e.stateT / e.def.windup) * 4;
      }
      if (e.stateT >= e.def.windup) {
        for (const sac of e.model.refs.sacs) sac.material.emissiveIntensity = 1.6;
        _v2.set(e.pos.x, e.pos.y + 1.35, e.pos.z);
        throwGlob(_v2, playerRef.p.pos);
        e.state = 'hunt';
        const [a, b] = e.def.spitCooldown;
        e.attackCd = a + Math.random() * (b - a);
      }
    }
  }

  function updateJuggernaut(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.chargeCd = Math.max(0, e.chargeCd - dt);

    if (e.state === 'hunt') {
      moveToward(e, e.fix, e.def.speed, dt);
      if (dist < e.def.attackRange && e.attackCd <= 0) {
        e.state = 'windup';
        e.stateT = 0;
      } else if (dist > 9 && dist < 32 && e.hasLOS && e.chargeCd <= 0) {
        e.state = 'chargewind';
        e.stateT = 0;
        sfxCreature('juggernaut', e.pos, 1.5);
      }
    } else if (e.state === 'windup') {
      e.stateT += dt;
      if (e.stateT >= e.def.windup) {
        const d2 = _v.subVectors(pp, e.pos).length();
        if (d2 < e.def.attackRange + 0.7) {
          hooks.damagePlayer(e.def.strikeDamage, e.pos);
          // knockback
          _v2.subVectors(pp, e.pos).setY(0).normalize();
          playerRef.p.vel.addScaledVector(_v2, 9);
          playerRef.p.vel.y = 3.5;
        }
        e.state = 'hunt';
        e.attackCd = e.def.strikeCooldown;
      }
    } else if (e.state === 'chargewind') {
      e.stateT += dt;
      // rear up, face player
      moveToward(e, pp, 0.2, dt);
      if (e.stateT >= e.def.chargeWindup) {
        e.state = 'charge';
        e.stateT = 0;
        _v2.subVectors(pp, e.pos).setY(0).normalize();
        e.lungeVec = e.lungeVec || new THREE.Vector3();
        e.lungeVec.copy(_v2);
      }
    } else if (e.state === 'charge') {
      e.stateT += dt;
      const before = _v2.set(e.pos.x, 0, e.pos.z);
      e.pos.x += e.lungeVec.x * e.def.chargeSpeed * dt;
      e.pos.z += e.lungeVec.z * e.def.chargeSpeed * dt;
      const blocked = pushOut(e.pos, e.def.radius, e.pos.y);
      e.pos.y = terrainHeight(e.pos.x, e.pos.z);
      e.walkPhase += dt * 14;
      const d2 = _v.subVectors(pp, e.pos).length();
      if (d2 < 2.6) {
        hooks.damagePlayer(e.def.chargeDamage, e.pos);
        _v2.subVectors(pp, e.pos).setY(0).normalize();
        playerRef.p.vel.addScaledVector(_v2, 13);
        playerRef.p.vel.y = 4.5;
        e.state = 'hunt';
        e.chargeCd = e.def.chargeCooldown;
        e.attackCd = 1;
      } else if (blocked && e.stateT > 0.3) {
        // slammed into a tree - stunned, your window
        e.state = 'stunned';
        e.stateT = 0;
        playerRef.p.camShake = Math.min(1, playerRef.p.camShake + 0.4);
        effects.burst(_v.set(e.pos.x, e.pos.y + 1.5, e.pos.z), 'wood', 12, 5);
        sfxCreature('juggernaut', e.pos, 1.2);
        e.chargeCd = e.def.chargeCooldown;
      } else if (e.stateT > e.def.chargeTime) {
        e.state = 'hunt';
        e.chargeCd = e.def.chargeCooldown;
      }
    } else if (e.state === 'stunned') {
      e.stateT += dt;
      if (e.stateT > 1.6) e.state = 'hunt';
    }
  }

  const TYPE_UPDATE = {
    prowler: updateProwler,
    spitter: updateSpitter,
    juggernaut: updateJuggernaut,
  };

  // ---- animation ----
  function animate(e, dt) {
    const g = e.model.group;
    const refs = e.model.refs;
    g.position.copy(e.pos);

    if (e.state === 'dying') {
      e.dying += dt;
      g.rotation.z = Math.min(Math.PI / 2, e.dying * 3.2);
      if (e.dying > 1.2) g.position.y = e.pos.y - (e.dying - 1.2) * 0.5;
      if (e.dying > 2.6) {
        e.dead = true;
        g.visible = false;
      }
      return;
    }

    g.rotation.y = e.heading;
    g.rotation.z = 0;

    // hit flash
    if (e.flash > 0) {
      e.flash = Math.max(0, e.flash - dt * 6);
      const f = e.flash;
      g.traverse((o) => {
        if (o.isMesh && o.material.emissive && o.material !== undefined) {
          o.material._baseEI = o.material._baseEI ?? o.material.emissiveIntensity ?? 0;
        }
      });
      // cheap flash: scale pulse instead of touching shared materials
      const s = g.scale.x;
      g.scale.setScalar(s + f * 0.02);
    }

    // walk cycle
    const swing = Math.sin(e.walkPhase);
    if (refs.legs) {
      refs.legs.forEach((leg, i) => {
        leg.rotation.x = swing * 0.55 * (i % 2 === 0 ? 1 : -1);
      });
    }
    // body bob + type-specific flourish
    const bob = Math.abs(Math.sin(e.walkPhase)) * 0.05;
    if (e.type === 'prowler') {
      refs.body.position.y = 0.62 + bob;
      if (e.state === 'windup') {
        refs.body.position.y = 0.45;
        refs.body.rotation.x = -0.15;
      } else {
        refs.body.rotation.x = 0;
      }
    } else if (e.type === 'spitter') {
      refs.torso.position.y = 1.05 + bob;
      refs.torso.rotation.x = e.state === 'windup' ? 0.55 + e.stateT * 0.4 : 0.55;
    } else {
      refs.torso.position.y = 1.55 + bob * 1.6;
      if (e.state === 'chargewind') {
        refs.torso.rotation.x = -0.35; // rear up
        refs.arms.forEach((a) => { a.rotation.z = a.position.x > 0 ? -0.9 : 0.9; });
      } else if (e.state === 'stunned') {
        refs.torso.rotation.x = 0.3;
        g.rotation.z = Math.sin(performance.now() / 90) * 0.05;
      } else {
        refs.torso.rotation.x = 0;
        refs.arms.forEach((a) => {
          a.rotation.z = (a.position.x > 0 ? -0.15 : 0.15) + swing * 0.3 * (a.position.x > 0 ? 1 : -1);
        });
      }
    }
  }

  // ---- public API ----
  function update(dt) {
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.state !== 'dying') {
        updatePerception(e, dt);
        TYPE_UPDATE[e.type](e, dt);
      }
      animate(e, dt);
    }
    updateGlobs(dt);
  }

  // ray vs head/body spheres of every living enemy; nearest hit wins
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const ex = ox - cx;
    const ey = oy - cy;
    const ez = oz - cz;
    const b = ex * dx + ey * dy + ez * dz;
    const c = ex * ex + ey * ey + ez * ez - r * r;
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : Infinity;
  }

  const _head = new THREE.Vector3();
  const _body = new THREE.Vector3();

  function rayEnemies(origin, dir, maxDist) {
    let best = maxDist;
    let bestEnemy = null;
    let bestHead = false;
    for (const e of enemies) {
      if (e.dead || e.state === 'dying') continue;
      const s = e.model.group.scale.x;
      _head.copy(e.model.headOffset).multiplyScalar(s);
      rotateY(_head, e.heading);
      _head.add(e.pos);
      _body.copy(e.model.bodyOffset).multiplyScalar(s);
      rotateY(_body, e.heading);
      _body.add(e.pos);

      const tH = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        _head.x, _head.y, _head.z, e.model.headR * s);
      if (tH < best) {
        best = tH;
        bestEnemy = e;
        bestHead = true;
        continue;
      }
      const tB = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
        _body.x, _body.y, _body.z, e.model.bodyR * s);
      if (tB < best) {
        best = tB;
        bestEnemy = e;
        bestHead = false;
      }
    }
    return bestEnemy ? { t: best, enemy: bestEnemy, headshot: bestHead } : null;
  }

  function rotateY(v, ang) {
    const s = Math.sin(ang);
    const c = Math.cos(ang);
    const x = v.x * c + v.z * s;
    const z = -v.x * s + v.z * c;
    v.x = x;
    v.z = z;
  }

  function aliveCount() {
    let n = 0;
    for (const e of enemies) if (!e.dead && e.state !== 'dying') n++;
    return n;
  }

  function aliveList() {
    return enemies.filter((e) => !e.dead && e.state !== 'dying');
  }

  function reset() {
    for (const e of enemies) {
      e.dead = true;
      e.model.group.visible = false;
    }
    for (const g of globs) {
      g.alive = false;
      g.mesh.visible = false;
    }
  }

  return { update, spawn, applyDamage, rayEnemies, aliveCount, aliveList, reset, enemies };
}

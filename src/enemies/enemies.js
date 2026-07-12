// Enemy manager: spawning, AI, steering, attacks, hit detection, deaths,
// and the spitter's acid projectiles. Every enemy is a hunter - the director
// spawns them because of you, and they advance with intent (pillar 4).
//
// AI is a per-type state machine over a shared chassis:
//   hunt -> (in range) attack behaviors -> windup -> strike/lunge/charge
//   any -> dying -> removed
// Perception: refreshed player fix every few seconds (noisy), exact on LOS.
//
// Round 2 additions:
//   - STINGERWING: flying swarm - weak alone, a blizzard in numbers
//   - CANOPY SHRIKE: ballistic leaper - only dangerous airborne, gawky on
//     the ground; its pounce arc is dodgeable
//   - BLOOMCALLER: summoner - screams the jungle down on you until killed;
//     its core is a crit zone only while the petals are open
//   - Spitter ENRAGE: swells and speeds up as it takes fire (end fights
//     fast or they end you)
//   - Prowler pack flanking: pairs curve in from both sides
//   - Player separation: enemies can no longer clip through you
//   - Weakpoints: per-enemy crit spheres (sacs, the juggernaut's back boil)

import * as THREE from 'three';
import { BUILDERS } from './models.js';
import { terrainHeight, moveSpeedFactor, blockedStep, isThicket, WORLD } from '../world/heightmap.js';
import { pushOut, hasLOS } from '../world/colliders.js';
import { clamp, lerp } from '../core/noise.js';
import { sfxCreature, sfxAcidSpit, sfxAcidSplat, sfxBloomPulse } from '../audio/engine.js';

export const ENEMY_DEFS = {
  prowler: {
    hp: 55,
    speed: 6.6,
    turnRate: 5.5,
    attackRange: 2.6,
    windup: 0.24,
    strikeDamage: 14,
    strikeCooldown: 1.0,
    lungeSpeed: 15.5,
    lungeTime: 0.34,
    zigzag: 0.55,
    callEvery: [2.6, 4.8],
    radius: 0.5,
    eyeH: 0.8,
  },
  spitter: {
    hp: 85,
    speed: 3.4,
    turnRate: 3.2,
    attackRange: 26,     // spit range
    keepMin: 13,         // backs away inside this
    windup: 0.62,
    spitCooldown: [2.6, 3.8],
    spitSpeed: 17,
    spitDamage: 11,
    splashRadius: 2.2,
    biteDamage: 7,
    callEvery: [3.5, 6],
    radius: 0.5,
    eyeH: 1.35,
    // enrage: per rage stack (0-4, from hp lost)
    rageSpeed: 0.12,       // +12% speed per stack
    rageCooldown: 0.07,    // -7% spit cooldown per stack
    rageScale: 0.055,      // it literally grows
  },
  juggernaut: {
    hp: 430,
    speed: 2.5,
    turnRate: 2.2,
    attackRange: 3.0,
    windup: 0.5,
    strikeDamage: 30,
    strikeCooldown: 1.6,
    chargeSpeed: 9.5,
    chargeWindup: 0.85,
    chargeTime: 2.4,
    chargeDamage: 34,
    chargeCooldown: 7,
    callEvery: [5, 9],
    radius: 1.0,
    eyeH: 2.1,
  },
  stingerwing: {
    hp: 9,
    speed: 8.4,
    turnRate: 7.5,
    touchDamage: 3,
    touchCooldown: 1.0,
    callEvery: [1.8, 3.4],
    radius: 0.28,
    eyeH: 0,
    flyLow: 1.3,
    flyHigh: 2.6,
  },
  shrike: {
    hp: 45,
    speed: 2.0,          // ground shuffle - it is NOT a runner
    turnRate: 6,
    pounceRange: 14,
    pounceDamage: 16,
    hopMin: 7,
    hopMax: 12,
    hopApex: 4.5,
    hopDur: 0.8,
    crouch: 0.4,         // pre-leap tell
    recover: 1.15,       // grounded + vulnerable after a pounce
    callEvery: [2.8, 5],
    radius: 0.45,
    eyeH: 1.2,
  },
  bloomcaller: {
    hp: 130,
    speed: 1.35,
    turnRate: 2.5,
    keepMin: 10,         // shuffles closer until this, then holds
    bloomEvery: 8,
    bloomChannel: 2.1,
    bloomRange: 70,      // will not call if the player is further than this
    callEvery: [4, 7],
    radius: 0.6,
    eyeH: 1.9,
  },
};

const GLOB_POOL = 14;
const PLAYER_RADIUS = 0.42;

export function createEnemyManager(scene, playerRef, effects, hooks) {
  // hooks: { damagePlayer(amount, srcPos), onKill(type, pos),
  //          onSummon(pos, threat) -> spawned count (director assist) }
  const enemies = [];
  const tuning = { hpMult: 1 }; // set per-run from difficulty
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  let flankCounter = 0;

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
            hooks.damagePlayer(def.spitDamage * frac, p, 'acid');
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
    e.maxHp = def.hp * tuning.hpMult;
    e.hp = e.maxHp;
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
    e.fix = e.fix || new THREE.Vector3();
    e.fix.copy(playerRef.p.pos);
    e.fixTimer = 0;
    e.callTimer = 1 + Math.random() * 3;
    e.zigPhase = Math.random() * 10;
    e.flash = 0;
    e.rage = 0;
    e.flank = (flankCounter++ % 2) * 2 - 1; // alternate -1 / +1
    e.lungeVec = e.lungeVec || new THREE.Vector3();
    e.baseScale = type === 'juggernaut' ? 1 : 0.9 + Math.random() * 0.25;
    // type-specific spawn state
    if (type === 'stingerwing') {
      e.flyPhase = Math.random() * 10;
      e.pos.y = terrainHeight(x, z) + def.flyLow + Math.random() * (def.flyHigh - def.flyLow);
    } else if (type === 'shrike') {
      e.state = 'perch';
      e.pos.y = terrainHeight(x, z) + 7 + Math.random() * 3; // aloft in the canopy
      e.airFrom = e.airFrom || new THREE.Vector3();
      e.airTo = e.airTo || new THREE.Vector3();
      e.airT = 0;
      e.airDur = 1;
      e.pouncing = false;
    } else if (type === 'bloomcaller') {
      e.bloomCd = 3 + Math.random() * 3;
    }
    e.model.group.visible = true;
    e.model.group.position.copy(e.pos);
    e.model.group.rotation.set(0, e.heading, 0);
    e.model.group.scale.setScalar(e.baseScale);
    return e;
  }

  function die(e) {
    e.state = 'dying';
    e.dying = 0;
    e.stateT = 0;
    if (hooks.onKill) hooks.onKill(e.type, e.pos);
    sfxCreature(e.type, e.pos, 1.4);
  }

  function applyDamage(e, dmg, headshot, point, crit = false) {
    if (e.dead || e.state === 'dying') return 'dead';
    e.hp -= dmg;
    e.flash = 1;
    effects.burst(point, crit ? 'crit' : 'flesh', crit ? 14 : headshot ? 10 : 6, crit ? 4 : 2.6);
    // getting shot reveals the player exactly
    e.fix.copy(playerRef.p.pos);
    // spitters enrage as they lose ichor - they swell, hurry, and spit faster
    if (e.type === 'spitter') {
      e.rage = Math.min(4, Math.floor((1 - e.hp / e.maxHp) * 5));
    }
    // a perched/recovering shrike that gets tagged bails into a hop
    if (e.type === 'shrike' && (e.state === 'perch')) {
      e.state = 'crouch';
      e.stateT = 0;
    }
    if (e.hp <= 0) {
      die(e);
      return 'kill';
    }
    return 'hit';
  }

  // Post-move resolution shared by every grounded mover: props push-out,
  // player separation (no more clipping through the player), ground clamp.
  function resolveGround(e) {
    pushOut(e.pos, e.def.radius, e.pos.y);
    const pp = playerRef.p.pos;
    const dx = e.pos.x - pp.x;
    const dz = e.pos.z - pp.z;
    const d2 = dx * dx + dz * dz;
    const minD = e.def.radius + PLAYER_RADIUS + 0.22;
    if (d2 < minD * minD && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = (minD - d) / d;
      e.pos.x += dx * push;
      e.pos.z += dz * push;
    }
    e.pos.y = terrainHeight(e.pos.x, e.pos.z);
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
    // cliffs and thicket stop hunters too - slide along the wall face
    let mx = Math.sin(e.heading);
    let mz = Math.cos(e.heading);
    if (blockedStep(e.pos.x, e.pos.z, mx, mz, e.pos.y)) {
      let moved = false;
      for (const off of [0.85, -0.85, 1.6, -1.6]) {
        const hx = Math.sin(e.heading + off);
        const hz = Math.cos(e.heading + off);
        if (!blockedStep(e.pos.x, e.pos.z, hx, hz, e.pos.y)) {
          mx = hx;
          mz = hz;
          moved = true;
          break;
        }
      }
      if (!moved) {
        mx = 0;
        mz = 0;
      }
    }
    e.pos.x += (mx * v + sepX * 2.2) * dt;
    e.pos.z += (mz * v + sepZ * 2.2) * dt;
    resolveGround(e);
    e.walkPhase += dt * v * 2.2;
    return dist;
  }

  function updatePerception(e, dt) {
    e.losTimer -= dt;
    if (e.losTimer <= 0) {
      e.losTimer = 0.28 + Math.random() * 0.12;
      const eye = _v.set(e.pos.x, e.pos.y + e.def.eyeH, e.pos.z);
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
      // pack flanking: while far, curve in from your assigned side
      let target = e.fix;
      if (dist > 11) {
        _v2.set(e.fix.x - e.pos.x, 0, e.fix.z - e.pos.z).normalize();
        const off = Math.min(10, dist * 0.4) * e.flank;
        _flank.set(e.fix.x - _v2.z * off, e.fix.y, e.fix.z + _v2.x * off);
        target = _flank;
      }
      moveToward(e, target, e.def.speed, dt, e.def.zigzag);
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
      if (!blockedStep(e.pos.x, e.pos.z, e.lungeVec.x, e.lungeVec.z, e.pos.y)) {
        e.pos.x += e.lungeVec.x * e.def.lungeSpeed * dt;
        e.pos.z += e.lungeVec.z * e.def.lungeSpeed * dt;
      }
      resolveGround(e);
      const d2 = _v.subVectors(pp, e.pos).length();
      if (d2 < 1.7) {
        hooks.damagePlayer(e.def.strikeDamage, e.pos, 'prowler');
        e.state = 'hunt';
        e.attackCd = e.def.strikeCooldown;
      } else if (e.stateT > e.def.lungeTime) {
        e.state = 'hunt';
        e.attackCd = e.def.strikeCooldown * 0.6;
      }
    }
  }

  function spitterCooldown(e) {
    const [a, b] = e.def.spitCooldown;
    const cd = a + Math.random() * (b - a);
    return cd * (1 - e.def.rageCooldown * e.rage);
  }

  function updateSpitter(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);
    e.attackCd = Math.max(0, e.attackCd - dt);
    const speed = e.def.speed * (1 + e.def.rageSpeed * e.rage);

    if (e.state === 'hunt') {
      if (dist > e.def.attackRange * 0.8 || !e.hasLOS) {
        moveToward(e, e.fix, speed, dt);
      } else if (dist < e.def.keepMin) {
        // back away, keep facing player
        _v2.set(e.pos.x * 2 - pp.x, 0, e.pos.z * 2 - pp.z);
        moveToward(e, _v2, speed * 0.85, dt);
      }
      if (dist < 2.2 && e.attackCd <= 0) {
        hooks.damagePlayer(e.def.biteDamage, e.pos, 'spitter-bite');
        e.attackCd = 1.4;
      } else if (dist < e.def.attackRange && e.hasLOS && e.attackCd <= 0) {
        e.state = 'windup';
        e.stateT = 0;
        sfxCreature('spitter', e.pos, 1.2);
      }
    } else if (e.state === 'windup') {
      const windup = e.def.windup * (1 - 0.09 * e.rage);
      e.stateT += dt;
      // sacs brighten - the readable tell
      for (const sac of e.model.refs.sacs) {
        sac.material.emissiveIntensity = 1.6 + e.rage * 0.7 + (e.stateT / windup) * 4;
      }
      if (e.stateT >= windup) {
        for (const sac of e.model.refs.sacs) sac.material.emissiveIntensity = 1.6 + e.rage * 0.7;
        _v2.set(e.pos.x, e.pos.y + 1.35, e.pos.z);
        throwGlob(_v2, playerRef.p.pos);
        e.state = 'hunt';
        e.attackCd = spitterCooldown(e);
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
          hooks.damagePlayer(e.def.strikeDamage, e.pos, 'juggernaut');
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
        e.lungeVec.copy(_v2);
      }
    } else if (e.state === 'charge') {
      e.stateT += dt;
      const cliffBlocked = blockedStep(e.pos.x, e.pos.z, e.lungeVec.x, e.lungeVec.z, e.pos.y);
      if (!cliffBlocked) {
        e.pos.x += e.lungeVec.x * e.def.chargeSpeed * dt;
        e.pos.z += e.lungeVec.z * e.def.chargeSpeed * dt;
      }
      const blocked = pushOut(e.pos, e.def.radius, e.pos.y) || cliffBlocked;
      e.pos.y = terrainHeight(e.pos.x, e.pos.z);
      e.walkPhase += dt * 14;
      const d2 = _v.subVectors(pp, e.pos).length();
      if (d2 < 2.6) {
        hooks.damagePlayer(e.def.chargeDamage, e.pos, 'jugg-charge');
        _v2.subVectors(pp, e.pos).setY(0).normalize();
        playerRef.p.vel.addScaledVector(_v2, 13);
        playerRef.p.vel.y = 4.5;
        e.state = 'hunt';
        e.chargeCd = e.def.chargeCooldown;
        e.attackCd = 1;
        resolveGround(e);
      } else if (blocked && e.stateT > 0.3) {
        // slammed into a tree - stunned, your window (shoot the boil)
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

  function updateStingerwing(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.flyPhase += dt * (3 + Math.sin(e.zigPhase));

    if (e.state === 'recoil') {
      // just stung - peel away before another pass
      e.stateT += dt;
      e.pos.x += e.lungeVec.x * 6 * dt;
      e.pos.z += e.lungeVec.z * 6 * dt;
      if (e.stateT > 0.7) e.state = 'hunt';
    } else {
      // weave toward the player's head height
      const dx = e.fix.x - e.pos.x;
      const dz = e.fix.z - e.pos.z;
      let want = Math.atan2(dx, dz);
      want += Math.sin(performance.now() / 1000 * 4 + e.zigPhase) * 0.7;
      let dh = want - e.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      e.heading += clamp(dh, -e.def.turnRate * dt, e.def.turnRate * dt);
      e.pos.x += Math.sin(e.heading) * e.def.speed * dt;
      e.pos.z += Math.cos(e.heading) * e.def.speed * dt;
      pushOut(e.pos, e.def.radius, e.pos.y);
      if (dist < 1.2 && e.attackCd <= 0) {
        hooks.damagePlayer(e.def.touchDamage, e.pos, 'stingerwing');
        e.attackCd = e.def.touchCooldown;
        e.state = 'recoil';
        e.stateT = 0;
        _v2.subVectors(e.pos, pp).setY(0).normalize();
        e.lungeVec.copy(_v2);
      }
    }
    // flight altitude: bob between flyLow and flyHigh over terrain, dip
    // toward the player's chest on approach
    const ground = terrainHeight(e.pos.x, e.pos.z);
    const bob = (Math.sin(e.flyPhase) * 0.5 + 0.5);
    let targetY = ground + lerp(e.def.flyLow, e.def.flyHigh, bob);
    if (dist < 6) targetY = pp.y - 0.35;
    e.pos.y += (targetY - e.pos.y) * Math.min(1, dt * 3.5);
    e.walkPhase += dt * 8;
  }

  function startHop(e, targetPos, pounce) {
    e.airFrom.copy(e.pos);
    e.airTo.copy(targetPos);
    e.airT = 0;
    e.pouncing = pounce;
    const dist = Math.hypot(targetPos.x - e.pos.x, targetPos.z - e.pos.z);
    e.airDur = pounce ? clamp(dist / 16, 0.35, 0.7) : e.def.hopDur;
    e.state = 'air';
    e.heading = Math.atan2(targetPos.x - e.pos.x, targetPos.z - e.pos.z);
  }

  function updateShrike(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);

    if (e.state === 'perch') {
      // waiting in the canopy; face the player, drop in when they close
      e.heading = Math.atan2(pp.x - e.pos.x, pp.z - e.pos.z);
      if (dist < 42) {
        e.state = 'crouch';
        e.stateT = 0;
        sfxCreature('shrike', e.pos, 1.4);
      }
    } else if (e.state === 'crouch') {
      e.stateT += dt;
      if (e.stateT >= e.def.crouch) {
        const flat = _v.subVectors(pp, e.pos).setY(0).length();
        if (flat < e.def.pounceRange && flat > 2.5 && e.hasLOS) {
          // POUNCE: ballistic arc straight at where you are now - readable,
          // dodgeable, and it commits
          _v2.copy(pp);
          _v2.y = terrainHeight(pp.x, pp.z);
          startHop(e, _v2, true);
          sfxCreature('shrike', e.pos, 1.6);
        } else {
          // close the gap with a hop toward the fix
          const d = _v.subVectors(e.fix, e.pos).setY(0);
          const len = d.length();
          const hop = clamp(len, e.def.hopMin, e.def.hopMax);
          d.normalize();
          _v2.set(
            e.pos.x + d.x * hop + (Math.random() - 0.5) * 3,
            0,
            e.pos.z + d.z * hop + (Math.random() - 0.5) * 3
          );
          _v2.x = clamp(_v2.x, -WORLD.playable + 4, WORLD.playable - 4);
          _v2.z = clamp(_v2.z, -WORLD.playable + 4, WORLD.playable - 4);
          // never hop INTO strangler thicket; shorten the hop instead
          if (isThicket(_v2.x, _v2.z)) {
            _v2.set(e.pos.x + d.x * 3, 0, e.pos.z + d.z * 3);
          }
          _v2.y = terrainHeight(_v2.x, _v2.z);
          startHop(e, _v2, false);
        }
      }
    } else if (e.state === 'air') {
      e.airT += dt;
      const t = Math.min(1, e.airT / e.airDur);
      const apex = e.pouncing ? 2.2 : e.def.hopApex;
      e.pos.lerpVectors(e.airFrom, e.airTo, t);
      e.pos.y += apex * 4 * t * (1 - t); // parabola
      e.walkPhase += dt * 6;
      if (t >= 1) {
        if (e.pouncing) {
          const d2 = _v.subVectors(pp, e.pos).length();
          if (d2 < 2.1) {
            hooks.damagePlayer(e.def.pounceDamage, e.pos, 'shrike');
            _v2.subVectors(pp, e.pos).setY(0).normalize();
            playerRef.p.vel.addScaledVector(_v2, 5);
          }
          e.state = 'recover';
          e.stateT = 0;
        } else {
          e.state = 'land';
          e.stateT = 0;
        }
        resolveGround(e);
      }
    } else if (e.state === 'land') {
      e.stateT += dt;
      if (e.stateT > 0.25) {
        e.state = 'crouch';
        e.stateT = 0;
      }
    } else if (e.state === 'recover') {
      // grounded and gawky - this is your window
      e.stateT += dt;
      moveToward(e, e.fix, e.def.speed, dt);
      if (e.stateT > e.def.recover) {
        e.state = 'crouch';
        e.stateT = 0;
      }
    }
  }

  function updateBloomcaller(e, dt) {
    const pp = playerRef.p.pos;
    const dist = _v.subVectors(pp, e.pos).length();
    creatureCall(e, dt, dist);
    e.bloomCd = Math.max(0, e.bloomCd - dt);

    if (e.state === 'hunt') {
      if (dist > e.def.keepMin) {
        moveToward(e, e.fix, e.def.speed, dt);
      } else {
        // hold ground, sway, face you
        e.heading = Math.atan2(pp.x - e.pos.x, pp.z - e.pos.z);
      }
      if (e.bloomCd <= 0 && dist < e.def.bloomRange) {
        e.state = 'bloom';
        e.stateT = 0;
        sfxCreature('bloomcaller', e.pos, 1.5);
      }
    } else if (e.state === 'bloom') {
      // channel: petals open, core exposed (crit window), scream builds
      e.stateT += dt;
      if (e.stateT >= e.def.bloomChannel) {
        e.state = 'hunt';
        e.bloomCd = e.def.bloomEvery;
        sfxBloomPulse(e.pos);
        effects.burst(_v.set(e.pos.x, e.pos.y + 2, e.pos.z), 'bloom', 16, 5);
        // the jungle answers: reinforcements near the CALLER + a fresh fix
        // on the player for every hunter alive
        if (hooks.onSummon) hooks.onSummon(e.pos);
        for (const o of enemies) {
          if (!o.dead && o.state !== 'dying') o.fix.copy(pp);
        }
      }
    }
  }

  const TYPE_UPDATE = {
    prowler: updateProwler,
    spitter: updateSpitter,
    juggernaut: updateJuggernaut,
    stingerwing: updateStingerwing,
    shrike: updateShrike,
    bloomcaller: updateBloomcaller,
  };

  const _flank = new THREE.Vector3();

  // ---- animation ----
  function animate(e, dt) {
    const g = e.model.group;
    const refs = e.model.refs;
    g.position.copy(e.pos);

    if (e.state === 'dying') {
      e.dying += dt;
      if (e.type === 'stingerwing') {
        // clipped wings: drop out of the air
        g.position.y = Math.max(terrainHeight(e.pos.x, e.pos.z) + 0.1, e.pos.y - e.dying * 6);
        g.rotation.z += dt * 9;
      } else if (e.type === 'bloomcaller') {
        // wilt: crumple downward
        const s = Math.max(0.15, 1 - e.dying * 0.7) * e.baseScale;
        g.scale.set(e.baseScale, s, e.baseScale);
      } else {
        g.rotation.z = Math.min(Math.PI / 2, e.dying * 3.2);
        if (e.dying > 1.2) g.position.y = e.pos.y - (e.dying - 1.2) * 0.5;
      }
      if (e.dying > 2.6) {
        e.dead = true;
        g.visible = false;
      }
      return;
    }

    g.rotation.y = e.heading;
    g.rotation.z = 0;

    // hit flash: scale pulse (cheap, no shared-material writes)
    if (e.flash > 0) {
      e.flash = Math.max(0, e.flash - dt * 6);
    }
    const rageScale = e.type === 'spitter' ? 1 + e.def.rageScale * e.rage : 1;
    g.scale.setScalar(e.baseScale * rageScale + e.flash * 0.02);

    // walk cycle: hips swing, knees counter-bend
    const swing = Math.sin(e.walkPhase);
    if (refs.legs) {
      refs.legs.forEach((leg, i) => {
        leg.rotation.x = swing * 0.55 * (i % 2 === 0 ? 1 : -1);
      });
    }
    if (refs.knees) {
      refs.knees.forEach((knee, i) => {
        const s = swing * (i % 2 === 0 ? 1 : -1);
        knee.rotation.x = 0.35 + Math.max(0, -s) * 0.7;
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
      // rage: sacs swell
      for (const sac of refs.sacs) {
        const bs = sac.userData.baseScale || 1;
        sac.scale.setScalar(bs * (1 + e.rage * 0.13));
      }
    } else if (e.type === 'juggernaut') {
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
    } else if (e.type === 'stingerwing') {
      // wing blur
      const flap = Math.sin(performance.now() / 1000 * 46 + e.zigPhase) * 0.6;
      refs.wings[0].rotation.y = 0.3 + flap;
      refs.wings[1].rotation.y = -0.3 - flap;
      g.rotation.x = Math.sin(e.flyPhase) * 0.15;
    } else if (e.type === 'shrike') {
      const airborne = e.state === 'air' || e.state === 'perch';
      if (airborne) {
        // arms thrown up, legs tucked - the flying-wraith silhouette
        refs.arms[0].rotation.z = 2.2;
        refs.arms[1].rotation.z = -2.2;
        refs.legs.forEach((l) => { l.rotation.x = -1.6; });
        refs.stripe.material.emissiveIntensity = 3.4;
        g.rotation.x = e.state === 'air' ? -0.4 : 0;
      } else {
        refs.arms[0].rotation.z = 0.5 + swing * 0.4;
        refs.arms[1].rotation.z = -0.5 - swing * 0.4;
        refs.stripe.material.emissiveIntensity = e.state === 'crouch' ? 2.4 + e.stateT * 4 : 2.4;
        g.rotation.x = e.state === 'crouch' ? 0.25 : 0;
      }
    } else if (e.type === 'bloomcaller') {
      // sway like a heavy flower in wind; petals hinge open during bloom
      const sway = Math.sin(performance.now() / 1000 * 1.3 + e.zigPhase) * 0.06;
      g.rotation.z = sway;
      const open = e.state === 'bloom'
        ? 0.25 + (e.stateT / e.def.bloomChannel) * 1.15
        : 0.25;
      for (const petal of refs.petals) petal.rotation.x = open;
      refs.core.material.emissiveIntensity = e.state === 'bloom'
        ? 2.8 + (e.stateT / e.def.bloomChannel) * 4
        : 1.6;
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

  // ray vs head/crit/body spheres of every living enemy; nearest hit wins
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

  const _sph = new THREE.Vector3();

  function rayEnemies(origin, dir, maxDist) {
    let best = maxDist;
    let bestEnemy = null;
    let bestZone = 'body';
    let bestMult = 1;
    for (const e of enemies) {
      if (e.dead || e.state === 'dying') continue;
      const s = e.model.group.scale.x;

      const testSphere = (off, r, zone, mult) => {
        _sph.copy(off).multiplyScalar(s);
        rotateY(_sph, e.heading);
        _sph.add(e.pos);
        const t = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z,
          _sph.x, _sph.y, _sph.z, r * s);
        if (t < best) {
          best = t;
          bestEnemy = e;
          bestZone = zone;
          bestMult = mult;
        }
      };

      // crit zones first (they sit inside/over the body silhouette)
      if (e.model.crits) {
        for (const c of e.model.crits) {
          if (c.when && e.state !== c.when) continue;
          testSphere(c.off, c.r, 'crit', c.mult);
        }
      }
      testSphere(e.model.headOffset, e.model.headR, 'head', e.model.headMultScale ?? 1);
      testSphere(e.model.bodyOffset, e.model.bodyR, 'body', 1);
    }
    return bestEnemy
      ? { t: best, enemy: bestEnemy, zone: bestZone, zoneMult: bestMult, headshot: bestZone === 'head' }
      : null;
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

  return {
    update, spawn, applyDamage, rayEnemies, aliveCount, aliveList, reset,
    enemies, tuning,
  };
}

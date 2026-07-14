// The simulation, assembled - everything that IS the game, none of what
// shows it. createSim wires player + weapons + grenades + enemies +
// director + pickups + extraction + hazards behind a presentation-free
// interface, so the same code drives:
//   - the browser game (main.js adds rendering, HUD, audio, input)
//   - the headless playtest runner (scripts/playtest.mjs, plain Node)
//   - the in-page bot (window.__deadfall.runBot)
//
// Presentation subscribes through `ui` hooks (all optional):
//   toast(msg, secs), setObjective(text), showExtract(progress|null),
//   hitmarker(kill, crit), onHurt(amount), onDeath(), onWin(),
//   onHazard(kind), onExtractTone(progress), onSurge(), onBuff()

import * as THREE from 'three';
import { WORLD, razorfinHazard } from '../world/heightmap.js';
import { createPlayer } from '../player/controller.js';
import { createWeapons } from '../weapons/weapons.js';
import { createGrenades } from '../weapons/grenades.js';
import { createEnemyManager } from '../enemies/enemies.js';
import { createDirector } from '../enemies/director.js';
import { createPickups } from './pickups.js';
import { createTraps } from './traps.js';
import { createWeather } from './weather.js';
import { getDifficulty, DEFAULT_DIFFICULTY } from './difficulty.js';

const AYAHUASCA_DURATION = 25;

export function createSim({ scene, camera, effects, ui = {} }) {
  const noop = () => {};
  const U = {
    toast: ui.toast || noop,
    setObjective: ui.setObjective || noop,
    showExtract: ui.showExtract || noop,
    hitmarker: ui.hitmarker || noop,
    onHurt: ui.onHurt || noop,
    onDeath: ui.onDeath || noop,
    onWin: ui.onWin || noop,
    onHazard: ui.onHazard || noop,
    onExtractTone: ui.onExtractTone || noop,
    onSurge: ui.onSurge || noop,
    onBuff: ui.onBuff || noop,
    onWeather: ui.onWeather || noop,
    onBoss: ui.onBoss || noop,
  };

  const game = {
    state: 'MENU', // MENU | RUNNING | DEAD | WIN
    time: 0,       // seconds since run start
    kills: 0,
    shotsFired: 0,
    damageTaken: 0,
    dmgBySource: {}, // balance telemetry: what actually hurts the player
  };

  let difficulty = getDifficulty(DEFAULT_DIFFICULTY);

  const player = createPlayer(camera);

  // Multi-player support (H0 refactor): players array.
  // Solo = players.length === 1. Enemies target nearest player.
  // Director uses furthest-north player + summed noise.
  const players = [player];

  function nearestPlayer(pos) {
    // Return the nearest alive player to pos
    let nearest = player.p;
    let minDist = Infinity;
    for (const p of players) {
      if (!p.p.alive) continue;
      const dx = p.p.pos.x - pos.x;
      const dz = p.p.pos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist) {
        minDist = dist;
        nearest = p.p;
      }
    }
    return nearest;
  }

  function furthestNorthPlayer() {
    // Return the alive player with lowest z (furthest north)
    let furthest = player.p;
    let minZ = furthest.pos.z;
    for (const p of players) {
      if (!p.p.alive) continue;
      if (p.p.pos.z < minZ) {
        minZ = p.p.pos.z;
        furthest = p.p;
      }
    }
    return furthest;
  }

  // --- combat wiring ---
  const weaponHooks = {
    rayEnemies: null,   // installed below
    enemiesNear: null,
    onTracer: (from, to) => effects.spawnTracer(from, to),
    onImpact: (point, kind) => effects.burst(point, kind),
    onEnemyHit: null,
    onShot: null,
    onHitmarker: (kill, crit) => U.hitmarker(kill, crit),
  };
  const weapons = createWeapons(camera, player, weaponHooks);

  // damagePlayer with multi-player bleedout logic
  function damagePlayer(amount, srcPos, source = 'unknown', targetPlayer = null) {
    if (game.state !== 'RUNNING') return;
    // if targetPlayer is specified, damage that player; otherwise damage player 0 (main player)
    const target = targetPlayer || player;
    if (target.p.alive === false || target.p.bleedoutT > 0) return; // can't damage dead/bleeding players

    const scaled = amount * difficulty.playerDamageTaken;
    target.damage(scaled);
    game.damageTaken += scaled;
    game.dmgBySource[source] = (game.dmgBySource[source] || 0) + scaled;
    U.onHurt(scaled, srcPos);

    if (!target.p.alive && target.p.hp <= 0) {
      // Player went down - check if this is the last alive player
      let aliveCount = 0;
      for (const p of players) {
        if (p.p.alive && p.p.bleedoutT === 0) aliveCount++;
      }

      if (aliveCount <= 1) {
        // Last player down = immediate game over
        game.state = 'DEAD';
        U.onDeath();
      } else {
        // Enter bleedout state: 45 second crawl before permanent death
        target.p.bleedoutT = 45;
        U.toast('PLAYER DOWN - 45s UNTIL PERMANENT DEATH', 3.0);
      }
    }
  }

  let pickupsRef = null;
  let trapsRef = null;
  const boss = { ref: null, spawned: false, maxHp: 1, name: 'THE MIREMOTHER' };
  const enemyMgr = createEnemyManager(scene, { nearestPlayer, players }, effects, {
    damagePlayer,
    onKill(type, pos) {
      game.kills += 1;
      if (type === 'miremother') {
        // APEX SLAIN: the moat is yours - a feast of loot, and the jungle
        // holds its breath for a while
        U.toast('APEX SLAIN - THE STAIR IS YOURS', 3.5);
        director.state.heat = 0;
        if (pickupsRef) {
          pickupsRef.dropAt(pos.x + 2.5, pos.z, true);
          pickupsRef.dropAt(pos.x - 2.5, pos.z + 2, true);
        }
        return;
      }
      if (!pickupsRef) return;
      // dying enemies feed the run
      if (type === 'juggernaut') pickupsRef.dropAt(pos.x, pos.z, true);
      else if (type === 'bloomcaller' && Math.random() < 0.8) pickupsRef.dropAt(pos.x, pos.z, false);
      else if (type === 'viperblossom' && Math.random() < 0.6) pickupsRef.dropAt(pos.x, pos.z, false);
      else if (type !== 'stingerwing' && type !== 'viperblossom' && Math.random() < 0.35) pickupsRef.dropAt(pos.x, pos.z, false);
    },
    onSummon(pos) {
      director.assistSpawn(pos, director.threat());
    },
  });
  const director = createDirector(enemyMgr, { furthestNorthPlayer, nearestPlayer });
  const weather = createWeather(U);
  director.setWeather(weather);

  const grenades = createGrenades(scene, camera, player, effects, {
    enemies: () => enemyMgr.aliveList(),
    damageEnemy: (e, dmg, point) => enemyMgr.applyDamage(e, dmg, false, point, false),
    damagePlayer: (amount, pos) => damagePlayer(amount, pos, 'grenade-self'),
    onNoise: (mult) => {
      for (let i = 0; i < mult; i++) director.onShot();
    },
    toast: (msg) => U.toast(msg),
  });

  weaponHooks.rayEnemies = (origin, dir, maxDist) => enemyMgr.rayEnemies(origin, dir, maxDist);
  weaponHooks.enemiesNear = () => enemyMgr.aliveList();
  weaponHooks.onEnemyHit = (enemy, dmg, headshot, point, crit) =>
    enemyMgr.applyDamage(enemy, dmg, headshot, point, crit);
  weaponHooks.onShot = () => {
    director.onShot();
    game.shotsFired += 1;
  };

  // --- pickups ---
  const buff = { t: 0 };
  const pickups = createPickups(scene, player, weapons, {
    heal(amount) {
      const before = player.p.hp;
      player.heal(amount);
      return player.p.hp - before;
    },
    toast: (msg) => U.toast(msg),
    addGrenade: (n) => grenades.add(n),
    drinkBrew() {
      buff.t = AYAHUASCA_DURATION;
      player.p.buffT = buff.t;
      U.onBuff(AYAHUASCA_DURATION);
      U.toast('THE VINE OPENS YOUR EYES', 2.6);
      return true;
    },
  });
  pickupsRef = pickups;

  // --- traps ---
  const traps = createTraps(scene, player, {
    damagePlayer,
    toast: (msg) => U.toast(msg),
    onNoise: () => {
      director.onShot();
    },
  });
  trapsRef = traps;

  // --- extraction ---
  const extraction = {
    progress: 0,
    active: false,     // player currently in the zone
    committed: false,  // surge triggered (stays on once you start)
    toneAt: 0,
  };

  function updateExtraction(dt) {
    const ex = WORLD.extraction;

    // Check if all alive players are in extraction zone
    let playersInZone = 0;
    let alivePlayerCount = 0;
    for (const p of players) {
      if (!p.p.alive) continue;
      alivePlayerCount++;
      const dx = p.p.pos.x - ex.x;
      const dz = p.p.pos.z - ex.z;
      if (dx * dx + dz * dz < ex.radius * ex.radius) {
        playersInZone++;
      }
    }

    const allInZone = alivePlayerCount > 0 && playersInZone === alivePlayerCount;

    if (allInZone && !extraction.active) {
      extraction.active = true;
      if (!extraction.committed) {
        extraction.committed = true;
        director.startSurge();
        U.onSurge();
        U.toast('HOLD THE BEACON', 2.4);
        U.setObjective('HOLD FOR EXTRACTION');
      }
    } else if (!allInZone && extraction.active) {
      extraction.active = false;
      if (alivePlayerCount > playersInZone) {
        const missing = alivePlayerCount - playersInZone;
        U.toast(`${missing} PLAYER(S) MISSING FROM EXTRACTION`, 2.0);
      }
      U.setObjective('RETURN TO THE BEACON');
    }

    if (extraction.active && allInZone) {
      extraction.progress = Math.min(1, extraction.progress + dt / difficulty.holdTime);
      if (extraction.progress - extraction.toneAt >= 0.1) {
        extraction.toneAt = extraction.progress;
        U.onExtractTone(extraction.progress);
      }
      if (extraction.progress >= 1) {
        game.state = 'WIN';
        U.onWin();
        return;
      }
    }
    U.showExtract(extraction.committed ? extraction.progress : null);
  }

  // --- the apex: wake her when the player reaches the moat (or commits
  // to extraction without ever having crossed it) ---
  function updateBoss() {
    const dm = Math.hypot(player.p.pos.x - WORLD.maw.x, player.p.pos.z - WORLD.maw.z);
    // the jungle defers to its apex: director throttles during her fight
    director.state.bossFight = !!(boss.ref && !boss.ref.dead
      && boss.ref.state !== 'dying' && dm < 52);
    if (boss.spawned) return;
    if (dm < 46 || extraction.committed) {
      boss.spawned = true;
      boss.ref = enemyMgr.spawn('miremother', WORLD.maw.x, WORLD.maw.z);
      boss.maxHp = boss.ref.maxHp;
      player.p.camShake = 1;
      U.onBoss(boss.name);
      U.toast('THE MIREMOTHER WAKES', 3);
    }
  }

  // --- bleedout mechanic ---
  function updateBleedout(dt) {
    for (const p of players) {
      if (p.p.bleedoutT <= 0) continue; // not bleeding out
      p.p.bleedoutT -= dt;
      if (p.p.bleedoutT <= 0) {
        // Bleedout expired - permanent death
        p.p.bleedoutT = 0;
        p.p.alive = false;
        // Check if all players are now dead
        let anyAlive = false;
        for (const pp of players) {
          if (pp.p.alive) anyAlive = true;
        }
        if (!anyAlive) {
          game.state = 'DEAD';
          U.onDeath();
        }
      }
    }
  }

  // --- environmental hazards ---
  let razorT = 0;
  function updateHazards(dt) {
    const p = player.p;
    const hz = razorfinHazard(p.pos.x, p.pos.z);
    if (hz > 0 && p.inWater) {
      razorT -= dt;
      if (razorT <= 0) {
        razorT = 0.5;
        damagePlayer(difficulty.razorfinDps * hz * 0.5, p.pos, 'razorfin');
        U.onHazard('razorfin');
        effects.burst(new THREE.Vector3(p.pos.x, WORLD.waterLevel + 0.1, p.pos.z), 'razor', 8, 3);
      }
    } else {
      razorT = 0;
    }
  }

  // --- ayahuasca buff ---
  function updateBuff(dt) {
    if (buff.t > 0) {
      buff.t = Math.max(0, buff.t - dt);
      player.p.buffT = buff.t;
      // the vine knits flesh while it lasts
      player.heal(1.4 * dt);
    }
  }

  function setDifficulty(name) {
    difficulty = getDifficulty(name);
    director.setDifficulty(difficulty);
    enemyMgr.tuning.hpMult = difficulty.enemyHp;
    enemyMgr.tuning.bossHp = difficulty.bossHp;
    enemyMgr.tuning.bossDmg = difficulty.bossDmg;
    return difficulty;
  }
  setDifficulty(DEFAULT_DIFFICULTY);

  // Reset every system for a fresh run. Presentation (menus, audio, moods)
  // wraps this from the outside.
  function resetRun() {
    player.reset();
    weapons.reset();
    grenades.reset(difficulty.startGrenades);
    enemyMgr.reset();
    director.reset();
    pickups.reset();
    traps.reset();
    enemyMgr.spawnViperblossoms();
    extraction.progress = 0;
    extraction.active = false;
    extraction.committed = false;
    extraction.toneAt = 0;
    buff.t = 0;
    boss.ref = null;
    boss.spawned = false;
    weather.reset();
    game.state = 'RUNNING';
    game.time = 0;
    game.kills = 0;
    game.shotsFired = 0;
    game.damageTaken = 0;
    game.dmgBySource = {};
    U.setObjective('REACH THE EXTRACTION BEACON');
    U.showExtract(null);
  }

  // One fixed step of pure simulation. The browser calls this from its
  // render loop; the bot and the headless runner call it in a tight loop.
  function step(intent, dt) {
    if (game.state !== 'RUNNING') return;
    game.time += dt;
    weather.update(dt);
    enemyMgr.tuning.fixNoiseMult = weather.mods().fixNoiseMult;
    player.update(intent, dt);
    // keep the camera's matrices honest even without a render pass
    // (headless: nobody else calls updateMatrixWorld)
    camera.updateMatrixWorld();
    weapons.update(intent, dt, game.time);
    grenades.update(intent, dt);
    enemyMgr.update(dt);
    director.update(dt);
    pickups.update(dt);
    traps.update(dt);
    updateBoss();
    updateBuff(dt);
    updateHazards(dt);
    updateBleedout(dt);
    if (game.state === 'RUNNING') updateExtraction(dt);
  }

  return {
    game, player, weapons, weaponHooks, grenades, enemyMgr, director,
    pickups, traps, extraction, buff, weather, boss,
    step, resetRun, setDifficulty, updateExtraction,
    get difficulty() { return difficulty; },
  };
}

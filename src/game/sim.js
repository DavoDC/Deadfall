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
import { createWeather } from './weather.js';
import { getDifficulty, DEFAULT_DIFFICULTY } from './difficulty.js';

const AYAHUASCA_DURATION = 20;

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

  function damagePlayer(amount, srcPos, source = 'unknown') {
    if (game.state !== 'RUNNING' || !player.p.alive) return;
    const scaled = amount * difficulty.playerDamageTaken;
    player.damage(scaled);
    game.damageTaken += scaled;
    game.dmgBySource[source] = (game.dmgBySource[source] || 0) + scaled;
    U.onHurt(scaled, srcPos);
    if (!player.p.alive) {
      game.state = 'DEAD';
      U.onDeath();
    }
  }

  let pickupsRef = null;
  const enemyMgr = createEnemyManager(scene, player, effects, {
    damagePlayer,
    onKill(type, pos) {
      game.kills += 1;
      if (!pickupsRef) return;
      // dying enemies feed the run
      if (type === 'juggernaut') pickupsRef.dropAt(pos.x, pos.z, true);
      else if (type === 'bloomcaller' && Math.random() < 0.8) pickupsRef.dropAt(pos.x, pos.z, false);
      else if (type !== 'stingerwing' && Math.random() < 0.35) pickupsRef.dropAt(pos.x, pos.z, false);
    },
    onSummon(pos) {
      director.assistSpawn(pos, director.threat());
    },
  });
  const director = createDirector(enemyMgr, player);
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

  // --- extraction ---
  const extraction = {
    progress: 0,
    active: false,     // player currently in the zone
    committed: false,  // surge triggered (stays on once you start)
    toneAt: 0,
  };

  function updateExtraction(dt) {
    const ex = WORLD.extraction;
    const dx = player.p.pos.x - ex.x;
    const dz = player.p.pos.z - ex.z;
    const inZone = dx * dx + dz * dz < ex.radius * ex.radius;

    if (inZone && !extraction.active) {
      extraction.active = true;
      if (!extraction.committed) {
        extraction.committed = true;
        director.startSurge();
        U.onSurge();
        U.toast('HOLD THE BEACON', 2.4);
        U.setObjective('HOLD FOR EXTRACTION');
      }
    } else if (!inZone && extraction.active) {
      extraction.active = false;
      U.setObjective('RETURN TO THE BEACON');
    }

    if (extraction.active) {
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
    extraction.progress = 0;
    extraction.active = false;
    extraction.committed = false;
    extraction.toneAt = 0;
    buff.t = 0;
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
    updateBuff(dt);
    updateHazards(dt);
    if (game.state === 'RUNNING') updateExtraction(dt);
  }

  return {
    game, player, weapons, weaponHooks, grenades, enemyMgr, director,
    pickups, extraction, buff, weather,
    step, resetRun, setDifficulty, updateExtraction,
    get difficulty() { return difficulty; },
  };
}

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
//   hitmarker(kill, crit), onHurt(amount, srcPos, source), onDeath(), onWin(),
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
import { createFlood } from './flood.js';
import { getDifficulty, DEFAULT_DIFFICULTY } from './difficulty.js';
import { burstGraceMultiplier, BURST_GRACE_EXCLUDED_SOURCES } from './burstGrace.js';
import { shouldWakeMiremother } from './bossWake.js';

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
    onFlood: ui.onFlood || noop,
    // directional wave telegraph (root cause 4): "brace, incoming from the
    // north" instead of "deleted from offscreen" - fired once per surge
    // squad purchase, browser-only (HUD/audio), no-op headlessly
    onSurgeWave: ui.onSurgeWave || noop,
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

  // Per-player combat state. weaponsList[i]/grenadesList[i] are bound to
  // players[i] and its own camera, so each player can fire/aim/throw
  // independently. weapons/grenades (singular, below) stay aliases for
  // player 0 - existing single-player code (pickups, resetRun defaults)
  // keeps working unchanged.
  const weaponsList = [];
  const grenadesList = [];
  const playerCameras = [camera];

  function nearestPlayer(pos) {
    // Return the nearest alive player state (p) to pos
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
  weaponsList.push(weapons);

  // damagePlayer with multi-player bleedout logic
  function damagePlayer(amount, srcPos, source = 'unknown', targetPlayer = null) {
    if (game.state !== 'RUNNING') return;

    // Determine target: explicit target, or nearest alive player for multi-player
    let target = targetPlayer;
    if (!target) {
      if (players.length > 1) {
        // Multi-player: damage the nearest alive player
        let nearest = null;
        let minDist = Infinity;
        for (const ctrl of players) {
          if (!ctrl.p.alive) continue;
          const dx = ctrl.p.pos.x - srcPos.x;
          const dz = ctrl.p.pos.z - srcPos.z;
          const dist = Math.hypot(dx, dz);
          if (dist < minDist) {
            minDist = dist;
            nearest = ctrl;
          }
        }
        target = nearest || player;  // fallback to player[0] if no alive players found
      } else {
        // Solo play: always damage the only player
        target = player;
      }
    }

    if (target.p.alive === false || target.p.bleedoutT > 0) return; // can't damage dead/bleeding players

    // anti-burst grace (root cause 5, src/game/burstGrace.js): a short
    // window after any discrete hit where a SECOND overlapping hit is
    // softened, so multiple simultaneous attackers cannot chain-delete a
    // player with zero reaction time between blows. Excludes the
    // continuous razorfin/flood hazard ticks entirely - see burstGrace.js.
    //
    // Scoped to the extraction hold (extraction.committed) ON PURPOSE: an
    // early build applied this everywhere and it measurably softened the
    // whole run, not just the climax (critic: normal win-rate 33% -> ~90%,
    // hard 13% -> 47% - see the design notes). All
    // seven root causes in the brief are specifically about the extraction
    // hold; the rest of the map's tuned difficulty curve is not this
    // round's target and should not move.
    const inHold = extraction.committed;
    const graceMult = inHold
      ? burstGraceMultiplier(source, game.time, target.p.lastBurstHitAt) : 1;
    const scaled = amount * difficulty.playerDamageTaken * graceMult;
    target.damage(scaled);
    game.damageTaken += scaled;
    game.dmgBySource[source] = (game.dmgBySource[source] || 0) + scaled;
    if (inHold && !BURST_GRACE_EXCLUDED_SOURCES.has(source)) target.p.lastBurstHitAt = game.time;
    // source forwarded for telemetry (main.js records damage-by-source and
    // reuses the last hit's source/pos as the death cause when hp hits 0)
    U.onHurt(scaled, srcPos, source);

    if (!target.p.alive && target.p.hp <= 0) {
      // Player went down - check if this is the last alive player
      let aliveCount = 0;
      for (const p of players) {
        if (p.p.alive && p.p.bleedoutT === 0) aliveCount++;
      }

      if (aliveCount === 0) {
        // All players down = immediate game over (for solo: 1 player dies)
        game.state = 'DEAD';
        U.onDeath();
      } else {
        // Other players are still alive - enter bleedout state
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
  const director = createDirector(enemyMgr, { furthestNorthPlayer, nearestPlayer }, {
    onWave: (bearing, squadLabel) => U.onSurgeWave(bearing, squadLabel),
  });
  const weather = createWeather(U);
  director.setWeather(weather);
  // THE FLOOD (round 5): the gorge's time-pressured second act
  const flood = createFlood(U);

  // grenade hooks are per-thrower (self-damage must hit the thrower, not
  // just "nearest player" - matters once there's more than one player)
  function makeGrenadeHooks(playerCtrl) {
    return {
      enemies: () => enemyMgr.aliveList(),
      damageEnemy: (e, dmg, point) => enemyMgr.applyDamage(e, dmg, false, point, false),
      damagePlayer: (amount, pos) => damagePlayer(amount, pos, 'grenade-self', playerCtrl),
      onNoise: (mult) => {
        for (let i = 0; i < mult; i++) director.onShot();
      },
      toast: (msg) => U.toast(msg),
    };
  }
  const grenades = createGrenades(scene, camera, player, effects, makeGrenadeHooks(player));
  grenadesList.push(grenades);

  // Add another player to the sim: own camera, own weapons + grenades,
  // sharing every world/enemy/director/pickup/extraction system. Used by
  // the headless coop bot runner (scripts/playtest.mjs --coop).
  function addPlayer(cam) {
    const p = createPlayer(cam);
    players.push(p);
    playerCameras.push(cam);
    const w = createWeapons(cam, p, weaponHooks);
    weaponsList.push(w);
    const g = createGrenades(scene, cam, p, effects, makeGrenadeHooks(p));
    grenadesList.push(g);
    return p;
  }

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
    // feed the in-hold escalation ramp (director.js threat()/
    // surgeIntensity()) - extraction.progress already pauses (not resets)
    // when the player kites out of the zone, so this stays consistent with
    // root cause 7's "felt length" even across brief exits.
    if (extraction.committed) director.setHoldProgress(extraction.progress);
    U.showExtract(extraction.committed ? extraction.progress : null);
  }

  // --- the apex: wake her when the player reaches the moat (organic,
  // unrelated to extraction), or as the CRESCENDO partway through the
  // extraction hold (root cause 6 - see src/game/bossWake.js) ---
  function updateBoss() {
    const dm = Math.hypot(player.p.pos.x - WORLD.maw.x, player.p.pos.z - WORLD.maw.z);
    // the jungle defers to its apex: director throttles during her fight
    director.state.bossFight = !!(boss.ref && !boss.ref.dead
      && boss.ref.state !== 'dying' && dm < 52);
    if (boss.spawned) return;
    if (shouldWakeMiremother({
      dm, extractionCommitted: extraction.committed, holdProgress: extraction.progress,
    })) {
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

  // --- revive mechanic: teammate holding E within 2m for 4s revives bleeding player ---
  function updateRevive(intents, dt) {
    // intents is now an array of intents (one per player)
    for (let bIdx = 0; bIdx < players.length; bIdx++) {
      const bPlayer = players[bIdx];
      if (bPlayer.p.bleedoutT <= 0) continue; // not bleeding out

      // Check if any alive teammate is close enough and holding interact
      let revivingTeammate = false;
      for (let tIdx = 0; tIdx < players.length; tIdx++) {
        const tPlayer = players[tIdx];
        if (tIdx === bIdx) continue;
        if (!tPlayer.p.alive) continue;

        // Check distance
        const dx = tPlayer.p.pos.x - bPlayer.p.pos.x;
        const dz = tPlayer.p.pos.z - bPlayer.p.pos.z;
        const dist = Math.hypot(dx, dz);

        // Check if this teammate's intent has interact flag
        const tIntent = intents[tIdx] || {};
        if (dist <= 2.0 && tIntent.interact) {
          revivingTeammate = true;
          break;
        }
      }

      if (revivingTeammate) {
        bPlayer.p.reviveProgress = Math.min(1, bPlayer.p.reviveProgress + dt / 4.0); // 4 second revive
        if (bPlayer.p.reviveProgress >= 1) {
          // Revive complete
          bPlayer.p.alive = true;
          bPlayer.p.hp = Math.ceil(bPlayer.p.maxHp * 0.25); // 25% HP
          bPlayer.p.bleedoutT = 0;
          bPlayer.p.reviveProgress = 0;
          U.toast('TEAMMATE REVIVED', 2.0);
        }
      } else {
        // Revive interrupted
        bPlayer.p.reviveProgress = Math.max(0, bPlayer.p.reviveProgress - dt * 0.5); // decay if interrupted
      }
    }
  }

  // --- environmental hazards ---
  let razorT = 0;
  let floodT = 0;
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

    // the flood's swarm: every player deep in risen water bleeds for it.
    // Feet above the surface = safe: height IS the mechanic.
    floodT -= dt;
    if (floodT <= 0) {
      floodT = 0.5;
      let anyBitten = false;
      for (const ctrl of players) {
        const pp = ctrl.p;
        if (!pp.alive) continue;
        const fh = flood.hazardAt(pp.pos.x, pp.pos.z, pp.pos.y - ctrl.EYE_HEIGHT);
        if (fh <= 0) continue;
        damagePlayer(difficulty.razorfinDps * fh * 0.5, pp.pos, 'flood', ctrl);
        anyBitten = true;
        effects.burst(
          new THREE.Vector3(pp.pos.x, pp.pos.y - ctrl.EYE_HEIGHT + 0.6, pp.pos.z),
          'razor', 8, 3
        );
      }
      if (anyBitten) U.onHazard('flood');
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
    for (const p of players) p.reset();
    for (const w of weaponsList) w.reset();
    for (const g of grenadesList) g.reset(difficulty.startGrenades);
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
    flood.reset();
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
  // MULTI-PLAYER SUPPORT: intents is now an array (one intent per player).
  // For backward compatibility, a single intent is wrapped in an array.
  function step(intents, dt) {
    if (game.state !== 'RUNNING') return;

    // Backward compatibility: wrap single intent in array
    if (!Array.isArray(intents)) {
      intents = [intents];
    }

    game.time += dt;
    weather.update(dt);
    flood.update(dt, players, game.time);
    enemyMgr.tuning.fixNoiseMult = weather.mods().fixNoiseMult;

    // Update each player's position and collision
    for (let i = 0; i < players.length; i++) {
      const pIntent = intents[i] || {}; // use blank intent if not provided
      players[i].update(pIntent, dt);
    }

    // keep every player camera's matrices honest even without a render
    // pass (headless: nobody else calls updateMatrixWorld)
    for (const cam of playerCameras) cam.updateMatrixWorld();

    // Each player fires/throws independently with their own weapon +
    // grenade state.
    for (let i = 0; i < players.length; i++) {
      const pIntent = intents[i] || {};
      weaponsList[i].update(pIntent, dt, game.time);
      grenadesList[i].update(pIntent, dt);
    }

    // Shared systems: run once per frame, not per player
    enemyMgr.update(dt);
    director.update(dt);
    pickups.update(dt);
    traps.update(dt);
    updateBoss();
    updateBuff(dt);
    updateHazards(dt);
    updateBleedout(dt);
    updateRevive(intents, dt);  // now passes all intents
    if (game.state === 'RUNNING') updateExtraction(dt);
  }

  return {
    game, player, players, weapons, weaponsList, weaponHooks, grenades, grenadesList,
    enemyMgr, director, pickups, traps, extraction, buff, weather, flood, boss,
    step, resetRun, setDifficulty, updateExtraction, addPlayer, damagePlayer,
    get difficulty() { return difficulty; },
  };
}

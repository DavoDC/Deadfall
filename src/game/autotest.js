// Automated playtest bot. Plays a complete run - insert, route north,
// fight what the director sends, loot what it passes, hold the beacon,
// extract or die - using only the public game systems (no cheats).
// Used headlessly via window.__deadfall.runBot(route) for balance work
// and completability regression ("can every route still be finished?").

import { WORLD, riverX } from '../world/heightmap.js';
import { hasLOS } from '../world/colliders.js';

// waypoint lines south -> north for the three advertised routes
function routeWaypoints(route) {
  const wps = [];
  if (route === 'river') {
    for (let z = 230; z >= -230; z -= 30) wps.push({ x: riverX(z), z });
  } else if (route === 'ridge') {
    wps.push({ x: 40, z: 220 }, { x: 80, z: 190 });
    for (let z = 160; z >= -160; z -= 30) {
      wps.push({ x: 112 + 22 * Math.sin(z * 0.008 + 0.6), z });
    }
    wps.push({ x: 60, z: -200 }, { x: 10, z: -230 });
  } else { // swamp
    wps.push({ x: -60, z: 220 });
    for (let z = 190; z >= -190; z -= 30) wps.push({ x: -118, z });
    wps.push({ x: -70, z: -220 });
  }
  wps.push({ x: WORLD.extraction.x, z: WORLD.extraction.z });
  return wps;
}

export function createBot(ctx) {
  // ctx: { player, weapons, enemyMgr, director, pickups, game, updateExtraction, startRun }
  const { player, weapons, enemyMgr, game } = ctx;

  function makeIntent(o = {}) {
    return Object.assign({
      moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, sprint: false, jump: false,
      reload: false, weapon1: false, weapon2: false, swap: false,
      interact: false, firing: false, fireDown: false,
    }, o);
  }

  async function runBot(route = 'river', opts = {}) {
    const maxMinutes = opts.maxMinutes ?? 12;
    ctx.startRun();
    if (document.exitPointerLock) document.exitPointerLock();
    document.getElementById('menu').classList.add('hidden');

    const wps = routeWaypoints(route);
    let wpIdx = 0;
    const dt = 1 / 60;
    const report = {
      route,
      result: null,
      timeSec: 0,
      kills: 0,
      shots: 0,
      hpTimeline: [],
      dmgTaken: 0,
      ammoPickedUp: false,
      stuck: false,
      posTrail: [],
    };
    window.__botReport = report;
    let lastHp = player.p.hp;
    let stuckRef = { x: player.p.pos.x, z: player.p.pos.z, t: 0 };
    let fireHold = 0;
    // trunk-avoidance: when velocity dies while pushing forward, slide
    // sideways around the obstruction like a human would
    let slowT = 0;
    let unstickT = 0;
    let unstickSide = Math.random() < 0.5 ? 1 : -1;
    let unstickDur = 1.1;
    let sinceUnstick = 99;
    let bestWpDist = Infinity;
    let consecStuck = 0;
    let detour = null;

    const maxFrames = maxMinutes * 60 * 60;
    for (let i = 0; i < maxFrames; i++) {
      const pp = player.p.pos;

      // --- target selection: nearest VISIBLE living enemy in 34m ---
      // (LOS check only every few frames per enemy would be cheaper, but the
      //  bot runs offline, so fairness beats speed: a human can't aim at
      //  what the foliage hides, neither may the bot)
      let target = null;
      let tDist = 34;
      for (const e of enemyMgr.aliveList()) {
        const dd = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
        if (dd < tDist
          && hasLOS(pp.x, pp.y, pp.z, e.pos.x, e.pos.y + 0.8, e.pos.z)) {
          tDist = dd;
          target = e;
        }
      }

      const intent = makeIntent();
      const st = weapons.state;

      if (target) {
        // face it (imperfect human-ish aim: slight wander)
        const aimY = target.pos.y + (target.type === 'juggernaut' ? 1.5 : 0.65);
        const dx = target.pos.x - pp.x;
        const dz = target.pos.z - pp.z;
        const dy = aimY - pp.y;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        player.p.yaw += (wantYaw - player.p.yaw) * 0.4
          + (Math.random() - 0.5) * 0.01;
        player.p.pitch += (wantPitch - player.p.pitch - player.p.kickPitch) * 0.4;

        // weapon choice
        if (tDist < 9 && st.reserve.breacher + st.mag.breacher > 0 && st.current !== 'breacher') {
          intent.weapon2 = true;
        } else if (tDist >= 9 && st.current !== 'carbine' && st.reserve.carbine + st.mag.carbine > 0) {
          intent.weapon1 = true;
        }
        // fire in bursts
        fireHold += dt;
        const aimedEnough = Math.abs(wantYaw - player.p.yaw) < 0.1;
        if (aimedEnough && st.mag[st.current] > 0) {
          intent.firing = fireHold % 0.5 < 0.32;
          intent.fireDown = true;
        } else if (st.mag[st.current] === 0) {
          intent.reload = true;
        }
        // back away from close melee while shooting
        if (tDist < 4) intent.moveZ = 1;
      } else {
        fireHold = 0;
        // navigate waypoints (or a temporary detour around a blockage)
        const wp = detour || wps[Math.min(wpIdx, wps.length - 1)];
        const dx = wp.x - pp.x;
        const dz = wp.z - pp.z;
        const dist = Math.hypot(dx, dz);
        if (detour && dist < 4) {
          detour = null;
          bestWpDist = Infinity;
        } else if (!detour && dist < 7 && wpIdx < wps.length - 1) {
          wpIdx++;
          bestWpDist = Infinity;
        }
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - player.p.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        player.p.yaw += Math.max(-0.09, Math.min(0.09, dyaw));
        player.p.pitch *= 0.9;
        intent.moveZ = -1;
        intent.sprint = player.p.stamina > 0.35;
        // opportunistic reload when quiet
        if (st.mag[st.current] < weapons.def().magSize * 0.4
          && st.reserve[st.current] > 0) intent.reload = true;

        // wedged against trunks? slide around them - commit to one side,
        // and slide longer each consecutive failure (walls, not just poles).
        // detect by lack of PROGRESS toward the waypoint, not lack of speed:
        // pushOut lets you slide along a wall at full speed going nowhere.
        sinceUnstick += dt;
        if (dist < bestWpDist - 0.8) {
          bestWpDist = dist;
          slowT = 0;
        } else if (unstickT <= 0) {
          slowT += dt;
        }
        if (unstickT <= 0 && slowT > 1.4) {
          consecStuck = sinceUnstick < 6 ? consecStuck + 1 : 1;
          if (consecStuck >= 3 && !detour) {
            // strafing failed twice - walk a real 16m dogleg around the wall
            const side = Math.random() < 0.5 ? 1 : -1;
            detour = {
              x: pp.x + Math.cos(player.p.yaw) * -16 * side,
              z: pp.z + Math.sin(player.p.yaw) * 16 * side,
            };
            consecStuck = 0;
          } else {
            unstickDur = consecStuck > 1 ? Math.min(4, unstickDur * 1.9) : 1.1;
            if (consecStuck === 1) unstickSide = Math.random() < 0.5 ? 1 : -1;
            unstickT = unstickDur;
          }
          sinceUnstick = 0;
          slowT = 0;
          bestWpDist = dist + 999; // re-baseline after the detour
        }
        if (unstickT > 0) {
          unstickT -= dt;
          intent.moveX = unstickSide;
          intent.moveZ = -0.4;
          intent.sprint = false;
        }
      }

      // --- tick the actual game systems ---
      player.update(intent, dt);
      weapons.update(intent, dt, game.time);
      enemyMgr.update(dt);
      ctx.director.update(dt);
      ctx.pickups.update(dt);
      game.time += dt;
      ctx.updateExtraction(dt);

      // --- bookkeeping ---
      if (player.p.hp < lastHp) report.dmgTaken += lastHp - player.p.hp;
      lastHp = player.p.hp;
      if (i % 300 === 0) {
        report.hpTimeline.push({ t: Math.round(i / 60), hp: Math.round(player.p.hp) });
        report.posTrail.push({ x: Math.round(pp.x), z: Math.round(pp.z) });
      }
      // stuck detection: <2.5m net movement in 10s while trying to move
      // (never fires at the final waypoint - holding the beacon is the goal)
      const atBeacon = wpIdx >= wps.length - 1
        && Math.hypot(pp.x - wps[wps.length - 1].x, pp.z - wps[wps.length - 1].z) < 10;
      stuckRef.t += dt;
      if (stuckRef.t > 10) {
        if (!target && !atBeacon
          && Math.hypot(pp.x - stuckRef.x, pp.z - stuckRef.z) < 2.5) {
          report.stuck = true;
          report.stuckAt = { x: Math.round(pp.x), z: Math.round(pp.z), wp: wpIdx };
          break;
        }
        stuckRef = { x: pp.x, z: pp.z, t: 0 };
      }

      if (game.state !== 'RUNNING') break;
      if (i % 1200 === 1199) await new Promise((r) => setTimeout(r, 0)); // yield
    }

    report.result = report.stuck ? 'STUCK' : game.state;
    report.timeSec = Math.round(game.time);
    report.kills = game.kills;
    report.shots = game.shotsFired;
    report.endHp = Math.round(player.p.hp);
    report.ammoLeft = {
      rifle: weapons.state.mag.carbine + weapons.state.reserve.carbine,
      shells: weapons.state.mag.breacher + weapons.state.reserve.breacher,
    };
    return report;
  }

  return { runBot };
}

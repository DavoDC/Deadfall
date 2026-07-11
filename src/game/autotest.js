// Automated playtest bot. Plays a complete run - insert, route north,
// cross the gorge at the route's sill, fight what the director sends,
// loot what it passes, hold the beacon, extract or die - using only the
// public sim (no cheats). Drives balance work headlessly (scripts/
// playtest.mjs) and in-browser via window.__deadfall.runBot(route).
//
// The bot plays like a competent human: aims down sights at range, swaps
// to the shotgun up close, machetes when dry, throws a grenade at clumps,
// prioritises bloomcallers (the summoner dies first), and detours around
// trunk walls when it stops making progress.

import { WORLD, riverX, gorgeZ, razorfinHazard } from '../world/heightmap.js';
import { hasLOS } from '../world/colliders.js';

// waypoint lines south -> north for the three advertised routes; each one
// threads its own gorge crossing (causeway / rapids / fallen giant)
function routeWaypoints(route) {
  const wps = [];
  const cross = (i, pad = 26) => {
    const c = WORLD.crossings[i];
    const zg = gorgeZ(c.x);
    wps.push({ x: c.x, z: zg + pad }, { x: c.x, z: zg }, { x: c.x, z: zg - pad });
  };
  if (route === 'river') {
    for (let z = 280; z >= 20; z -= 30) wps.push({ x: riverX(z), z });
    cross(1);
    for (let z = -90; z >= -240; z -= 30) wps.push({ x: riverX(z), z });
    wps.push({ x: 30, z: -270 }, { x: 62, z: -292 });
  } else if (route === 'ridge') {
    wps.push({ x: 30, z: 280 }, { x: 80, z: 240 });
    for (let z = 200; z >= 0; z -= 30) {
      wps.push({ x: 112 + 22 * Math.sin(z * 0.008 + 0.6), z });
    }
    cross(2);
    wps.push({ x: 148, z: -112 }, { x: 128, z: -170 }, { x: 108, z: -230 }, { x: 96, z: -275 });
  } else { // swamp
    wps.push({ x: -60, z: 280 }, { x: -100, z: 250 });
    for (let z = 220; z >= 10; z -= 30) wps.push({ x: -118, z });
    cross(0);
    wps.push({ x: -90, z: -120 }, { x: -56, z: -176 }, { x: 10, z: -230 }, { x: 48, z: -272 });
  }
  wps.push({ x: WORLD.extraction.x, z: WORLD.extraction.z });
  return wps;
}

// aim heights per enemy type (where the bot points, human-fair)
const AIM_Y = {
  prowler: 0.65,
  spitter: 1.0,
  juggernaut: 1.5,
  stingerwing: 0,     // aim at its centre - it IS the body
  shrike: 1.0,
  bloomcaller: 1.6,
};

export function createBot(ctx) {
  // ctx: { sim, startRun } - startRun must put sim into a fresh RUNNING state
  const { sim } = ctx;
  const { player, weapons, enemyMgr, game } = sim;

  function makeIntent(o = {}) {
    return Object.assign({
      moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, sprint: false, jump: false,
      reload: false, weapon1: false, weapon2: false, weapon3: false,
      swap: false, interact: false, melee: false,
      grenadeHold: false, grenadeThrow: false, aim: false,
      firing: false, fireDown: false,
    }, o);
  }

  async function runBot(route = 'river', opts = {}) {
    const maxMinutes = opts.maxMinutes ?? 18;
    if (opts.difficulty) sim.setDifficulty(opts.difficulty);
    ctx.startRun();
    if (typeof document !== 'undefined') {
      if (document.exitPointerLock) document.exitPointerLock();
      const menu = document.getElementById('menu');
      if (menu) menu.classList.add('hidden');
    }

    const wps = routeWaypoints(route);
    let wpIdx = 0;
    const dt = 1 / 60;
    const report = {
      route,
      difficulty: sim.difficulty.key,
      result: null,
      timeSec: 0,
      kills: 0,
      shots: 0,
      hpTimeline: [],
      dmgTaken: 0,
      grenadesThrown: 0,
      stuck: false,
      posTrail: [],
    };
    if (typeof window !== 'undefined') window.__botReport = report;
    let lastHp = player.p.hp;
    let stuckRef = { x: player.p.pos.x, z: player.p.pos.z, t: 0 };
    let fireHold = 0;
    // trunk-avoidance: when progress toward the waypoint dies, slide
    // sideways around the obstruction like a human would
    let slowT = 0;
    let unstickT = 0;
    let unstickSide = Math.random() < 0.5 ? 1 : -1;
    let unstickDur = 1.1;
    let sinceUnstick = 99;
    let bestWpDist = Infinity;
    let consecStuck = 0;
    let detour = null;
    let grenadeCd = 0;

    const maxFrames = maxMinutes * 60 * 60;
    for (let i = 0; i < maxFrames; i++) {
      const pp = player.p.pos;

      // --- target selection: nearest VISIBLE living enemy in 36m, with
      // priority: bloomcallers die first, then whatever is closest ---
      let target = null;
      let tDist = 36;
      let sawBloom = false;
      for (const e of enemyMgr.aliveList()) {
        const dd = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
        if (dd >= tDist && !(e.type === 'bloomcaller' && !sawBloom && dd < 40)) continue;
        const aimY = e.pos.y + (AIM_Y[e.type] ?? 0.8);
        if (!hasLOS(pp.x, pp.y, pp.z, e.pos.x, aimY, e.pos.z)) continue;
        const isBloom = e.type === 'bloomcaller';
        if (isBloom && !sawBloom) {
          // priority override
          target = e;
          tDist = dd;
          sawBloom = true;
        } else if (!sawBloom && dd < tDist) {
          target = e;
          tDist = dd;
        }
      }

      const intent = makeIntent();
      const st = weapons.state;
      grenadeCd = Math.max(0, grenadeCd - dt);

      if (target) {
        // face it (imperfect human-ish aim: slight wander)
        const aimY = target.pos.y + (AIM_Y[target.type] ?? 0.8);
        const dx = target.pos.x - pp.x;
        const dz = target.pos.z - pp.z;
        const dy = aimY - pp.y;
        const wantYaw = Math.atan2(-dx, -dz);
        const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        player.p.yaw += (wantYaw - player.p.yaw) * 0.4
          + (Math.random() - 0.5) * 0.01;
        player.p.pitch += (wantPitch - player.p.pitch - player.p.kickPitch) * 0.4;

        // grenade a clump: 3+ hostiles within 7m of the target, mid-range
        if (grenadeCd <= 0 && sim.grenades.state.count > 0
          && tDist > 9 && tDist < 24) {
          let clump = 0;
          for (const e of enemyMgr.aliveList()) {
            if (Math.hypot(e.pos.x - target.pos.x, e.pos.z - target.pos.z) < 7) clump++;
          }
          if (clump >= 3) {
            intent.grenadeThrow = true;
            grenadeCd = 9;
            report.grenadesThrown++;
          }
        }

        // weapon choice: shotgun close, longarm far (if fed), carbine default
        const haveLong = st.mag.longarm + st.reserve.longarm > 0;
        if (tDist < 9 && st.reserve.breacher + st.mag.breacher > 0 && st.current !== 'breacher') {
          intent.weapon2 = true;
        } else if (tDist > 34 && haveLong && st.current !== 'longarm') {
          intent.weapon3 = true;
        } else if (tDist >= 9 && tDist <= 34 && st.current !== 'carbine'
          && st.reserve.carbine + st.mag.carbine > 0) {
          intent.weapon1 = true;
        }

        // ADS at range - this is why the round-2 bot can actually hit
        intent.aim = tDist > 10;

        // fire in bursts
        fireHold += dt;
        const aimedEnough = Math.abs(wantYaw - player.p.yaw) < (intent.aim ? 0.06 : 0.1);
        const totalAmmo = st.mag[st.current] + st.reserve[st.current];
        if (aimedEnough && st.mag[st.current] > 0) {
          intent.firing = fireHold % 0.5 < 0.32;
          intent.fireDown = true;
        } else if (st.mag[st.current] === 0 && st.reserve[st.current] > 0) {
          intent.reload = true;
        }
        // dry everywhere? the machete never runs out
        if (totalAmmo === 0 && tDist < 3.2) intent.melee = true;
        // back away from close melee while shooting; otherwise keep
        // drifting up the route like a human clearing while moving
        if (tDist < 4) intent.moveZ = 1;
        else if (tDist > 8 && player.p.hp > 45) intent.moveZ = -0.6;
        // strafe-dodge ranged attackers (acid arcs are dodgeable on foot)
        if (target.type === 'spitter' || target.type === 'bloomcaller') {
          intent.moveX = Math.sin(game.time * 1.6) > 0 ? 1 : -1;
        }
      } else {
        fireHold = 0;
        // hurt and quiet? go get that glowing medkit like a human would
        let medTarget = null;
        if (player.p.hp < 62) {
          let best = 30;
          for (const item of sim.pickups.items) {
            if (!item.active || item.type !== 'medkit') continue;
            const dd = Math.hypot(item.pos.x - pp.x, item.pos.z - pp.z);
            if (dd < best) {
              best = dd;
              medTarget = { x: item.pos.x, z: item.pos.z };
            }
          }
        }
        // navigate waypoints (or a detour: blockage dogleg / medkit run)
        const wp = medTarget || detour || wps[Math.min(wpIdx, wps.length - 1)];
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
        // detect by lack of PROGRESS toward the waypoint, not lack of speed
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

      // razorfin water is an emergency: swim for the nearest bank NOW
      if (razorfinHazard(pp.x, pp.z) > 0) {
        const zg = gorgeZ(pp.x);
        const north = pp.z < zg; // already past centre? push on north (yaw 0)
        let dyaw = (north ? 0 : Math.PI) - player.p.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        player.p.yaw += Math.max(-0.15, Math.min(0.15, dyaw));
        intent.moveZ = -1;
        intent.moveX = 0;
        intent.sprint = true;
        intent.aim = false;
      }

      // --- tick the actual game ---
      sim.step(intent, dt);

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

    report.result = report.stuck ? 'STUCK'
      : game.state === 'RUNNING' ? 'TIMEOUT' : game.state;
    report.timeSec = Math.round(game.time);
    report.kills = game.kills;
    report.shots = game.shotsFired;
    report.endHp = Math.round(player.p.hp);
    report.ammoLeft = {
      rifle: weapons.state.mag.carbine + weapons.state.reserve.carbine,
      shells: weapons.state.mag.breacher + weapons.state.reserve.breacher,
      long: weapons.state.mag.longarm + weapons.state.reserve.longarm,
    };
    report.dmgBySource = {};
    for (const [k, v] of Object.entries(game.dmgBySource)) {
      report.dmgBySource[k] = Math.round(v);
    }
    return report;
  }

  return { runBot };
}

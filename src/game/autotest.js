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

import {
  WORLD, riverX, gorgeZ, palisadeZ, fractureZ, razorfinHazard,
} from '../world/heightmap.js';
import { hasLOS } from '../world/colliders.js';

// Waypoint lines south -> north for the three advertised routes. Round 3
// made the world physically gated, so every route threads: a Palisade gate,
// its gorge crossing, a Fracture way up to the highlands, then winds around
// the thicket walls to the mesa stair (which climbs out of the Sunken Maw).
// Exported so the unit tests can prove every route is actually walkable.
export function routeWaypoints(route) {
  const wps = [];
  const cross = (i, pad = 26) => {
    const c = WORLD.crossings[i];
    const zg = gorgeZ(c.x);
    wps.push({ x: c.x, z: zg + pad }, { x: c.x, z: zg }, { x: c.x, z: zg - pad });
  };
  const gate = (i, pad = 22) => {
    const g = WORLD.gates[i];
    const zg = palisadeZ(g.x);
    wps.push({ x: g.x, z: zg + pad }, { x: g.x, z: zg }, { x: g.x, z: zg - pad });
  };
  const fractureAt = (x, pad = 20) => {
    const zf = fractureZ(x);
    wps.push({ x, z: zf + pad }, { x, z: zf }, { x, z: zf - pad });
  };
  // shared final leg: wade INTO the Sunken Maw (the boss's moat), then up
  // the drowned stair ramp that climbs out of it onto the butte
  const stair = () => {
    wps.push(
      { x: 6, z: -250 }, { x: 26, z: -262 }, { x: 44, z: -274 },
      { x: 58, z: -284 }, { x: 70, z: -295 },
    );
  };
  if (route === 'river') {
    wps.push({ x: -18, z: 292 }, { x: riverX(250), z: 250 }, { x: riverX(210), z: 210 });
    gate(1);
    for (let z = 120; z >= 20; z -= 25) wps.push({ x: riverX(z), z });
    cross(1);
    wps.push({ x: -30, z: -100 }, { x: -52, z: -140 });
    fractureAt(WORLD.bonebridge.x);
    wps.push({ x: -34, z: -232 });
    stair();
  } else if (route === 'ridge') {
    wps.push({ x: 10, z: 290 }, { x: 44, z: 278 }, { x: 104, z: 240 }, { x: 128, z: 206 });
    gate(2);
    wps.push({ x: 135, z: 90 }, { x: 146, z: 34 }, { x: 140, z: 0 });
    cross(2);
    wps.push({ x: 144, z: -130 });
    fractureAt(WORLD.scree.x);
    // the thicket below the scree forces the long way round, east then south
    wps.push({ x: 176, z: -230 }, { x: 148, z: -262 }, { x: 108, z: -266 });
    wps.push({ x: 76, z: -256 }, { x: 52, z: -272 }, { x: 63, z: -288 }, { x: 74, z: -298 });
  } else { // swamp
    wps.push({ x: -60, z: 285 }, { x: -95, z: 262 });
    gate(0);
    // (skirt the swamp shrine ruin itself - its blocks wedge the bot)
    wps.push({ x: -112, z: 110 }, { x: -126, z: 74 }, { x: -120, z: 40 }, { x: -112, z: 8 });
    cross(0);
    wps.push({ x: -90, z: -110 }, { x: -70, z: -150 });
    fractureAt(WORLD.bonebridge.x);
    wps.push({ x: -34, z: -232 });
    stair();
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
  miremother: 0,      // e.pos IS her head
};

// Miremother states in which she can actually be shot
const BOSS_TARGETABLE = new Set(['coil', 'telegraph', 'strike', 'recover', 'venom', 'erupt']);

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
    let razorEscapeYaw = null;

    const maxFrames = maxMinutes * 60 * 60;
    for (let i = 0; i < maxFrames; i++) {
      const pp = player.p.pos;

      // --- target selection with engagement TRIAGE: a runner does not
      // clear the jungle, they clear what is in the way. Fight only what
      // is close, actively attacking, or a bloomcaller (kill on sight -
      // it multiplies). Everything else: keep moving north. ---
      let target = null;
      let tDist = Infinity;
      let sawBloom = false;
      let sawBoss = false;
      // on DEADFALL the winning strategy is different: fight even less,
      // keep moving - you cannot out-kill the hard director's budget
      const hardMode = sim.difficulty.key === 'hard';
      for (const e of enemyMgr.aliveList()) {
        const dd = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
        const isBoss = e.type === 'miremother';
        if (isBoss && !BOSS_TARGETABLE.has(e.state)) continue; // she's under
        const attacking = e.state === 'windup' || e.state === 'lunge'
          || e.state === 'charge' || e.state === 'chargewind' || e.state === 'air'
          || e.state === 'telegraph' || e.state === 'strike';
        const isBloom = e.type === 'bloomcaller';
        const engage = isBoss ? dd < 44
          : isBloom ? dd < 42
            : attacking ? dd < (hardMode ? 24 : 30)
              : dd < (hardMode ? 13 : 18);
        if (!engage) continue;
        const aimY = e.pos.y + (AIM_Y[e.type] ?? 0.8);
        if (!hasLOS(pp.x, pp.y, pp.z, e.pos.x, aimY, e.pos.z)) continue;
        if (isBoss) {
          // the apex outranks everything - she blocks the stair
          target = e;
          tDist = dd;
          sawBoss = true;
        } else if (isBloom && !sawBloom && !sawBoss) {
          // priority override: the summoner dies first
          target = e;
          tDist = dd;
          sawBloom = true;
        } else if (!sawBloom && !sawBoss && dd < tDist) {
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
        else if (tDist > (hardMode ? 5 : 8) && player.p.hp > (hardMode ? 30 : 45)) {
          intent.moveZ = hardMode ? -0.85 : -0.6;
        }
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

      // the Miremother's wake hunts you underwater - if the foam line is
      // close, sprint off it (standing still eats the eruption)
      for (const e of enemyMgr.aliveList()) {
        if (e.type !== 'miremother') continue;
        if ((e.state === 'wake' || e.state === 'erupt') && e.wakePos) {
          const wd = Math.hypot(pp.x - e.wakePos.x, pp.z - e.wakePos.z);
          if (wd < 8) {
            intent.moveX = Math.sin(game.time * 0.9) > 0 ? 1 : -1;
            intent.moveZ = -1;
            intent.sprint = true;
            intent.aim = false;
          }
        }
      }

      // dodge committed attacks like a human: a charging juggernaut, a
      // pouncing shrike and a striking Miremother are locked onto a line -
      // step OFF the line, hard
      for (const e of enemyMgr.aliveList()) {
        const charging = (e.type === 'juggernaut' && (e.state === 'charge' || e.state === 'chargewind'))
          || (e.type === 'miremother' && (e.state === 'telegraph' || e.state === 'strike'));
        const pouncing = e.type === 'shrike' && e.state === 'air' && e.pouncing;
        if (!charging && !pouncing) continue;
        const ex = pp.x - e.pos.x;
        const ez = pp.z - e.pos.z;
        const ed = Math.hypot(ex, ez);
        if (ed > 16) continue;
        // step to whichever side of the attack line we already lean toward
        const hx = Math.sin(e.heading);
        const hz = Math.cos(e.heading);
        const side = Math.sign(ex * hz - ez * hx) || 1;
        // convert world side direction into strafe relative to player yaw
        const dodgeX = hz * side;
        const dodgeZ = -hx * side;
        const fwdX = -Math.sin(player.p.yaw);
        const fwdZ = -Math.cos(player.p.yaw);
        const rightX = -fwdZ;
        const rightZ = fwdX;
        intent.moveX = Math.sign(dodgeX * rightX + dodgeZ * rightZ) || 1;
        intent.moveZ = 0.4; // and give ground
        intent.sprint = false;
        break;
      }

      // razorfin water is an emergency: swim for the nearest bank NOW.
      // Latch the chosen bank until clear - dithering at the centreline
      // while the swarm feeds is how one bot run bled out.
      if (razorfinHazard(pp.x, pp.z) > 0) {
        if (razorEscapeYaw === null) {
          const north = pp.z < gorgeZ(pp.x); // past centre? push on north
          razorEscapeYaw = north ? 0 : Math.PI;
        }
        let dyaw = razorEscapeYaw - player.p.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        player.p.yaw += Math.max(-0.15, Math.min(0.15, dyaw));
        intent.moveZ = -1;
        intent.moveX = 0;
        intent.sprint = true;
        intent.aim = false;
      } else {
        razorEscapeYaw = null;
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
      if (stuckRef.t > 14) {
        if (!target && !atBeacon
          && Math.hypot(pp.x - stuckRef.x, pp.z - stuckRef.z) < 2.2) {
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

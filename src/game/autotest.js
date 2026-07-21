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
  WORLD, FLOOD, riverX, gorgeZ, palisadeZ, fractureZ, razorfinHazard,
  floodMask, terrainHeight,
} from '../world/heightmap.js';
import { hasLOS } from '../world/colliders.js';
import { ROOSTS } from '../world/roosts.js';

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
    // (skirt the swamp shrine ruin itself - its blocks wedge the bot; the
    // straight line to -126,74 still clipped the cluster at 5m, so swing
    // wide through -138,88 for real clearance)
    wps.push({ x: -112, z: 110 }, { x: -138, z: 88 }, { x: -128, z: 62 }, { x: -120, z: 40 }, { x: -112, z: 8 });
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
  viperblossom: 1.4,  // aim at the bulb/eye
};

// Miremother states in which she can actually be shot
const BOSS_TARGETABLE = new Set(['coil', 'telegraph', 'strike', 'recover', 'venom', 'erupt']);

// Dodge reaction to a committed/telegraphed attack, checked in priority
// order - only the FIRST match fires, matching how a human reacts to the
// most urgent threat in front of them, not several superimposed dodges.
// Exported and pure (no sim access) so it is unit-tested in isolation
// (tests/dodgeIntent.test.js) rather than only through a full bot run.
export function computeDodgeIntent(enemies, pp, yaw) {
  for (const e of enemies) {
    const charging = (e.type === 'juggernaut' && (e.state === 'charge' || e.state === 'chargewind'))
      || (e.type === 'miremother' && (e.state === 'telegraph' || e.state === 'strike'));
    const pouncing = e.type === 'shrike' && e.state === 'air' && e.pouncing;
    // round: extraction-redesign (root cause 1) - the juggernaut's melee
    // windup now has a real tell (roar + flaring back boil, enemies.js
    // updateJuggernaut). A player who catches it has time to open distance
    // before the 0.5s windup ends. Unlike a charge/pounce it is NOT a
    // committed line to step off - it is stationary and purely range-based
    // (hit test is a radius check, enemies.js:~620), so the correct
    // reaction is straight back, not a lateral sidestep.
    const meleeWindup = e.type === 'juggernaut' && e.state === 'windup';
    if (!charging && !pouncing && !meleeWindup) continue;
    const ex = pp.x - e.pos.x;
    const ez = pp.z - e.pos.z;
    const ed = Math.hypot(ex, ez);
    if (ed > (meleeWindup ? 6 : 16)) continue;
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    if (meleeWindup) {
      const inv = ed > 0.05 ? 1 / ed : 0;
      const awayX = ex * inv;
      const awayZ = ez * inv;
      return {
        moveX: awayX * rightX + awayZ * rightZ,
        moveZ: -(awayX * fwdX + awayZ * fwdZ),
        sprint: true, // only actually engages if this nets moveZ < 0 - the
        // game does not let you sprint backward, same as a human player
      };
    }
    // step to whichever side of the attack line we already lean toward
    const hx = Math.sin(e.heading);
    const hz = Math.cos(e.heading);
    const side = Math.sign(ex * hz - ez * hx) || 1;
    const dodgeX = hz * side;
    const dodgeZ = -hx * side;
    return {
      moveX: Math.sign(dodgeX * rightX + dodgeZ * rightZ) || 1,
      moveZ: 0.4, // and give ground
      sprint: false,
    };
  }
  return null;
}

export function createBot(ctx) {
  // ctx: { sim, startRun } - startRun must put sim into a fresh RUNNING state
  const { sim } = ctx;
  const { enemyMgr, game } = sim;

  function makeIntent(o = {}) {
    return Object.assign({
      moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, sprint: false, jump: false,
      reload: false, weapon1: false, weapon2: false, weapon3: false,
      swap: false, interact: false, melee: false,
      grenadeHold: false, grenadeThrow: false, aim: false,
      firing: false, fireDown: false,
    }, o);
  }

  // route/opts drive one bot's play-through; playerIdx selects WHICH of
  // sim.players it drives (0 = solo/first coop player, 1 = second coop
  // player, ...). Solo play never touches player index 1+; coop runs two
  // of these concurrently against the same sim (see opts.coopSync below).
  async function runBot(route = 'river', opts = {}, playerIdx = 0) {
    const maxMinutes = opts.maxMinutes ?? 18;
    if (opts.difficulty) sim.setDifficulty(opts.difficulty);
    if (!opts.skipStartRun) ctx.startRun();
    const player = sim.players[playerIdx];
    const weapons = sim.weaponsList[playerIdx];
    const grenades = sim.grenadesList[playerIdx];
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
    let razorLastZ = 0;
    let razorStallT = 0;
    let razorStrafeT = 0;
    let razorSide = 1;
    // flood retreat (round 5): when the gorge swells, stop routing and
    // climb the nearest same-side roost; wait perched until it drains
    let floodRetreat = null;   // { roost, stage: 'base'|'top' }
    let floodBusy = false;     // retreating or holding - suppress stuck logic
    let floodBestD = Infinity; // retreat progress tracker (trunk unstick)
    let floodSlowT = 0;
    let floodStrafeT = 0;
    let floodSide = 1;

    const maxFrames = maxMinutes * 60 * 60;
    for (let i = 0; i < maxFrames; i++) {
      const pp = player.p.pos;

      // Test-only hook: lets the caller (playtest.mjs's coop revive gate)
      // deterministically force this player into bleedout at a known frame,
      // rather than waiting on unseeded-RNG combat to organically produce
      // one. Never used outside tests (opts.debugHook is undefined normally).
      if (opts.debugHook) opts.debugHook(i, player, playerIdx);

      const intent = makeIntent();
      let target = null; // referenced by the stuck-check below even when dead

      // Coop: while this player is bleeding out or permanently dead,
      // controller.update() ignores their intent entirely (movement is
      // frozen) - so skip ALL decision-making below. This matters beyond
      // just wasted work: the waypoint/unstick state machine (bestWpDist,
      // slowT, unstickT, consecStuck, detour) is driven by "distance to
      // waypoint hasn't improved," and a frozen player's distance never
      // improves - left running, it would count seconds of forced
      // immobility as being stuck, escalate through the unstick timers,
      // and eventually commit to a bogus 16m detour before the player can
      // even move again, corrupting navigation for the rest of the run
      // (this caused real, reproducible STUCK failures in the coop
      // down-and-revive gate until this guard was added).
      if (player.p.alive) {
      // --- target selection with engagement TRIAGE: a runner does not
      // clear the jungle, they clear what is in the way. Fight only what
      // is close, actively attacking, or a bloomcaller (kill on sight -
      // it multiplies). Everything else: keep moving north. ---
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
        // skip dormant viperblossoms (they look innocent)
        if (e.type === 'viperblossom' && e.state === 'dormant') continue;
        const attacking = e.state === 'windup' || e.state === 'lunge'
          || e.state === 'charge' || e.state === 'chargewind' || e.state === 'air'
          || e.state === 'telegraph' || e.state === 'strike'
          || (e.type === 'viperblossom' && (e.state === 'burst' || e.state === 'lash'));
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
        if (grenadeCd <= 0 && grenades.state.count > 0
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
        } else if (!detour && !medTarget && dist < 7 && wpIdx < wps.length - 1) {
          // (!medTarget: dist is to the MEDKIT during a health run - it
          // once ratcheted wpIdx up every frame beside a kit, warping the
          // route target to the beacon from mid-map)
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

      // dodge committed/telegraphed attacks like a human: a charging
      // juggernaut, a pouncing shrike, a striking Miremother, and now a
      // juggernaut mid melee-windup (see computeDodgeIntent above)
      const dodge = computeDodgeIntent(enemyMgr.aliveList(), pp, player.p.yaw);
      if (dodge) {
        intent.moveX = dodge.moveX;
        intent.moveZ = dodge.moveZ;
        intent.sprint = dodge.sprint;
      }

      // THE FLOOD (round 5): the correct play is written on the tin -
      // get high. Reading it here is what the telegraph window is FOR.
      floodBusy = false;
      let floodTarget = null;
      const fl = sim.flood;
      // terrain-aware threat: the flood only matters where the FULL rise
      // would actually drown the ground - high terrain inside the band is
      // already the retreat (a bot on a 19m ridge shoulder once waited
      // out the whole event it was never in danger from)
      // (mask gate 0.22 = at least ~2m of ADDED water projected - the
      // band's outer feather adds centimetres, which is not a threat
      // worth standing still in spitter range for)
      const drowns = (x, z) => {
        const m = floodMask(x, z);
        return m > 0.22
          && terrainHeight(x, z) < WORLD.waterLevel + FLOOD.RISE_MAX * m + 0.4;
      };
      if (fl && fl.dangerous()) {
        if (!floodRetreat && drowns(pp.x, pp.z)) {
          // nearest roost on THIS side of the rift - never swim the
          // razorfin gorge to reach a perch
          const mySide = Math.sign(pp.z - gorgeZ(pp.x)) || 1;
          let best = null;
          for (const r of ROOSTS) {
            if (r.side !== mySide) continue;
            const dd = Math.hypot(r.base.x - pp.x, r.base.z - pp.z);
            if (!best || dd < best.dd) best = { r, dd };
          }
          if (best) {
            floodRetreat = { roost: best.r, stage: 'base' };
            floodBestD = Infinity;
            floodSlowT = 0;
          }
        }
        if (floodRetreat) {
          const r = floodRetreat.roost;
          if (floodRetreat.stage === 'base'
            && Math.hypot(pp.x - r.base.x, pp.z - r.base.z) < 2.2) {
            floodRetreat.stage = 'top'; // at the bole - walk the treads up
            floodBestD = Infinity;
            floodSlowT = 0;
          }
          const goal = floodRetreat.stage === 'base' ? r.base : r.top;
          const gd = Math.hypot(pp.x - goal.x, pp.z - goal.z);
          if (floodRetreat.stage === 'top' && gd < 2.4) {
            floodBusy = true; // perched (or beside the crown): hold fast
            floodRetreat.perched = true;
          } else {
            floodTarget = goal;
          }
        } else if (!floodRetreat) {
          // safe ground: do not walk INTO drowning water - hold here
          // until it drains (checks the waypoint AND the approach to it)
          const wpNow = wps[Math.min(wpIdx, wps.length - 1)];
          const midX = (pp.x + wpNow.x) / 2;
          const midZ = (pp.z + wpNow.z) / 2;
          if (drowns(wpNow.x, wpNow.z) || drowns(midX, midZ)) floodBusy = true;
        }
      } else if (floodRetreat) {
        floodRetreat = null;      // drained - climb down, resume the run
        // rejoin the route at the NEAREST waypoint: the retreat dragged
        // us off the proven lane, and pressing blindly at the old target
        // funnels through unproven jungle (a deterministic trunk pocket
        // at 149,-112 ate three runs exactly this way)
        let bi = wpIdx;
        let bd = Infinity;
        const lo = Math.max(0, wpIdx - 2);
        const hi = Math.min(wps.length - 1, wpIdx + 1);
        for (let wi = lo; wi <= hi; wi++) {
          const dd = Math.hypot(wps[wi].x - pp.x, wps[wi].z - pp.z);
          if (dd < bd) {
            bd = dd;
            bi = wi;
          }
        }
        wpIdx = bi;
        bestWpDist = Infinity;    // re-baseline nav after the detour
        slowT = 0;
        detour = null;
      }

      // razorfin water is an emergency: swim for the nearest bank NOW.
      // Latch the chosen bank until clear - dithering at the centreline
      // while the swarm feeds is how one bot run bled out.
      if (razorfinHazard(pp.x, pp.z) > 0) {
        if (razorEscapeYaw === null) {
          const north = pp.z < gorgeZ(pp.x); // past centre? push on north
          razorEscapeYaw = north ? 0 : Math.PI;
          razorLastZ = pp.z;
          razorStallT = 0;
          razorStrafeT = 0;
        }
        let dyaw = razorEscapeYaw - player.p.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        player.p.yaw += Math.max(-0.15, Math.min(0.15, dyaw));
        intent.moveZ = -1;
        intent.moveX = 0;
        intent.sprint = true;
        intent.aim = false;
        // wedged against a bank trunk while the swarm feeds? strafe off
        // it - the escape line had no unstick and bots drowned in place
        if (Math.abs(pp.z - razorLastZ) > 0.5) {
          razorLastZ = pp.z;
          razorStallT = 0;
        } else if (razorStrafeT <= 0) {
          razorStallT += dt;
        }
        if (razorStrafeT <= 0 && razorStallT > 1.2) {
          razorStrafeT = 0.9;
          razorSide = -razorSide;
          razorStallT = 0;
        }
        if (razorStrafeT > 0) {
          razorStrafeT -= dt;
          intent.moveX = razorSide;
        }
      } else {
        razorEscapeYaw = null;
      }

      // flood movement override: outranks combat positioning and normal
      // nav (you cannot win a fight underwater), but NOT the razorfin
      // escape above - swim out of the swarm first, then climb
      if (razorfinHazard(pp.x, pp.z) <= 0) {
        if (floodTarget) {
          const fdx = floodTarget.x - pp.x;
          const fdz = floodTarget.z - pp.z;
          const gd = Math.hypot(fdx, fdz);
          const wantYaw = Math.atan2(-fdx, -fdz);
          let dyaw = wantYaw - player.p.yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          player.p.yaw += Math.max(-0.12, Math.min(0.12, dyaw));
          intent.moveX = 0;
          intent.moveZ = -1;
          intent.sprint = player.p.stamina > 0.2;
          intent.aim = false;
          // wedged on a trunk mid-retreat? strafe around it - drowning
          // in place because a tree was in the way is not a strategy
          if (gd < floodBestD - 0.6) {
            floodBestD = gd;
            floodSlowT = 0;
          } else if (floodStrafeT <= 0) {
            floodSlowT += dt;
          }
          if (floodStrafeT <= 0 && floodSlowT > 1.3) {
            floodStrafeT = 1.0;
            floodSide = -floodSide;
            floodSlowT = 0;
          }
          if (floodStrafeT > 0) {
            floodStrafeT -= dt;
            intent.moveX = floodSide;
            intent.moveZ = -0.4;
          }
          floodBusy = true;
        } else if (floodBusy) {
          // perched: stand fast whatever happens - the perch IS the play.
          // edge-holding with a live attacker: keep the combat footwork
          // (statues die to acid arcs), just do not resume the route.
          const perched = floodRetreat && floodRetreat.perched;
          if (perched || !target) {
            intent.moveX = 0;
            intent.moveZ = 0;
            intent.sprint = false;
          }
          slowT = 0;
        }
      }
      } // end: if (player.p.alive) - decision-making guard

      // --- coop: a downed teammate outranks everything above. Path to
      // them and hold interact within revive range (sim.js: updateRevive,
      // 2m / 4s). Only relevant once there's more than one player. ---
      if (sim.players.length > 1 && player.p.alive) {
        let downed = null;
        for (let oi = 0; oi < sim.players.length; oi++) {
          if (oi === playerIdx) continue;
          if (sim.players[oi].p.bleedoutT > 0) { downed = sim.players[oi]; break; }
        }
        if (downed) {
          const rdx = downed.p.pos.x - pp.x;
          const rdz = downed.p.pos.z - pp.z;
          const rdist = Math.hypot(rdx, rdz);
          const wantYaw = Math.atan2(-rdx, -rdz);
          let dyaw = wantYaw - player.p.yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          player.p.yaw += Math.max(-0.12, Math.min(0.12, dyaw));
          intent.moveX = 0;
          intent.moveZ = rdist > 1.5 ? -1 : 0;
          intent.sprint = rdist > 4 && player.p.stamina > 0.3;
          intent.interact = rdist <= 2.0;
          intent.firing = false;
          intent.fireDown = false;
          intent.grenadeThrow = false;
          intent.melee = false;
        }
      }

      // --- tick the actual game ---
      // Solo: this bot drives sim.step() itself, one call per frame.
      // Coop: both bots submit their intent to the shared frame barrier;
      // whichever arrives last performs the single sim.step([...], dt)
      // call for that frame, and both resume together.
      if (opts.coopSync) {
        await opts.coopSync.submitAndWait(playerIdx, intent);
      } else {
        sim.step(intent, dt);
      }

      // --- bookkeeping ---
      if (player.p.hp < lastHp) report.dmgTaken += lastHp - player.p.hp;
      lastHp = player.p.hp;
      if (i % 300 === 0) {
        report.hpTimeline.push({ t: Math.round(i / 60), hp: Math.round(player.p.hp) });
        report.posTrail.push({ x: Math.round(pp.x), z: Math.round(pp.z) });
      }
      // stuck detection: <2.5m net movement in 10s while trying to move
      // (never fires at the final waypoint - holding the beacon is the goal)
      // Skipped entirely while this player is bleeding out/dead: standing
      // still then is CORRECT (controller.update freezes them), not stuck -
      // and falsely breaking this loop would stop it calling
      // coopSync.submitAndWait, deadlocking the other bot's coop frame.
      const atBeacon = wpIdx >= wps.length - 1
        && Math.hypot(pp.x - wps[wps.length - 1].x, pp.z - wps[wps.length - 1].z) < 10;
      if (player.p.alive && floodBusy) {
        // holding out a flood is CORRECT stillness - keep the window
        // fresh so release is never judged by a half-spent-standing one
        stuckRef = { x: pp.x, z: pp.z, t: 0 };
      } else if (player.p.alive) {
        stuckRef.t += dt;
        if (stuckRef.t > 14) {
          if (!target && !atBeacon
            && Math.hypot(pp.x - stuckRef.x, pp.z - stuckRef.z) < 2.2) {
            report.stuck = true;
            report.stuckAt = {
              x: Math.round(pp.x), z: Math.round(pp.z), wp: wpIdx,
              flood: sim.flood ? sim.flood.state.phase : 'none',
            };
            break;
          }
          stuckRef = { x: pp.x, z: pp.z, t: 0 };
        }
      } else {
        stuckRef = { x: pp.x, z: pp.z, t: 0 };
      }

      if (game.state !== 'RUNNING') break;
      if (i % 1200 === 1199) await new Promise((r) => setTimeout(r, 0)); // yield
    }

    // Coop: this bot's loop just ended (WIN/DEAD/STUCK/TIMEOUT - STUCK and
    // TIMEOUT are per-bot local conditions, not shared game.state, so the
    // OTHER bot may still be mid-run). Tell the barrier this player is no
    // longer submitting intents, or the other bot's next submitAndWait()
    // would wait forever for an intent that will never arrive.
    if (opts.coopSync) opts.coopSync.leave(playerIdx);

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

// Coop frame barrier: N concurrent runBot() calls share ONE sim, and the
// whole point of coop is that they share ONE frame loop too - both
// intents collected, then exactly one sim.step([intent0, intent1, ...], dt)
// call per frame, not two independent (and therefore double-speed,
// out-of-sync) steps. Whichever bot's intent arrives LAST each frame is
// the one that actually calls sim.step(); everyone then proceeds together.
// Replaces the old runDualBots, which drove its own separate dumb AI
// instead of reusing runBot.
// `active` tracks which player indices are still submitting intents each
// frame. A bot leaves (via leave()) the moment its own runBot loop ends -
// WIN/DEAD are shared game.state and end every bot's loop on the same
// frame, but STUCK/TIMEOUT are per-bot local conditions, so one bot can
// keep running solo after the other drops out. Without leave(), the
// remaining bot's next submitAndWait() would wait forever for an intent
// index that will never be submitted again.
export function createCoopSync(sim, numPlayers, dt) {
  let intents = new Array(numPlayers).fill(null);
  const active = new Set();
  for (let i = 0; i < numPlayers; i++) active.add(i);
  let arrived = new Set();
  let waiters = [];

  function allActiveArrived() {
    for (const idx of active) if (!arrived.has(idx)) return false;
    return true;
  }

  function stepAndRelease() {
    const arr = [];
    for (let i = 0; i < numPlayers; i++) arr[i] = intents[i] || {};
    sim.step(arr, dt);
    arrived = new Set();
    intents = new Array(numPlayers).fill(null);
    const toWake = waiters;
    waiters = [];
    for (const resolve of toWake) resolve();
  }

  return {
    async submitAndWait(playerIdx, intent) {
      intents[playerIdx] = intent;
      arrived.add(playerIdx);
      if (allActiveArrived()) {
        stepAndRelease();
        return;
      }
      await new Promise((resolve) => waiters.push(resolve));
    },
    leave(playerIdx) {
      active.delete(playerIdx);
      arrived.delete(playerIdx);
      if (active.size > 0 && allActiveArrived()) stepAndRelease();
    },
  };
}

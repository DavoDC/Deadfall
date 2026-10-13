// Observation rig for the autonomous game critic (the design notes).
//
// The bot's report (autotest.js) tells you WHAT happened (WIN/DEAD/STUCK,
// kills, dmgTaken) but not WHY - no death cause with position/source, no
// fine-grained damage timeline, no threat/enemiesNear context around the
// moment the player got hurt. This module closes that gap WITHOUT touching
// autotest.js or sim.js: it wires the hooks that already exist there.
//
//   - sim.js's damagePlayer() already calls U.onHurt(amount, srcPos, source)
//     and U.onDeath() (sim.js:156,168) - these are the `ui` callbacks passed
//     to createSim(). The critic orchestrator supplies its own `ui` object
//     (instead of playtest.mjs's `ui: {}` no-op) built from this rig.
//   - autotest.js's runBot() already accepts opts.debugHook(i, player,
//     playerIdx), called once per simulated frame (autotest.js:184) and a
//     no-op unless the caller supplies one.
//
// Because both hooks are opt-in and only the critic orchestrator wires
// them, this file changes ZERO behaviour for src/tools/playtest.mjs, the
// human game (main.js never calls runBot), or the existing 159 tests.
//
// Two halves, deliberately separated so the judgment-adjacent math is
// testable without a sim, a renderer, or THREE:
//   1. PURE functions - viewInfo, enemiesNearCount. Take plain objects,
//      return plain objects, no dependency on the sim.
//   2. createRig(sim, opts) - thin stateful wiring that calls the pure
//      functions from onHurt/onDeath/debugHook and appends to a per-run
//      record. All sim access goes through the object passed in, so tests
//      exercise it against a duck-typed fake sim (see tests/critiqueRig.test.js).

// Tick sampling cadence for debugHook: every 15 frames = 0.25s at 60fps.
// Far finer than autotest.js's own 300-frame (5s) hpTimeline/posTrail, but
// still cheap - debugHook only runs at all when the critic supplies it, so
// this costs the human game and src/tools/playtest.mjs's normal runs nothing.
const TICK_SAMPLE_FRAMES = 15;

// Rough FPS half-FOV for "could the player plausibly have seen this coming
// without turning their head" - not the render FOV (that's ~74deg full,
// see main.js PerspectiveCamera), deliberately narrower than the render
// frustum because peripheral vision at the edge of a 74deg FOV does not
// register a threat the way a centred one does.
const VIEW_HALF_ANGLE_DEG = 55;

// Reaction distance seed from the brief: beyond this, "never inside a
// reaction distance" - roughly the range most enemy telegraphs (windup,
// charge) give the player to respond (autotest.js's own engage ranges top
// out around 30-44m; this sits below that band on purpose - a spitter arc
// or juggernaut charge started that far out already had visible warning).
const REACTION_DIST = 26;

const ENEMIES_NEAR_RADIUS = 60; // matches main.js computeEnemiesNear

// Given a player {pos:{x,y,z}, yaw} and a source position {x,y,z}, returns
// the bearing off the player's forward vector, whether it falls inside the
// view cone, whether hasLOS (if supplied) reports a clear line, the
// distance, and whether that distance is within reaction range. Bearing
// convention matches autotest.js's own aim math (wantYaw = atan2(-dx,-dz))
// and controller.js's forward vector (fwd = (-sin(yaw), -cos(yaw))) - do
// not "simplify" this to Math.atan2(dx,dz), it silently inverts every call.
export function viewInfo(player, srcPos, hasLOS) {
  const dx = srcPos.x - player.pos.x;
  const dz = srcPos.z - player.pos.z;
  const dist = Math.hypot(dx, dz);
  const bearing = Math.atan2(-dx, -dz);
  let dyaw = bearing - player.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const angleDeg = Number((Math.abs(dyaw) * (180 / Math.PI)).toFixed(1));
  const inViewCone = angleDeg <= VIEW_HALF_ANGLE_DEG;
  const srcY = srcPos.y ?? player.pos.y;
  const losClear = hasLOS ? hasLOS(player.pos.x, player.pos.y, player.pos.z, srcPos.x, srcY, srcPos.z) : true;
  return {
    dist: Number(dist.toFixed(1)),
    angleDeg,
    inViewCone,
    losClear,
    inView: inViewCone && losClear,
    withinReactionDist: dist <= REACTION_DIST,
  };
}

// Count + type-bucket enemies within `radius` of `pos`. Mirrors main.js's
// computeEnemiesNear (same 60m default), reimplemented here as a pure
// function over any {type, pos:{x,z}} array so it needs no enemyMgr.
export function enemiesNearCount(enemies, pos, radius = ENEMIES_NEAR_RADIUS) {
  const types = {};
  let count = 0;
  for (const e of enemies) {
    const dx = e.pos.x - pos.x;
    const dz = e.pos.z - pos.z;
    if (dx * dx + dz * dz <= radius * radius) {
      count++;
      types[e.type] = (types[e.type] || 0) + 1;
    }
  }
  return { count, types };
}

// Stateful wiring: closes over a live (or fake, in tests) sim and exposes
// onHurt/onDeath/debugHook to hand to createSim({ui}) and runBot(opts).
// `sim` needs: game.time, player.p, director.threat(), enemyMgr.aliveList().
export function createRig(sim, opts = {}) {
  const hasLOS = opts.hasLOS;
  const sampleFrames = opts.sampleFrames ?? TICK_SAMPLE_FRAMES;
  let rec = null;

  function begin(route, difficulty) {
    rec = {
      route,
      difficulty,
      damageEvents: [], // fine-grained, one per damagePlayer() call
      deathRecord: null, // last damage event at time of death, or {unknown:true}
      ticks: [], // sampled every `sampleFrames` frames: hp/threat/enemiesNear/pos
    };
    return rec;
  }

  function current() {
    return rec;
  }

  function onHurt(amount, srcPos, source) {
    if (!rec) return;
    const p = sim.player.p;
    const info = viewInfo({ pos: p.pos, yaw: p.yaw }, srcPos, hasLOS);
    rec.damageEvents.push({
      t: Number(sim.game.time.toFixed(2)),
      amount: Number(amount.toFixed(1)),
      source,
      srcPos: { x: Math.round(srcPos.x), z: Math.round(srcPos.z) },
      playerPos: { x: Math.round(p.pos.x), z: Math.round(p.pos.z) },
      playerHp: Math.round(p.hp),
      ...info,
    });
  }

  function onDeath() {
    if (!rec) return;
    const last = rec.damageEvents[rec.damageEvents.length - 1];
    rec.deathRecord = last ? { ...last } : { unknown: true };
  }

  // Called once per simulated frame by autotest.js's runBot(). i = frame
  // index, player = the sim's player controller (has .p), playerIdx = which
  // player (the critic only drives solo runs, so only playerIdx 0 matters).
  function debugHook(i, player, playerIdx) {
    if (!rec || playerIdx !== 0) return;
    if (i % sampleFrames !== 0) return;
    const p = player.p;
    const enemies = sim.enemyMgr ? sim.enemyMgr.aliveList() : [];
    rec.ticks.push({
      t: Number((i / 60).toFixed(2)),
      hp: Math.round(p.hp),
      stamina: Number(p.stamina.toFixed(2)),
      x: Math.round(p.pos.x),
      z: Math.round(p.pos.z),
      threat: sim.director ? Number(sim.director.threat().toFixed(3)) : null,
      enemiesNear: enemiesNearCount(enemies, p.pos),
    });
  }

  return { begin, current, onHurt, onDeath, debugHook };
}

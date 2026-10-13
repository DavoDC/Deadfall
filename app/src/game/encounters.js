// Enemy ENCOUNTER log for the playtest flight recorder (docs/References/Telemetry.md).
//
// One entry per enemy spawn: what it was, where and when it appeared, when the
// player first had it in view and at what distance, how it ended (killed by
// which weapon, despawned, or still alive at the end of the run) and how much
// damage it did to the player. Enemy objects are pooled and reused by the
// enemy manager, so identity is tracked per SPAWN here: an object that leaves
// the alive list closes its encounter, and the same object coming back opens a
// new one.
//
// Pure logic, fed by main.js; the telemetry object is only used through
// addEncounter() / updateEncounter().

// A sighting needs the enemy in front of the player (within SIGHT_HALF_ARC of
// the look direction), within SIGHT_RANGE metres, and with line of sight (the
// enemy AI's own player-LOS result, no extra raycasts).
export const SIGHT_RANGE = 90;
export const SIGHT_HALF_ARC = 1.05; // radians, about 60 degrees
const UPDATE_INTERVAL = 0.2;        // seconds between tracker passes (5 Hz)
const ATTRIBUTION_RADIUS = 40;      // metres, damage source position to enemy

// damage-source names that are not an enemy type but belong to one
const SOURCE_TO_TYPE = { acid: 'spitter' };

function r2(n) { return Math.round(n * 100) / 100; }

export function createEncounterTracker(telemetry) {
  const open = new Map(); // enemy object -> { index }
  let lastT = -Infinity;
  let spawnCounts = {};
  let nextId = 1;

  function reset() {
    open.clear();
    lastT = -Infinity;
    spawnCounts = {};
    nextId = 1;
  }

  // time: telemetry clock seconds. alive: enemyMgr.aliveList(). player:
  // { x, z, yaw }.
  function update(time, alive, player) {
    if (!telemetry.recording) return;
    if (time - lastT < UPDATE_INTERVAL) return;
    lastT = time;
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const present = new Set();
    for (const e of alive) {
      present.add(e);
      let rec = open.get(e);
      if (!rec) {
        const index = telemetry.addEncounter({
          id: nextId++,
          type: e.type,
          spawnT: r2(time),
          spawnPos: { x: r2(e.pos.x), z: r2(e.pos.z) },
          firstSeenT: null,
          firstSeenDist: null,
          fate: 'alive',
          killedT: null,
          killedBy: null,
          lastHitBy: null,
          dmgToPlayer: 0,
        });
        rec = { index, seen: false };
        open.set(e, rec);
        spawnCounts[e.type] = (spawnCounts[e.type] || 0) + 1;
        telemetry.setSpawned(spawnCounts);
      }
      if (!rec.seen && e.hasLOS) {
        const dx = e.pos.x - player.x;
        const dz = e.pos.z - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= SIGHT_RANGE && dist > 0) {
          const cos = (dx * fx + dz * fz) / dist;
          if (Math.acos(Math.min(1, Math.max(-1, cos))) <= SIGHT_HALF_ARC) {
            rec.seen = true;
            telemetry.updateEncounter(rec.index, { firstSeenT: r2(time), firstSeenDist: r2(dist) });
          }
        }
      }
    }
    for (const [e, rec] of open) {
      if (present.has(e)) continue;
      const killed = e.state === 'dying' || e.hp <= 0;
      telemetry.updateEncounter(rec.index, killed
        ? { fate: 'killed', killedT: r2(time), killedBy: rec.killedBy || rec.lastHitBy || 'other' }
        : { fate: 'despawned', killedT: r2(time) });
      open.delete(e);
    }
  }

  // A weapon hit (or kill) on an enemy, from the weaponHooks wrapper.
  function noteHit(enemy, weapon, killed) {
    const rec = open.get(enemy);
    if (!rec) return;
    rec.lastHit = weapon;
    if (killed) rec.killedBy = weapon;
    telemetry.updateEncounter(rec.index, { lastHitBy: weapon });
  }

  // Damage the player took from `source` (an enemy type, or 'acid' etc.) at
  // srcPos. Attributed to the nearest open encounter of that type. Approximate
  // by design: the sim reports a source name and position, not an enemy id.
  function noteHurt(source, srcPos, amount) {
    const type = SOURCE_TO_TYPE[source] || source;
    let best = null;
    let bestD = Infinity;
    for (const [e, rec] of open) {
      if (e.type !== type) continue;
      const d = srcPos ? Math.hypot(e.pos.x - srcPos.x, e.pos.z - srcPos.z) : 0;
      if (d < bestD) { bestD = d; best = rec; }
    }
    if (!best || (srcPos && bestD > ATTRIBUTION_RADIUS)) return;
    const entry = telemetry.log.encounters[best.index];
    telemetry.updateEncounter(best.index, { dmgToPlayer: r2((entry.dmgToPlayer || 0) + amount) });
  }

  // true when update() would do work this frame (lets the caller skip building the alive list)
  function due(time) { return telemetry.recording && time - lastT >= UPDATE_INTERVAL; }

  return { update, due, noteHit, noteHurt, reset };
}

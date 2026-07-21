// Anti-burst grace (round: extraction-redesign, root cause 5). Pure,
// independently unit-tested (tests/burstGrace.test.js) - sim.js's
// damagePlayer() is the only caller.
//
// The problem this fixes: sim.js's damagePlayer() had no cooldown or
// invulnerability window at all. The critic's F6 case was three SEPARATE
// enemies (different sources, different attackers) landing hits within
// under a second, chain-deleting a player who had zero frames to react
// between them - not "hard," unfair. The juggernaut telegraph (increment
// 1) and the in-hold ramp (increment 2) both reduce how OFTEN a player
// gets surrounded like that; this is the last line of defence for when it
// still happens anyway.
//
// Design: after any discrete hit, a short window opens in which a SECOND
// (and third...) discrete hit lands for reduced damage. This is
// deliberately narrow:
//   - BURST_GRACE_WINDOW_S (0.4s) is shorter than every enemy's own
//     attack cooldown (prowler 1.0s, juggernaut 1.6s, shrike ~1.15s
//     recover, spitter ~2.6-3.8s spit cooldown) - a single attacker's
//     normal cadence NEVER triggers it. Only genuinely overlapping hits
//     from multiple simultaneous threats do.
//   - BURST_GRACE_MULT (0.5) softens, it does not nullify - a careless
//     player surrounded by three attackers still takes real damage, they
//     are just not deleted with zero reaction window (brief's own
//     language: "not sustained-fire immunity").
//   - BURST_GRACE_EXCLUDED_SOURCES ('razorfin', 'flood') are continuous
//     per-frame hazard ticks, not discrete hits - a naive "within X of the
//     last hit" rule would immediately self-chain every tick and gut
//     their whole "get out of the water or take steady damage" design.
//     Every other damage source in the game is a single discrete event.

export const BURST_GRACE_WINDOW_S = 0.4;
export const BURST_GRACE_MULT = 0.5;
export const BURST_GRACE_EXCLUDED_SOURCES = new Set(['razorfin', 'flood']);

// now/lastHitAt are sim time (seconds since run start, game.time) - using
// sim time rather than a per-frame decrementing timer means damagePlayer
// needs to track only a single timestamp per player, no per-frame upkeep.
export function burstGraceMultiplier(source, now, lastHitAt) {
  if (BURST_GRACE_EXCLUDED_SOURCES.has(source)) return 1;
  if (lastHitAt == null) return 1;
  const since = now - lastHitAt;
  // the >= 0 guard matters: a fresh run resets game.time to 0 while a
  // reused player object can still carry a stale lastHitAt from hundreds
  // of seconds into the PREVIOUS run - without this, `since` would be a
  // large negative number and satisfy `< window`, wrongly softening the
  // very first hit of a new run.
  if (since >= 0 && since < BURST_GRACE_WINDOW_S) return BURST_GRACE_MULT;
  return 1;
}

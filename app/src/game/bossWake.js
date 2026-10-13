// Boss choreography (round: extraction-redesign, root cause 6). Pure,
// independently unit-tested (tests/bossWake.test.js) - sim.js's
// updateBoss() is the only caller.
//
// Before: `if (dm < 46 || extraction.committed)` woke the Miremother the
// INSTANT the player committed to extraction, regardless of hold
// progress - stacking her onto the SAME frame as the opening surge
// (startSurge's budget injection). Two escalations on frame one is not an
// arc; a last stand needs a build, then a peak, then a release.
//
// After: she is the CRESCENDO. Proximity to her moat still wakes her
// organically (unrelated to extraction - that encounter is untouched).
// But the extraction-triggered wake now waits until the player has
// survived a meaningful fraction of the hold, so she arrives as a second,
// LATER beat - not stacked onto the first.
export const BOSS_WAKE_HOLD_FRAC = 0.5;

export function shouldWakeMiremother({
  dm, wakeRadius = 46, extractionCommitted, holdProgress = 0,
  holdWakeFrac = BOSS_WAKE_HOLD_FRAC,
}) {
  if (dm < wakeRadius) return true; // organic proximity wake - unchanged
  return extractionCommitted && holdProgress >= holdWakeFrac;
}

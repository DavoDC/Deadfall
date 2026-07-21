import { describe, it, expect } from 'vitest';
import {
  burstGraceMultiplier, BURST_GRACE_WINDOW_S, BURST_GRACE_MULT,
} from '../src/game/burstGrace.js';

describe('burstGraceMultiplier (pure) - root cause 5', () => {
  it('is 1 (no grace) for the very first hit a player ever takes', () => {
    expect(burstGraceMultiplier('prowler', 10, null)).toBe(1);
  });

  it('softens a second discrete hit landing inside the grace window', () => {
    expect(burstGraceMultiplier('prowler', 10.1, 10)).toBe(BURST_GRACE_MULT);
  });

  it('does not soften a hit landing right at the window boundary or after', () => {
    expect(burstGraceMultiplier('prowler', 10 + BURST_GRACE_WINDOW_S, 10)).toBe(1);
    expect(burstGraceMultiplier('prowler', 11.5, 10)).toBe(1);
  });

  it('does not soften a single attacker firing at its own normal cooldown', () => {
    // prowler strikeCooldown is 1.0s, juggernaut 1.6s - both well outside
    // the 0.4s grace window, so normal sustained combat is untouched
    expect(burstGraceMultiplier('prowler', 11.0, 10)).toBe(1);
    expect(burstGraceMultiplier('juggernaut', 11.6, 10)).toBe(1);
  });

  it('never softens the continuous razorfin hazard, even one frame later', () => {
    expect(burstGraceMultiplier('razorfin', 10.016, 10)).toBe(1);
  });

  it('never softens the continuous flood hazard, even one frame later', () => {
    expect(burstGraceMultiplier('flood', 10.016, 10)).toBe(1);
  });

  it('guards against a stale lastHitAt from a previous run (negative elapsed)', () => {
    // game.time resets to 0 on a new run; a reused player object could
    // still carry lastHitAt=400 from the previous run's late-game combat
    expect(burstGraceMultiplier('prowler', 0.05, 400)).toBe(1);
  });
});

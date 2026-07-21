import { describe, it, expect } from 'vitest';
import { shouldWakeMiremother, BOSS_WAKE_HOLD_FRAC } from '../src/game/bossWake.js';

describe('shouldWakeMiremother (pure) - root cause 6: boss as crescendo', () => {
  it('wakes organically on proximity, regardless of extraction state', () => {
    expect(shouldWakeMiremother({
      dm: 20, extractionCommitted: false, holdProgress: 0,
    })).toBe(true);
  });

  it('does NOT wake the instant extraction commits (was the old bug)', () => {
    expect(shouldWakeMiremother({
      dm: 999, extractionCommitted: true, holdProgress: 0,
    })).toBe(false);
  });

  it('does not wake mid-hold before the crescendo threshold', () => {
    expect(shouldWakeMiremother({
      dm: 999, extractionCommitted: true, holdProgress: BOSS_WAKE_HOLD_FRAC - 0.01,
    })).toBe(false);
  });

  it('wakes once the hold reaches the crescendo threshold', () => {
    expect(shouldWakeMiremother({
      dm: 999, extractionCommitted: true, holdProgress: BOSS_WAKE_HOLD_FRAC,
    })).toBe(true);
  });

  it('never wakes if extraction was never committed, far from the moat', () => {
    expect(shouldWakeMiremother({
      dm: 999, extractionCommitted: false, holdProgress: 1,
    })).toBe(false);
  });
});

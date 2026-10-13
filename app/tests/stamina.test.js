import { describe, it, expect } from 'vitest';
import { updateStamina, STAMINA_DRAIN, STAMINA_REGEN, EXHAUST_RECOVER } from '../src/player/stamina.js';

// Round-8 playtest: "STAMINA NEVER FULLY GOES DOWN bar was a bit full" - the
// old inline gate (stamina > 0.05) stopped draining a hair before empty and
// let regen start immediately, so the bar never really bottomed out. These
// tests pin the fixed behaviour: full depletion, forced walk, and recovery.

describe('stamina resource', () => {
  it('drains while sprinting', () => {
    const s0 = { stamina: 1, exhausted: false };
    const s1 = updateStamina(s0, true, 1);
    expect(s1.stamina).toBeCloseTo(1 - STAMINA_DRAIN, 5);
    expect(s1.sprinting).toBe(true);
  });

  it('regens while not sprinting', () => {
    const s0 = { stamina: 0.5, exhausted: false };
    const s1 = updateStamina(s0, false, 1);
    expect(s1.stamina).toBeCloseTo(0.5 + STAMINA_REGEN, 5);
    expect(s1.sprinting).toBe(false);
  });

  it('sustained sprint fully depletes stamina to exactly zero', () => {
    let state = { stamina: 1, exhausted: false };
    let reachedZero = false;
    // 10s @ 60fps of continuous sprint request - well over the ~4.5s a full
    // bar takes to drain at STAMINA_DRAIN. Exhaustion then blocks further
    // sprint and regen takes back over, so track that zero was actually hit
    // rather than asserting the final value (which will have regenned some).
    for (let i = 0; i < 600; i++) {
      state = updateStamina(state, true, 1 / 60);
      if (state.stamina === 0) reachedZero = true;
    }
    expect(reachedZero).toBe(true);
  });

  it('forces a walk (sprint stops) once stamina hits zero, even if still requested', () => {
    let state = { stamina: 0.02, exhausted: false };
    // one big step that would drive it past zero
    state = updateStamina(state, true, 1);
    expect(state.stamina).toBe(0);
    expect(state.exhausted).toBe(true);
    // still holding sprint - must not be allowed to run again immediately
    const next = updateStamina(state, true, 1 / 60);
    expect(next.sprinting).toBe(false);
  });

  it('does not resume sprint until stamina recovers past the exhaustion threshold', () => {
    let state = { stamina: 0, exhausted: true };
    // regen (sprint is requested throughout, but exhaustion blocks it) until
    // stamina reaches the recovery threshold
    while (state.stamina < EXHAUST_RECOVER) {
      state = updateStamina(state, true, 1 / 60); // keeps asking to sprint the whole time
      expect(state.sprinting).toBe(false);
    }
    // now at/past the recovery threshold, sprint should be allowed again
    state = updateStamina(state, true, 1 / 60);
    expect(state.sprinting).toBe(true);
  });

  it('regen never exceeds 1', () => {
    const state = updateStamina({ stamina: 1, exhausted: false }, false, 100); // huge dt
    expect(state.stamina).toBe(1);
  });

  it('drain never drops below 0', () => {
    const state = updateStamina({ stamina: 0.1, exhausted: false }, true, 100); // huge dt
    expect(state.stamina).toBe(0);
  });

  it('exhaustion blocks sprint from empty even under a huge dt, so it regens instead of staying pinned', () => {
    const state = updateStamina({ stamina: 0, exhausted: true }, true, 100);
    expect(state.sprinting).toBe(false);
    expect(state.stamina).toBe(1); // huge dt regen with no drain applied
  });
});

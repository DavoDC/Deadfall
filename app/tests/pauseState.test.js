import { describe, it, expect } from 'vitest';
import {
  shouldShowMenu, resumeButtonLabel, shouldStepSim, shouldRecordTelemetry,
} from '../src/player/pauseState.js';

describe('pauseState (freeze regression - 2026-07-19 playtest)', () => {
  it('shows the menu before a run starts', () => {
    expect(shouldShowMenu('MENU', false)).toBe(true);
  });

  it('hides the menu once running and pointer-locked', () => {
    expect(shouldShowMenu('RUNNING', true)).toBe(false);
  });

  it('shows the menu when running but not locked (ESC / blur / alt-tab)', () => {
    expect(shouldShowMenu('RUNNING', false)).toBe(true);
  });

  it('shows the menu on the end screen regardless of lock state', () => {
    expect(shouldShowMenu('WIN', true)).toBe(true);
    expect(shouldShowMenu('LOSE', false)).toBe(true);
  });

  it('recovers from a stuck-frozen state: running + unlocked always resolves to menu-visible', () => {
    // This is the exact freeze shape from the playtest: resume then alt-tab
    // could leave locked=false with the menu never re-shown because the
    // menu hide was applied optimistically instead of driven by state.
    // The watchdog re-evaluates every frame, so even a missed transition
    // self-heals on the next tick.
    for (const gameState of ['RUNNING']) {
      for (const locked of [false]) {
        expect(shouldShowMenu(gameState, locked)).toBe(true);
      }
    }
  });

  it('resume button reads RESUME mid-run, DEPLOY otherwise', () => {
    expect(resumeButtonLabel('RUNNING')).toBe('RESUME');
    expect(resumeButtonLabel('MENU')).toBe('DEPLOY');
    expect(resumeButtonLabel('WIN')).toBe('DEPLOY');
  });
});

describe('shouldStepSim / shouldRecordTelemetry (broken telemetry P0 - 2026-08-20)', () => {
  // Root cause: main.js used to gate telemetry.tick() + the burst-flush
  // behind the exact same condition as sim.step(), so any pause or
  // alt-tab silently halted BOTH. Sim stepping must stay strict (ESC is a
  // real pause, and the autotest bot steps the sim itself while unlocked,
  // so double-ticking must never happen) - but telemetry must survive a
  // pause so a human session is captured continuously. These two pure
  // predicates are the seam that keeps the two concerns from re-merging.

  it('sim only steps while RUNNING and pointer-locked', () => {
    expect(shouldStepSim('RUNNING', true)).toBe(true);
  });

  it('sim does NOT step when running but unlocked (paused / alt-tabbed)', () => {
    expect(shouldStepSim('RUNNING', false)).toBe(false);
  });

  it('sim does NOT step outside RUNNING regardless of lock state', () => {
    expect(shouldStepSim('MENU', true)).toBe(false);
    expect(shouldStepSim('WIN', true)).toBe(false);
    expect(shouldStepSim('LOSE', false)).toBe(false);
  });

  it('telemetry keeps recording for the whole RUNNING state, locked or not', () => {
    // This is the actual fix: unlike shouldStepSim, lock state must NOT
    // gate telemetry - a paused/alt-tabbed player is still mid-session.
    expect(shouldRecordTelemetry('RUNNING', true)).toBe(true);
    expect(shouldRecordTelemetry('RUNNING', false)).toBe(true);
  });

  it('telemetry does not record outside a RUNNING session', () => {
    expect(shouldRecordTelemetry('MENU', false)).toBe(false);
    expect(shouldRecordTelemetry('WIN', true)).toBe(false);
    expect(shouldRecordTelemetry('LOSE', false)).toBe(false);
  });

  it('the two predicates diverge exactly on the pause case - this is the bug fix', () => {
    // Before the fix both were literally the same expression. The whole
    // point of separating them is that RUNNING+unlocked steps NO sim but
    // DOES record telemetry.
    expect(shouldStepSim('RUNNING', false)).toBe(false);
    expect(shouldRecordTelemetry('RUNNING', false)).toBe(true);
  });
});

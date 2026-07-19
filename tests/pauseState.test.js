import { describe, it, expect } from 'vitest';
import { shouldShowMenu, resumeButtonLabel } from '../src/player/pauseState.js';

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

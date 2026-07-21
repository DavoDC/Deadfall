import { describe, it, expect, vi } from 'vitest';
import { createDirector, compassBearing } from '../src/enemies/director.js';
import { WORLD } from '../src/world/heightmap.js';

// Root cause 4 (docs/fable-brief-extraction.md): every spawn is forced out
// of the player's LOS, so first contact was always "deleted from
// offscreen." The fix is not to make spawns visible - it is to tell the
// player which way a wave is coming from, so it reads as "brace, incoming"
// instead. compassBearing() is the pure piece; the director wires it to
// fire once per surge squad purchase.

describe('compassBearing (pure)', () => {
  it('maps the 8 principal directions (world convention: -Z is north)', () => {
    expect(compassBearing(0, -1)).toBe('N');
    expect(compassBearing(1, -1)).toBe('NE');
    expect(compassBearing(1, 0)).toBe('E');
    expect(compassBearing(1, 1)).toBe('SE');
    expect(compassBearing(0, 1)).toBe('S');
    expect(compassBearing(-1, 1)).toBe('SW');
    expect(compassBearing(-1, 0)).toBe('W');
    expect(compassBearing(-1, -1)).toBe('NW');
  });
});

describe('director: directional wave telegraph', () => {
  function makeDirector(onWave) {
    const enemyMgr = { aliveCount: () => 0, aliveList: () => [], spawn: () => {} };
    const pos = { x: WORLD.extraction.x, y: 0, z: WORLD.extraction.z };
    const playerHelpers = {
      furthestNorthPlayer: () => ({ pos, yaw: 0 }),
      nearestPlayer: () => ({ pos }),
    };
    return createDirector(enemyMgr, playerHelpers, { onWave });
  }

  it('fires onWave with a real compass bearing when a surge squad spawns', () => {
    const onWave = vi.fn();
    const d = makeDirector(onWave);
    d.startSurge();
    d.setHoldProgress(1); // unlock every surge squad
    d.state.budget = 100; // never budget-starved for this test
    d.state.tickT = 0;
    d.update(0);
    expect(onWave).toHaveBeenCalled();
    const [bearing] = onWave.mock.calls[0];
    expect(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).toContain(bearing);
  });

  it('does not fire onWave for an ordinary (non-surge) patrol spawn', () => {
    const onWave = vi.fn();
    const d = makeDirector(onWave);
    d.state.budget = 100;
    d.state.tickT = 0;
    d.update(0);
    expect(onWave).not.toHaveBeenCalled();
  });

  it('defaults to a harmless no-op when no onWave is supplied', () => {
    const enemyMgr = { aliveCount: () => 0, aliveList: () => [], spawn: () => {} };
    const pos = { x: WORLD.extraction.x, y: 0, z: WORLD.extraction.z };
    const playerHelpers = {
      furthestNorthPlayer: () => ({ pos, yaw: 0 }),
      nearestPlayer: () => ({ pos }),
    };
    const d = createDirector(enemyMgr, playerHelpers); // no opts at all
    d.startSurge();
    d.setHoldProgress(1);
    d.state.budget = 100;
    d.state.tickT = 0;
    expect(() => d.update(0)).not.toThrow();
  });
});

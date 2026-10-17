import { describe, it, expect } from 'vitest';
import { createBootTimer, bootProfileEnabled } from '../src/game/bootTiming.js';

describe('bootTiming', () => {
  it('reports the time since the previous mark, the first from time zero', () => {
    const times = [120, 150, 400];
    const t = createBootTimer(() => times.shift());
    t.mark('a');
    t.mark('b');
    t.mark('c');
    expect(t.report()).toEqual([
      { label: 'a', at: 120, ms: 120 },
      { label: 'b', at: 150, ms: 30 },
      { label: 'c', at: 400, ms: 250 },
    ]);
  });

  it('is on for the dev server or ?bootprofile only', () => {
    expect(bootProfileEnabled('', false)).toBe(false);
    expect(bootProfileEnabled('?x=1', false)).toBe(false);
    expect(bootProfileEnabled('', true)).toBe(true);
    expect(bootProfileEnabled('?bootprofile', false)).toBe(true);
    expect(bootProfileEnabled('?a=1&bootprofile=1', false)).toBe(true);
    expect(bootProfileEnabled('?nobootprofile', false)).toBe(false);
  });
});

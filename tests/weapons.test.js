import { describe, it, expect } from 'vitest';
import { nextSlot, prevSlot } from '../src/weapons/weapons.js';

const SLOTS = ['carbine', 'breacher', 'longarm'];

describe('weapons: nextSlot (mouse-wheel forward cycle)', () => {
  it('advances to the following slot', () => {
    expect(nextSlot(SLOTS, 'carbine')).toBe('breacher');
    expect(nextSlot(SLOTS, 'breacher')).toBe('longarm');
  });

  it('wraps from the last slot back to the first', () => {
    expect(nextSlot(SLOTS, 'longarm')).toBe('carbine');
  });
});

describe('weapons: prevSlot (mouse-wheel backward cycle)', () => {
  it('steps back to the preceding slot', () => {
    expect(prevSlot(SLOTS, 'longarm')).toBe('breacher');
    expect(prevSlot(SLOTS, 'breacher')).toBe('carbine');
  });

  it('wraps from the first slot back to the last', () => {
    expect(prevSlot(SLOTS, 'carbine')).toBe('longarm');
  });

  it('is the exact inverse of nextSlot around the whole ring', () => {
    for (const slot of SLOTS) {
      expect(prevSlot(SLOTS, nextSlot(SLOTS, slot))).toBe(slot);
    }
  });
});

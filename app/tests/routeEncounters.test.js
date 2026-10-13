import { describe, it, expect } from 'vitest';
import {
  ROUTE_SLOTS, HUNTER_TYPES, slotAt, slotGroup, slotFlora, slotsCrossed, slotEnemyTotal,
} from '../src/game/routeEncounters.js';
import { DIFFICULTIES } from '../src/game/difficulty.js';

const KEYS = Object.keys(DIFFICULTIES);

describe('route encounter table (data)', () => {
  for (const key of KEYS) {
    describe(DIFFICULTIES[key].label, () => {
      const slots = ROUTE_SLOTS
        .map((s) => ({ s, at: slotAt(s, key) }))
        .sort((a, b) => a.at - b.at);

      it('opens with contact early', () => {
        const first = slots.find((x) => slotGroup(x.s, key).length > 0);
        expect(first.at).toBeLessThanOrEqual(0.1);
      });

      it('has every hunter type, all by 70 percent progress', () => {
        for (const type of HUNTER_TYPES) {
          const slot = slots.find((x) => slotGroup(x.s, key).some(([t, n]) => t === type && n > 0));
          expect(slot, `${key} missing ${type}`).toBeTruthy();
          expect(slot.at).toBeLessThanOrEqual(0.7);
        }
      });

      it('spaces encounter groups so no stretch is empty', () => {
        const groupAts = slots.filter((x) => slotGroup(x.s, key).length > 0).map((x) => x.at);
        for (let i = 1; i < groupAts.length; i++) {
          expect(groupAts[i] - groupAts[i - 1]).toBeLessThanOrEqual(0.16);
          expect(groupAts[i] - groupAts[i - 1]).toBeGreaterThanOrEqual(0.05);
        }
      });

      it('cues the apex before the drowned stair, never spawning her', () => {
        const cue = ROUTE_SLOTS.find((s) => s.foreshadow === 'apex');
        expect(cue).toBeTruthy();
        expect(slotAt(cue, key)).toBeGreaterThan(0.7);
        expect(slotAt(cue, key)).toBeLessThan(0.9);
        for (const s of ROUTE_SLOTS) {
          expect(slotGroup(s, key).some(([t]) => t === 'miremother' || t === 'viperblossom')).toBe(false);
        }
      });
    });
  }

  it('RECRUIT stays forgiving: no more enemies than HUNTER, the juggernaut alone', () => {
    expect(slotEnemyTotal('easy')).toBeLessThanOrEqual(slotEnemyTotal('normal'));
    expect(slotEnemyTotal('normal')).toBeLessThanOrEqual(slotEnemyTotal('hard'));
    const jug = ROUTE_SLOTS.find((s) => slotGroup(s, 'easy').some(([t]) => t === 'juggernaut'));
    expect(slotGroup(jug, 'easy')).toEqual([['juggernaut', 1]]);
  });

  it('plants flora along the route on every difficulty', () => {
    for (const key of KEYS) {
      const flora = ROUTE_SLOTS.reduce((n, s) => n + slotFlora(s, key), 0);
      expect(flora).toBeGreaterThanOrEqual(2);
    }
  });

  it('slotsCrossed fires each slot once, in order', () => {
    const a = slotsCrossed(0, 0.3, 'normal').map((s) => s.id);
    const b = slotsCrossed(0.3, 1, 'normal').map((s) => s.id);
    expect(a.length + b.length).toBe(ROUTE_SLOTS.length);
    expect(new Set([...a, ...b]).size).toBe(ROUTE_SLOTS.length);
    expect(slotsCrossed(0.3, 0.3, 'normal')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { resultView, formatRunTime } from '../src/player/resultScreen.js';

const base = { difficultyLabel: 'RECRUIT', time: 754.9, kills: 12, shots: 90, damage: 41.6, isRecord: false };

describe('resultView', () => {
  it('formats the run time as m:ss', () => {
    expect(formatRunTime(754.9)).toBe('12:34');
    expect(formatRunTime(5)).toBe('0:05');
    expect(formatRunTime(-3)).toBe('0:00');
  });

  it('extraction: title, stats, no flavor line', () => {
    const v = resultView({ ...base, extracted: true });
    expect(v.title).toBe('EXTRACTED');
    expect(v.titleClass).toBe('extracted');
    expect(v.stats).toEqual([['TIME', '12:34'], ['KILLS', '12'], ['SHOTS', '90'], ['DAMAGE TAKEN', '42']]);
    expect(v.flavor).toBe('');
    expect(v.record).toBe(false);
  });

  it('death: K.I.A. with the flavor line, record flag passes through', () => {
    const v = resultView({ ...base, extracted: false, isRecord: true });
    expect(v.title).toBe('K.I.A.');
    expect(v.titleClass).toBe('died');
    expect(v.flavor).toMatch(/jungle keeps/);
    expect(v.record).toBe(true);
  });
});

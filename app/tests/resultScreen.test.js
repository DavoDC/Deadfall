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

  it('carries score, grade, rank, breakdown and copy text', () => {
    const v = resultView({ ...base, difficulty: 'normal', hits: 40, extracted: true });
    expect(v.grade).toMatch(/^[SABCD]$/);
    expect(v.rank).toMatch(/\S/);
    expect(Number(v.total)).toBe(v.score.total);
    expect(v.breakdown.map((b) => b[0])).toEqual(['KILLS', 'ACCURACY', 'SPEED', 'EXTRACTION', 'DAMAGE TAKEN']);
    expect(v.breakdown[4][1]).toMatch(/^-/);
    expect(v.multiplierLabel).toBe('x1.00 RECRUIT');
    expect(v.copyText).toContain('EXTRACTED');
  });

  it('K.I.A. view grades F and has no extraction line', () => {
    const v = resultView({ ...base, difficulty: 'hard', hits: 10, extracted: false });
    expect(v.grade).toBe('F');
    expect(v.breakdown.map((b) => b[0])).not.toContain('EXTRACTION');
    expect(v.multiplierLabel).toMatch(/^x1\.30/);
  });

  it('death: K.I.A. with the flavor line, record flag passes through', () => {
    const v = resultView({ ...base, extracted: false, isRecord: true });
    expect(v.title).toBe('K.I.A.');
    expect(v.titleClass).toBe('died');
    expect(v.flavor).toMatch(/jungle keeps/);
    expect(v.record).toBe(true);
  });
});

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

  it('DF-146: TOTAL row sits directly under the line items and equals the headline points', () => {
    const v = resultView({ ...base, difficulty: 'hard', hits: 40, extracted: true });
    const labels = v.rows.map((r) => r[0]);
    expect(labels.at(-1)).toBe('TOTAL');
    expect(labels).toEqual([...v.breakdown.map((b) => b[0]), 'DIFFICULTY', 'TOTAL']);
    expect(v.rows.at(-1)[1]).toBe(String(v.score.total));
    expect(v.rows.at(-1)[1]).toBe(v.total);
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

describe('copy text carries everything the result screen shows', () => {
  it('one line with every displayed label and value (extraction, DEAD EYE, record)', () => {
    const v = resultView({ ...base, difficulty: 'hard', hits: 60, damage: 42, time: 400, extracted: true, isRecord: true });
    const t = v.copyText;
    expect(v.tag).toBe('DEAD EYE');
    expect(t).not.toContain('\n');
    expect(t).toContain(v.title);
    expect(t).toContain(`${v.grade} ${v.rank}`);
    expect(t).toContain(`[${v.tag}]`);
    expect(t).toContain(`${v.total} PTS`);
    expect(t).toContain(v.difficultyLabel);
    expect(t).toContain(v.multiplierLabel);
    for (const [label, value] of v.stats) expect(t).toContain(`${label} ${value}`);
    for (const [label, value] of v.breakdown) expect(t).toContain(`${label} ${value}`);
    for (const [label, value] of v.rows) expect(t).toContain(`${label} ${value}`);
    expect(t).toContain('ACCURACY +');
    expect(t).toContain('DAMAGE TAKEN -');
    expect(t).toContain('SHOTS 90');
    expect(t).toContain('DAMAGE TAKEN 42');
    expect(t).toContain('NEW RECORD');
  });

  it('K.I.A. with no tag and no record: title, grade F, no tag brackets, no record', () => {
    const v = resultView({ ...base, difficulty: 'easy', hits: 0, extracted: false, isRecord: false });
    const t = v.copyText;
    expect(v.tag).toBe('');
    expect(t).toContain('K.I.A.');
    expect(t).toContain(`F ${v.rank}`);
    expect(t).toContain(`${v.total} PTS`);
    for (const [label, value] of v.breakdown) expect(t).toContain(`${label} ${value}`);
    expect(t).not.toContain('[');
    expect(t).not.toContain('NEW RECORD');
    expect(t).toContain('x0.75 RECRUIT');
  });
});

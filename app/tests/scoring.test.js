import { describe, it, expect } from 'vitest';
import { scoreRun, gradeFor, SCORE } from '../src/player/scoring.js';

const run = (o = {}) => ({
  extracted: true, difficulty: 'normal', time: 400, kills: 20, shots: 100, hits: 40, damage: 50, ...o,
});
const pts = (s, key) => s.lines.find((l) => l.key === key).points;

describe('scoreRun', () => {
  it('adds kills, accuracy, speed and extraction, subtracts damage', () => {
    const s = scoreRun(run());
    expect(pts(s, 'kills')).toBe(20 * SCORE.perKill);
    expect(pts(s, 'accuracy')).toBe(Math.round(0.4 * SCORE.accuracyMax));
    expect(pts(s, 'speed')).toBe(Math.round((SCORE.parTime - 400) * SCORE.speedPerSec));
    expect(pts(s, 'extraction')).toBe(SCORE.extraction);
    expect(pts(s, 'damage')).toBe(-50 * SCORE.damagePenalty);
    expect(s.multiplier).toBe(1);
    expect(s.total).toBe(s.lines.reduce((a, l) => a + l.points, 0));
  });

  it('K.I.A.: no extraction or speed bonus, graded on its own scale, still scores kills', () => {
    const s = scoreRun(run({ extracted: false }));
    const keys = s.lines.map((l) => l.key);
    expect(keys).not.toContain('extraction');
    expect(keys).not.toContain('speed');
    expect(s.grade).toBe('C');
    expect(s.total).toBeGreaterThan(0);
    expect(s.title).toMatch(/\S/);
  });

  it('K.I.A. titles depend on kills', () => {
    expect(scoreRun(run({ extracted: false, kills: 0 })).title).toBe('FOOD FOR THE JUNGLE');
    expect(scoreRun(run({ extracted: false, kills: 7 })).title).toBe('FALLEN SCOUT');
    expect(scoreRun(run({ extracted: false, kills: 8 })).title).toBe('FALLEN PREDATOR');
  });

  it('difficulty multiplier scales the total: recruit < hunter < deadfall', () => {
    const a = scoreRun(run({ difficulty: 'easy' }));
    const b = scoreRun(run({ difficulty: 'normal' }));
    const c = scoreRun(run({ difficulty: 'hard' }));
    expect(a.multiplier).toBeLessThan(b.multiplier);
    expect(b.multiplier).toBeLessThan(c.multiplier);
    expect(a.total).toBeLessThan(b.total);
    expect(b.total).toBeLessThan(c.total);
  });

  it('unknown difficulty falls back to normal', () => {
    expect(scoreRun(run({ difficulty: 'zzz' })).multiplier).toBe(1);
  });

  it('zero shots gives zero accuracy points and never divides by zero', () => {
    const s = scoreRun(run({ shots: 0, hits: 0, kills: 0 }));
    expect(pts(s, 'accuracy')).toBe(0);
    expect(Number.isFinite(s.total)).toBe(true);
  });

  it('speed bonus is clamped at 0 and at its cap', () => {
    expect(pts(scoreRun(run({ time: 5000 })), 'speed')).toBe(0);
    expect(pts(scoreRun(run({ time: 0 })), 'speed')).toBe(SCORE.speedMax);
  });

  it('total never goes below zero even with huge damage', () => {
    const s = scoreRun(run({ extracted: false, kills: 0, shots: 0, hits: 0, damage: 99999 }));
    expect(s.total).toBe(0);
  });

  it('hits above shots are capped to 100% accuracy', () => {
    expect(pts(scoreRun(run({ shots: 10, hits: 50 })), 'accuracy')).toBe(SCORE.accuracyMax);
  });

  it('a clean fast hunter run grades A or better, a slow bare extraction grades D', () => {
    expect(['S', 'A']).toContain(scoreRun(run({ time: 300, damage: 10, kills: 25, hits: 70 })).grade);
    expect(scoreRun(run({ time: 900, kills: 1, shots: 20, hits: 2, damage: 200 })).grade).toBe('D');
  });

  it('is deterministic and handles missing fields', () => {
    expect(scoreRun(run())).toEqual(scoreRun(run()));
    expect(() => scoreRun({})).not.toThrow();
  });
});

describe('gradeFor boundaries', () => {
  it('maps thresholds exactly on the boundary', () => {
    const g = SCORE.grades;
    expect(gradeFor(g.S, true)).toBe('S');
    expect(gradeFor(g.S - 1, true)).toBe('A');
    expect(gradeFor(g.A, true)).toBe('A');
    expect(gradeFor(g.A - 1, true)).toBe('B');
    expect(gradeFor(g.B, true)).toBe('B');
    expect(gradeFor(g.B - 1, true)).toBe('C');
    expect(gradeFor(g.C, true)).toBe('C');
    expect(gradeFor(g.C - 1, true)).toBe('D');
    expect(gradeFor(0, true)).toBe('D');
  });
  it('K.I.A. grades by score on its own scale and never rises above C', () => {
    const d = SCORE.deathGrades;
    expect(gradeFor(1e9, false)).toBe('C');
    expect(gradeFor(d.C, false)).toBe('C');
    expect(gradeFor(d.C - 1, false)).toBe('D');
    expect(gradeFor(d.D, false)).toBe('D');
    expect(gradeFor(d.D - 1, false)).toBe('F');
    expect(gradeFor(0, false)).toBe('F');
  });
  it('the playtest death (HUNTER, 3:11, 21 kills, 109 shots, 2090 PTS) is a C, not an F', () => {
    expect(gradeFor(2090, false)).toBe('C');
    expect(scoreRun(run({ extracted: false, kills: 21, shots: 109, hits: 40, time: 191, damage: 100 })).grade).not.toBe('F');
  });
  it('a very poor death is still F, with a fallen title rather than an extraction title', () => {
    const s = scoreRun(run({ extracted: false, kills: 2, shots: 60, hits: 6, damage: 100 }));
    expect(s.grade).toBe('F');
    const mid = scoreRun(run({ extracted: false, kills: 21, shots: 109, hits: 40, damage: 100 }));
    expect(mid.title).toBe('FALLEN PREDATOR');
  });
});

describe('titles and tags', () => {
  it('each extracted grade maps to its own rank title', () => {
    const titles = ['S', 'A', 'B', 'C', 'D'].map((g) => {
      const total = { S: SCORE.grades.S, A: SCORE.grades.A, B: SCORE.grades.B, C: SCORE.grades.C, D: 0 }[g];
      return gradeFor(total, true);
    });
    expect(titles).toEqual(['S', 'A', 'B', 'C', 'D']);
    const seen = new Set();
    for (const kills of [0, 10, 20, 30, 40, 50, 60]) {
      for (const time of [100, 300, 500, 700]) {
        const s = scoreRun(run({ kills, time, damage: 30 }));
        seen.add(`${s.grade}:${s.title}`);
      }
    }
    const byGrade = {};
    for (const k of seen) { const [g, t] = k.split(':'); (byGrade[g] ||= new Set()).add(t); }
    for (const g of Object.keys(byGrade)) expect(byGrade[g].size).toBe(1);
  });
  it('style tag: untouched, dead eye, and none', () => {
    expect(scoreRun(run({ damage: 0 })).tag).toBe('UNTOUCHED');
    expect(scoreRun(run({ damage: 60, hits: 80, shots: 100, kills: 5 })).tag).toBe('DEAD EYE');
    expect(scoreRun(run({ damage: 60, hits: 10, shots: 100, kills: 5 })).tag).toBe('');
  });
  it('copyText is one plain-ASCII line with score and grade', () => {
    const s = scoreRun(run());
    expect(s.copyText).toContain(String(s.total));
    expect(s.copyText).toContain(s.grade);
    expect(s.copyText).not.toContain('\n');
    expect(/[^\x00-\x7f]/.test(s.copyText)).toBe(false);
  });
});

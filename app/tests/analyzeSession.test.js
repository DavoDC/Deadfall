// analyzeSession.mjs: one-page report from a session file. Fixtures are small
// synthetic sessions shaped like a half-finished real run (old format, no
// outcome) and a new-format run with encounters.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyse, formatReport, findStalls, findSessionFile, pathLength } from '../src/tools/analyzeSession.mjs';

const walk = (n, x0 = 0) => Array.from({ length: n }, (_, i) => ({ time: i, x: x0 + i * 5, z: 0, y: 0, yaw: 0 }));

const oldHalfRun = () => ({
  version: 2, startedAt: 1791888591884, endedAt: null, difficulty: 'easy',
  gameVersion: { sha: 'b941806672fc264b87103b3726c39e221944cd54', date: 'x' },
  outcome: null, kills: 2, deaths: [], damageTaken: [{ amount: 10 }, { amount: 5 }],
  damageTakenBySource: {}, shots: { fired: 13, hits: 6 },
  waypoints: [{ name: 'GATE', time: 51.18 }], events: [],
  fps: [{ time: 0, fps: 160, frameMs: 6 }, { time: 2, fps: 120, frameMs: 8 }],
  path: walk(10), state: [{ t: 0, hp: 100, frameMs: 6 }, { t: 1, hp: 80, frameMs: 9 }],
});

const newRun = () => ({
  ...oldHalfRun(), outcome: 'extracted', endReason: 'extracted', endedAt: 1791888700000,
  lastSavedAt: 1791888700000,
  encounters: [
    { id: 1, type: 'prowler', fate: 'killed', killedBy: 'carbine', firstSeenT: 5, firstSeenDist: 40, dmgToPlayer: 10 },
    { id: 2, type: 'prowler', fate: 'despawned', firstSeenT: null, firstSeenDist: null, dmgToPlayer: 0 },
    { id: 3, type: 'spitter', fate: 'alive', firstSeenT: 9, firstSeenDist: 60, dmgToPlayer: 5 },
  ],
  errors: [{ t: 3, kind: 'error', message: 'boom' }],
  env: { gpu: 'Test GPU', screen: { w: 1920, h: 1080 }, devicePixelRatio: 1 },
});

describe('analyse', () => {
  it('handles an old half-finished file without an outcome', () => {
    const r = analyse(oldHalfRun());
    expect(r.outcome).toMatch(/old format/);
    expect(r.abandoned).toBe(true);
    expect(r.damageTaken).toBe(15);
    expect(r.gameVersion).toBe('b941806');
    expect(r.hasEncounters).toBe(false);
    const text = formatReport(r);
    expect(text).toContain('did not finish cleanly');
    expect(text).toContain('no encounter log');
  });

  it('summarises encounters, weapons, errors and machine', () => {
    const r = analyse(newRun());
    expect(r.byType.prowler).toMatchObject({ spawned: 2, seen: 1, killed: 1 });
    expect(r.killsByWeapon).toEqual({ carbine: 1 });
    expect(r.neverSeen).toBe(1);
    const text = formatReport(r);
    expect(text).toContain('Outcome: extracted (extracted)');
    expect(text).toContain('Test GPU');
    expect(text).toContain('boom');
    expect(text).toContain('prowler: spawned 2, seen 1, killed 1');
  });

  it('calls a stale in-progress file abandoned and a fresh one not', () => {
    const s = { ...oldHalfRun(), outcome: 'in-progress', lastSavedAt: 1000000 };
    expect(analyse(s, { nowMs: 1000000 + 120000 }).abandoned).toBe(true);
    expect(analyse(s, { nowMs: 1000000 + 5000 }).abandoned).toBe(false);
  });

  it('survives an empty object', () => {
    expect(() => formatReport(analyse({}))).not.toThrow();
  });
});

describe('route helpers', () => {
  it('finds a stall and ignores walking', () => {
    const p = [...walk(5), ...Array.from({ length: 8 }, (_, i) => ({ time: 5 + i, x: 20, z: 0 })), ...walk(3, 100).map((q) => ({ ...q, time: q.time + 13 }))];
    const stalls = findStalls(p);
    expect(stalls).toHaveLength(1);
    expect(stalls[0].to - stalls[0].from).toBeGreaterThanOrEqual(4);
    expect(findStalls(walk(20))).toHaveLength(0);
  });

  it('measures route length', () => {
    expect(pathLength(walk(5))).toBe(20);
  });
});

describe('findSessionFile', () => {
  it('takes a file, a folder, or an extracted zip folder with telemetry/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-an-'));
    try {
      fs.mkdirSync(path.join(dir, 'telemetry'));
      fs.writeFileSync(path.join(dir, 'telemetry', 'session-1.json'), '{}');
      fs.writeFileSync(path.join(dir, 'telemetry', 'session-2.json'), '{}');
      expect(findSessionFile(dir)).toBe(path.join(dir, 'telemetry', 'session-2.json'));
      expect(findSessionFile(path.join(dir, 'telemetry'))).toBe(path.join(dir, 'telemetry', 'session-2.json'));
      expect(findSessionFile(path.join(dir, 'telemetry', 'session-1.json'))).toBe(path.join(dir, 'telemetry', 'session-1.json'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('analyse: result, input summary, hp over time', () => {
  const rich = () => ({
    ...newRun(),
    result: { score: 4210, grade: 'B', title: 'SEASONED SCOUT', tag: 'DEAD EYE' },
    state: [{ t: 0, hp: 100, frameMs: 6 }, { t: 30, hp: 80 }, { t: 60, hp: 55 }, { t: 90, hp: 100 }],
    damageTaken: [{ time: 40, amount: 30, hp: 50 }, { time: 41, amount: 38, hp: 12 }],
    inputEdges: [
      { t: 1, action: 'sprint', on: true }, { t: 11, action: 'sprint', on: false },
      { t: 2, action: 'fireDown', on: true }, { t: 3, action: 'fireDown', on: true },
      { t: 4, action: 'jump', on: true }, { t: 5, action: 'reload', on: true },
      { t: 6, action: 'aim', on: true }, { t: 9, action: 'aim', on: false },
      { t: 7, action: 'grenadeThrow', on: true }, { t: 8, action: 'melee', on: true },
      { t: 8, action: 'weapon2', on: true },
    ],
    inputEdgesDropped: 3,
  });

  it('reports score, grade and title', () => {
    const r = analyse(rich());
    expect(r.result.grade).toBe('B');
    const text = formatReport(r);
    expect(text).toContain('Score: 4210 B SEASONED SCOUT');
  });

  it('summarises inputs: presses, sprint and aim seconds', () => {
    const r = analyse(rich());
    expect(r.input.counts).toMatchObject({ fireDown: 2, jump: 1, reload: 1, grenadeThrow: 1, melee: 1, weapon2: 1 });
    expect(r.input.sprintSeconds).toBe(10);
    expect(r.input.aimSeconds).toBe(3);
    const text = formatReport(r);
    expect(text).toContain('Input:');
    expect(text).toContain('2 clicks');
    expect(text).toContain('3 edges dropped');
  });

  it('hp over time uses damage hp so the real low point shows between state samples', () => {
    const r = analyse(rich());
    expect(r.minHp).toBe(12);
    expect(formatReport(r)).toMatch(/HP over time: .*100@0:00/);
    expect(formatReport(r)).toContain('12@0:41');
  });

  it('flags an hp that never moves despite damage taken', () => {
    const s = { ...rich(), state: [{ t: 0, hp: 100 }, { t: 30, hp: 100 }], damageTaken: [{ time: 5, amount: 40 }] };
    expect(formatReport(analyse(s))).toContain('WARNING: hp never changed');
  });

  it('old files without any of this still report', () => {
    const text = formatReport(analyse(oldHalfRun()));
    expect(text).not.toContain('Score:');
    expect(text).toContain('Input: none recorded');
  });
});

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

import { describe, it, expect, vi } from 'vitest';
import { parseVersionFile, readVersion, UNKNOWN_LABEL } from '../src/server/version.js';
import { loadVersion } from '../src/game/versionInfo.js';
import { createTelemetry } from '../src/game/telemetry.js';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('parseVersionFile', () => {
  it('reads a stamped file (sha and date)', () => {
    expect(parseVersionFile(`${SHA} 2026-10-13T12:00:00+10:00\n`)).toEqual({ sha: SHA, date: '2026-10-13T12:00:00+10:00' });
  });
  it('rejects the unexpanded placeholder, junk and empty input', () => {
    for (const t of ['$Format:%H %cI$', 'abc 2026', '', null, undefined]) expect(parseVersionFile(t)).toBe(null);
  });
});

describe('readVersion', () => {
  it('uses the stamped file and never runs git', () => {
    const git = vi.fn();
    const v = readVersion('x', { readFile: () => `${SHA} 2026-10-13T12:00:00+10:00`, git });
    expect(v).toMatchObject({ sha: SHA, short: SHA.slice(0, 7), source: 'zip' });
    expect(v.label).toBe(`${SHA.slice(0, 7)} (2026-10-13)`);
    expect(git).not.toHaveBeenCalled();
  });
  it('falls back to git when the file still holds the placeholder', () => {
    const git = vi.fn((root, args) => (args[0] === 'rev-parse' ? SHA : '2026-10-12T08:00:00+00:00'));
    const v = readVersion('x', { readFile: () => '$Format:%H %cI$', git });
    expect(v).toMatchObject({ sha: SHA, date: '2026-10-12T08:00:00+00:00', source: 'git' });
  });
  it('falls back to git when the file is missing, and is unknown without git', () => {
    const v = readVersion('x', { readFile: () => { throw new Error('ENOENT'); }, git: () => '' });
    expect(v).toEqual({ sha: null, date: null, short: 'unknown', source: 'unknown', label: UNKNOWN_LABEL });
    expect(UNKNOWN_LABEL).toBe('unknown (not a release copy)');
  });
  it('ignores garbage from git', () => {
    expect(readVersion('x', { readFile: () => '', git: () => 'fatal: not a repo' }).source).toBe('unknown');
  });
});

describe('loadVersion (page side)', () => {
  const v = { sha: SHA, date: '2026-10-13T12:00:00+10:00', short: SHA.slice(0, 7) };
  it('logs the full sha and fills the title-screen footer', async () => {
    const el = { textContent: '' };
    const con = { log: vi.fn() };
    const out = await loadVersion(vi.fn(async () => ({ ok: true, json: async () => v })), { getElementById: (id) => (id === 'version-tag' ? el : null) }, con);
    expect(out).toEqual(v);
    expect(con.log).toHaveBeenCalledWith(`[deadfall] version ${SHA} 2026-10-13T12:00:00+10:00`);
    expect(el.textContent).toBe(SHA.slice(0, 7));
  });
  it('swallows a missing server', async () => {
    expect(await loadVersion(vi.fn(async () => { throw new Error('down'); }), {}, { log: vi.fn() })).toBe(null);
    expect(await loadVersion(vi.fn(async () => ({ ok: false })), {}, { log: vi.fn() })).toBe(null);
  });
});

describe('telemetry session header', () => {
  it('carries gameVersion beside the schema version, and stays null when unknown (backward compatible)', () => {
    const t = createTelemetry();
    t.start({ difficulty: 'hunter', seed: 1, gameVersion: { sha: SHA, date: 'd' } });
    const log = JSON.parse(t.toJSON());
    expect(log.version).toBe(2);
    expect(log.gameVersion).toEqual({ sha: SHA, date: 'd' });
    t.start({ difficulty: 'hunter', seed: 1 });
    expect(JSON.parse(t.toJSON()).gameVersion).toBe(null);
  });
});

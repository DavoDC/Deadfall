// Incremental telemetry persistence (docs/References/Telemetry.md, "Flush behaviour").
// Root cause these tests guard: a full pretty-printed snapshot past 64 KiB was
// rejected by fetch keepalive / sendBeacon, silently, forever, so a real
// playtest's file froze at its first 78 s. Deltas stay small by construction.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDelta, applyDelta, isDelta, lengthsOf } from '../src/game/telemetryDelta.js';
import { createSessionStore, atomicWriteFileSync, writeSession } from '../src/server/telemetryStore.js';
import { createSessionFlusher, KEEPALIVE_LIMIT } from '../src/game/telemetrySender.js';
import { createTelemetry } from '../src/game/telemetry.js';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadfall-persist-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const readSession = (startedAt) => JSON.parse(fs.readFileSync(path.join(dir, `session-${startedAt}.json`), 'utf8'));
const fresh = () => ({ lens: {}, mod: -1 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const okLens = (body) => {
  const d = JSON.parse(body);
  const lens = {};
  for (const [k, v] of Object.entries(d.arrays)) lens[k] = v.from + v.items.length;
  return { ok: true, status: 200, json: { lens } };
};
const tickAt = (t, time) => t.tick(0.016, { time, pos: { x: time, y: 0, z: 0 }, fps: 60, frameMs: 16 });

describe('telemetryDelta', () => {
  it('first delta carries everything, later deltas only the new tail', () => {
    const log = { startedAt: 5, outcome: 'in-progress', kills: 0, state: [{ t: 1 }, { t: 2 }] };
    const d1 = buildDelta(log, fresh(), undefined, 1);
    expect(d1.arrays.state).toEqual({ from: 0, items: [{ t: 1 }, { t: 2 }] });
    log.state.push({ t: 3 });
    const d2 = buildDelta(log, { lens: { state: 2 }, mod: -1 }, undefined, 2);
    expect(d2.arrays.state).toEqual({ from: 2, items: [{ t: 3 }] });
    expect(d2.scalars.outcome).toBe('in-progress');
  });

  it('resends an in-place edited entry before the acked length', () => {
    const log = { startedAt: 5, encounters: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    const mods = { encounters: [] };
    mods.encounters[1] = 7;
    const d = buildDelta(log, { lens: { encounters: 3 }, mod: 4 }, mods, 3);
    expect(d.arrays.encounters.from).toBe(1);
    expect(d.arrays.encounters.items).toHaveLength(2);
    const d2 = buildDelta(log, { lens: { encounters: 3 }, mod: 7 }, mods, 4);
    expect(d2.arrays.encounters.from).toBe(3);
  });

  it('applyDelta is idempotent and never truncates', () => {
    const session = { startedAt: 5 };
    const state = { lastSeq: 0 };
    const d = { delta: 1, startedAt: 5, seq: 2, scalars: { kills: 4 }, arrays: { state: { from: 0, items: [{ t: 1 }, { t: 2 }] } } };
    expect(applyDelta(session, d, state).ok).toBe(true);
    expect(applyDelta(session, d, state).ok).toBe(true);
    expect(session.state).toHaveLength(2);
    const shorter = { delta: 1, startedAt: 5, seq: 1, scalars: { kills: 1 }, arrays: { state: { from: 0, items: [{ t: 1 }] } } };
    applyDelta(session, shorter, state);
    expect(session.state).toHaveLength(2);
    expect(session.kills).toBe(4); // older scalars ignored
  });

  it('reports a gap instead of writing holes', () => {
    const session = { startedAt: 5, state: [{ t: 1 }] };
    const d = { delta: 1, startedAt: 5, seq: 3, scalars: {}, arrays: { state: { from: 5, items: [{ t: 9 }] } } };
    expect(applyDelta(session, d, { lastSeq: 0 })).toEqual({ ok: false, gap: true });
    expect(session.state).toHaveLength(1);
  });

  it('isDelta recognises deltas and not legacy snapshots', () => {
    expect(isDelta(buildDelta({ startedAt: 1 }, fresh(), undefined, 1))).toBe(true);
    expect(isDelta({ version: 2, startedAt: 1, state: [] })).toBe(false);
    expect(lengthsOf({ a: [1, 2], b: 3 })).toEqual({ a: 2 });
  });
});

describe('telemetryStore: atomic writes and the session store', () => {
  it('atomicWriteFileSync leaves no temp file and replaces the old content whole', () => {
    const f = path.join(dir, 'x.json');
    atomicWriteFileSync(f, '{"a":1}');
    atomicWriteFileSync(f, '{"a":2}');
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ a: 2 });
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('writeSession (legacy full snapshot) is valid JSON and mirrors latest.json', () => {
    writeSession(dir, { version: 2, startedAt: 11, outcome: null, state: [{ t: 1 }] });
    expect(readSession(11).state).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8')).startedAt).toBe(11);
  });

  it('repeated snapshots grow one valid file and stamp lastSavedAt', async () => {
    let clock = 1000;
    const store = createSessionStore(dir, { now: () => clock++ });
    const log = { startedAt: 21, outcome: 'in-progress', state: [] };
    let ack = fresh();
    for (let i = 1; i <= 5; i++) {
      log.state.push({ t: i });
      const res = await store.apply(buildDelta(log, ack, undefined, i));
      expect(res.ok).toBe(true);
      ack = { lens: res.lens, mod: -1 };
      const onDisk = readSession(21);
      expect(onDisk.state).toHaveLength(i);
      expect(onDisk.outcome).toBe('in-progress');
      expect(onDisk.lastSavedAt).toBeGreaterThanOrEqual(1000);
    }
  });

  it('out-of-order deltas do not lose data or revert the final state', async () => {
    const store = createSessionStore(dir);
    const log = { startedAt: 31, outcome: 'in-progress', endedAt: null, state: [{ t: 1 }] };
    const d1 = buildDelta(log, fresh(), undefined, 1);
    log.state.push({ t: 2 });
    const d2 = buildDelta(log, { lens: { state: 1 }, mod: -1 }, undefined, 2);
    log.outcome = 'extracted'; log.endedAt = 99; log.state.push({ t: 3 });
    const d3 = buildDelta(log, { lens: { state: 2 }, mod: -1 }, undefined, 3);
    await store.apply(d1);
    await store.apply(d2);
    await store.apply(d3);
    await store.apply(d2);
    await store.apply(d1);
    const s = readSession(31);
    expect(s.state.map((x) => x.t)).toEqual([1, 2, 3]);
    expect(s.outcome).toBe('extracted');
    expect(s.endedAt).toBe(99);
  });

  it('answers a gap with the server lengths and writes nothing new', async () => {
    const store = createSessionStore(dir);
    await store.apply(buildDelta({ startedAt: 41, state: [{ t: 1 }] }, fresh(), undefined, 1));
    const res = await store.apply(buildDelta({ startedAt: 41, state: [1, 2, 3, 4, 5, 6] }, { lens: { state: 5 }, mod: -1 }, undefined, 2));
    expect(res).toMatchObject({ ok: false, gap: true, lens: { state: 1 } });
    expect(readSession(41).state).toHaveLength(1);
  });

  it('a restarted server resumes the session from its file', async () => {
    const a = createSessionStore(dir);
    const log = { startedAt: 51, state: [{ t: 1 }, { t: 2 }] };
    await a.apply(buildDelta(log, fresh(), undefined, 1));
    log.state.push({ t: 3 });
    const b = createSessionStore(dir); // new process, empty memory
    const res = await b.apply(buildDelta(log, { lens: { state: 2 }, mod: -1 }, undefined, 2));
    expect(res.ok).toBe(true);
    expect(readSession(51).state).toHaveLength(3);
  });

  it('accepts an OLD-format snapshot (outcome null, no new fields)', async () => {
    const store = createSessionStore(dir);
    await store.apply({ version: 2, startedAt: 61, endedAt: null, outcome: null, kills: 2, state: [{ t: 1 }] });
    const s = readSession(61);
    expect(s.outcome).toBeNull();
    expect(s.lastSavedAt).toBeTypeOf('number');
  });

  it('concurrent applies for one session all land and the file is never corrupt', async () => {
    const store = createSessionStore(dir);
    const log = { startedAt: 71, state: [] };
    const ps = [];
    for (let i = 1; i <= 20; i++) {
      log.state.push({ t: i });
      ps.push(store.apply(buildDelta(log, fresh(), undefined, i)));
    }
    await Promise.all(ps);
    expect(readSession(71).state).toHaveLength(20);
  });
});

describe('createSessionFlusher', () => {
  function makeTelemetry() {
    const t = createTelemetry();
    t.start({ difficulty: 'easy', seed: 1 });
    return t;
  }

  it('sends deltas, advances the ack from the server answer, and stays under the keepalive cap', async () => {
    const t = makeTelemetry();
    const bodies = [];
    const post = vi.fn(async (body, opts) => { bodies.push({ body, opts }); return okLens(body); });
    const f = createSessionFlusher({ telemetry: t, post });
    for (let i = 0; i < 100; i++) tickAt(t, i);
    f.flush();
    await wait(5);
    for (let i = 100; i < 103; i++) tickAt(t, i);
    f.flush();
    await wait(5);
    expect(bodies).toHaveLength(2);
    const second = JSON.parse(bodies[1].body);
    expect(second.arrays.state.from).toBe(100);
    expect(second.arrays.state.items).toHaveLength(3);
    expect(bodies[1].body.length).toBeLessThan(KEEPALIVE_LIMIT);
    expect(bodies[1].opts.keepalive).toBe(true);
  });

  it('a hung request times out and later flushes still go out', async () => {
    const t = makeTelemetry();
    let calls = 0;
    const post = vi.fn(() => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200, json: { lens: {} } }); });
    const f = createSessionFlusher({ telemetry: t, post, timeoutMs: 20 });
    f.flush();
    await wait(60);
    f.flush();
    await wait(10);
    expect(calls).toBe(2);
    expect(f.stats.failed).toBe(1);
    expect(f.stats.sent).toBe(1);
  });

  it('a failed request does not advance the ack, so the data is resent', async () => {
    const t = makeTelemetry();
    tickAt(t, 0);
    const seen = [];
    let fail = true;
    const post = async (body) => {
      seen.push(JSON.parse(body));
      return fail ? { ok: false, status: 500, json: null } : { ok: true, status: 200, json: { lens: { state: 1 } } };
    };
    const f = createSessionFlusher({ telemetry: t, post });
    f.flush();
    await wait(5);
    fail = false;
    f.flush();
    await wait(5);
    expect(seen[1].arrays.state.from).toBe(0);
    expect(seen[1].arrays.state.items).toHaveLength(1);
  });

  it('soft() throttles bursts but still sends a trailing flush', async () => {
    const t = makeTelemetry();
    const post = vi.fn(async () => ({ ok: true, status: 200, json: { lens: {} } }));
    const f = createSessionFlusher({ telemetry: t, post, softGapMs: 30 });
    f.soft(); f.soft(); f.soft();
    await wait(5);
    expect(post).toHaveBeenCalledTimes(1);
    await wait(60);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('beacon() returns false instead of sending an oversize body', () => {
    const t = makeTelemetry();
    const send = vi.fn(() => true);
    const f = createSessionFlusher({ telemetry: t, post: async () => ({ ok: true }) });
    expect(f.beacon(send)).toBe(true);
    for (let i = 0; i < 3000; i++) t.recordEvent('x'.repeat(30), 'y'.repeat(30));
    expect(f.beacon(send)).toBe(false);
  });
});

describe('telemetry session lifecycle fields', () => {
  it('starts in-progress with no end data', () => {
    const t = createTelemetry();
    t.start({});
    expect(t.log.outcome).toBe('in-progress');
    expect(t.log.endedAt).toBeNull();
    expect(t.log.endReason).toBeNull();
  });

  it('stop() stamps endedAt and endReason; an outcome-less end becomes abandoned', () => {
    const t = createTelemetry();
    t.start({});
    t.stop('tab-closed');
    expect(t.log.endReason).toBe('tab-closed');
    expect(t.log.outcome).toBe('abandoned');
    expect(t.log.endedAt).toBeTypeOf('number');
  });

  it('keeps an explicit outcome and notifies on kill, damage, event, death and end', () => {
    const t = createTelemetry();
    const seen = [];
    t.setNotifier((r) => seen.push(r));
    t.start({});
    t.recordKill();
    t.recordDamageTaken({ time: 1, amount: 3, source: 'prowler' });
    t.recordEvent('paused');
    t.recordDeath({ time: 2, pos: null, cause: 'prowler' });
    t.setOutcome('died');
    t.stop('death');
    expect(t.log.outcome).toBe('died');
    expect(seen).toEqual(['start', 'kill', 'damage', 'event', 'death', 'end']);
  });

  it('a throwing notifier never breaks recording', () => {
    const t = createTelemetry();
    t.setNotifier(() => { throw new Error('boom'); });
    t.start({});
    expect(() => t.recordKill()).not.toThrow();
    expect(t.log.kills).toBe(1);
  });
});

describe('route sampling', () => {
  it('records the player path about once per second with x, y, z and yaw, fps every 2 s', () => {
    const t = createTelemetry();
    t.start({});
    for (let i = 0; i <= 600; i++) { // 10 s at 60 fps
      t.tick(1 / 60, { time: i / 60, pos: { x: i, y: 2, z: -i }, yaw: 1.5, fps: 60, frameMs: 16 });
    }
    expect(t.log.path.length).toBeGreaterThanOrEqual(10);
    expect(t.log.path.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < t.log.path.length; i++) {
      const gap = t.log.path[i].time - t.log.path[i - 1].time;
      expect(gap).toBeGreaterThanOrEqual(1);
      expect(gap).toBeLessThan(1.05);
    }
    expect(t.log.path[1]).toMatchObject({ y: 2, yaw: 1.5 });
    expect(t.log.fps.length).toBeLessThanOrEqual(6);
  });
});

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_IDLE_MINUTES, idleMinutesFromEnv, createIdleWatch, isLocalRequest,
} from '../src/server/lifecycle.js';
import { startPing, quitGame, QUIT_SCREEN_HTML, PING_INTERVAL_MS } from '../src/game/serverLink.js';

describe('idleMinutesFromEnv', () => {
  it('defaults to 10 minutes', () => {
    expect(DEFAULT_IDLE_MINUTES).toBe(10);
    expect(idleMinutesFromEnv({})).toBe(10);
  });
  it('accepts an override including fractions', () => {
    expect(idleMinutesFromEnv({ DEADFALL_IDLE_MINUTES: '0.2' })).toBe(0.2);
  });
  it('ignores junk, zero and negatives', () => {
    for (const v of ['', 'abc', '0', '-3', 'NaN']) {
      expect(idleMinutesFromEnv({ DEADFALL_IDLE_MINUTES: v })).toBe(10);
    }
  });
});

describe('createIdleWatch', () => {
  it('expires only after idleMs without a ping, and a ping resets it', () => {
    let t = 0;
    const w = createIdleWatch(1000, () => t);
    t = 900;
    expect(w.expired()).toBe(false);
    w.ping();
    t = 1800;
    expect(w.expired()).toBe(false);
    t = 1901;
    expect(w.expired()).toBe(true);
  });
  it('never expires while pings keep arriving', () => {
    let t = 0;
    const w = createIdleWatch(1000, () => t);
    for (let i = 0; i < 100; i++) {
      t += 500;
      w.ping();
      expect(w.expired()).toBe(false);
    }
  });
});

describe('isLocalRequest', () => {
  const ok = { remoteAddress: '127.0.0.1', host: 'localhost:5199' };
  it('accepts loopback with a localhost host and optional same-origin', () => {
    expect(isLocalRequest(ok)).toBe(true);
    expect(isLocalRequest({ ...ok, origin: 'http://localhost:5199' })).toBe(true);
    expect(isLocalRequest({ remoteAddress: '::1', host: '[::1]:5199' })).toBe(true);
    expect(isLocalRequest({ remoteAddress: '::ffff:127.0.0.1', host: '127.0.0.1:5199' })).toBe(true);
  });
  it('rejects remote addresses, foreign hosts and foreign origins', () => {
    expect(isLocalRequest({ ...ok, remoteAddress: '192.168.1.5' })).toBe(false);
    expect(isLocalRequest({ ...ok, host: 'evil.example' })).toBe(false);
    expect(isLocalRequest({ ...ok, host: undefined })).toBe(false);
    expect(isLocalRequest({ ...ok, origin: 'https://evil.example' })).toBe(false);
    expect(isLocalRequest({ ...ok, origin: 'not a url' })).toBe(false);
  });
});

describe('serverLink', () => {
  it('pings immediately and then on the interval, swallowing failures', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('down')));
    let tick;
    const setIntervalFn = vi.fn((fn, ms) => { tick = fn; return ms; });
    expect(startPing(fetchFn, setIntervalFn)).toBe(PING_INTERVAL_MS);
    expect(fetchFn).toHaveBeenCalledWith('/api/ping');
    tick();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('quit posts /api/quit then shows the friendly screen, even if the post fails', async () => {
    const doc = { body: { innerHTML: 'game' } };
    await quitGame(vi.fn(() => Promise.reject(new Error('reset'))), doc);
    expect(doc.body.innerHTML).toBe(QUIT_SCREEN_HTML);
    expect(doc.body.innerHTML).toContain('Deadfall has quit. You can close this tab.');
    const f = vi.fn(() => Promise.resolve({}));
    await quitGame(f, { body: {} });
    expect(f).toHaveBeenCalledWith('/api/quit', { method: 'POST' });
  });
});

describe('GET /api/version in the lifecycle plugin', () => {
  async function call(method, url) {
    const cfg = (await import('../config/vite.config.js')).default;
    const plugin = cfg.plugins.find((p) => p.name === 'deadfall-lifecycle');
    const stack = [];
    plugin.configureServer({ middlewares: { use: (fn) => stack.push(fn) }, httpServer: null });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    const next = vi.fn();
    stack[0]({ url, method }, res, next);
    return { res, next };
  }
  it('answers the build version as JSON, also on the preview server hook', async () => {
    const { res, next } = await call('GET', '/api/version');
    expect(next).not.toHaveBeenCalled();
    expect(res.headers['Content-Type']).toBe('application/json');
    const v = JSON.parse(res.body);
    expect(Object.keys(v).sort()).toEqual(['date', 'label', 'sha', 'short', 'source']);
    const cfg = (await import('../config/vite.config.js')).default;
    expect(typeof cfg.plugins.find((p) => p.name === 'deadfall-lifecycle').configurePreviewServer).toBe('function');
  });
  it('passes every other request on', async () => {
    const { next } = await call('GET', '/api/ping');
    expect(next).toHaveBeenCalled();
  });
});

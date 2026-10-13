// TELEMETRY V2 disk persistence tests (docs/References/Telemetry.md). Real fs,
// a throwaway temp directory per test - this is the part of the flight
// recorder that actually has to prove files land on disk with real content.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDir, decodeDataURL, writeSession, writeFrame, writeCapture } from '../src/server/telemetryStore.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadfall-telemetry-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('telemetryStore: ensureDir', () => {
  it('creates nested directories that do not exist yet', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    expect(fs.existsSync(nested)).toBe(false);
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('is a no-op (does not throw) when the directory already exists', () => {
    ensureDir(tmpDir);
    expect(() => ensureDir(tmpDir)).not.toThrow();
  });
});

describe('telemetryStore: decodeDataURL', () => {
  it('decodes a data: URL with a base64 payload to the original bytes', () => {
    const original = 'not really a jpeg, just some bytes';
    const b64 = Buffer.from(original, 'utf8').toString('base64');
    const buf = decodeDataURL(`data:image/jpeg;base64,${b64}`);
    expect(buf.toString('utf8')).toBe(original);
  });

  it('decodes bare base64 with no data: prefix', () => {
    const original = 'bare payload';
    const b64 = Buffer.from(original, 'utf8').toString('base64');
    const buf = decodeDataURL(b64);
    expect(buf.toString('utf8')).toBe(original);
  });
});

describe('telemetryStore: writeSession', () => {
  it('writes session-<startedAt>.json with the exact payload content', () => {
    const payload = { startedAt: 1234567890, version: 2, kills: 3 };
    const { sessionPath } = writeSession(tmpDir, payload);
    expect(fs.existsSync(sessionPath)).toBe(true);
    expect(path.basename(sessionPath)).toBe('session-1234567890.json');
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf8'))).toEqual(payload);
  });

  it('mirrors the same content to latest.json', () => {
    const payload = { startedAt: 111, kills: 1 };
    const { latestPath } = writeSession(tmpDir, payload);
    expect(path.basename(latestPath)).toBe('latest.json');
    expect(JSON.parse(fs.readFileSync(latestPath, 'utf8'))).toEqual(payload);
  });

  it('creates the target directory if it does not exist yet', () => {
    const nested = path.join(tmpDir, 'telemetry');
    expect(fs.existsSync(nested)).toBe(false);
    writeSession(nested, { startedAt: 1 });
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('overwrites both files in place on repeated calls with the same startedAt (live updates)', () => {
    const startedAt = 42;
    writeSession(tmpDir, { startedAt, kills: 0 });
    const { sessionPath, latestPath } = writeSession(tmpDir, { startedAt, kills: 5 });
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).kills).toBe(5);
    expect(JSON.parse(fs.readFileSync(latestPath, 'utf8')).kills).toBe(5);
  });

  it('latest.json always reflects the most recently written session, even a different startedAt', () => {
    writeSession(tmpDir, { startedAt: 1, kills: 1 });
    writeSession(tmpDir, { startedAt: 2, kills: 2 });
    const latest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'latest.json'), 'utf8'));
    expect(latest.startedAt).toBe(2);
    // the first session's own file is untouched, not merged/deleted
    expect(fs.existsSync(path.join(tmpDir, 'session-1.json'))).toBe(true);
  });

  it('falls back to Date.now() as startedAt when the payload omits it', () => {
    const { sessionPath } = writeSession(tmpDir, { kills: 0 });
    expect(path.basename(sessionPath)).toMatch(/^session-\d+\.json$/);
  });
});

describe('telemetryStore: writeFrame', () => {
  it('writes a decoded jpeg to frames/<startedAt>/<t>.jpg', () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal jpeg magic bytes
    const dataURL = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    const framePath = writeFrame(tmpDir, 1700000000000, 12.34, dataURL);
    expect(framePath).toBe(path.join(tmpDir, 'frames', '1700000000000', '12.34.jpg'));
    expect(fs.existsSync(framePath)).toBe(true);
    expect(Buffer.compare(fs.readFileSync(framePath), bytes)).toBe(0);
  });

  it('creates the run-specific frames directory recursively', () => {
    const dataURL = `data:image/jpeg;base64,${Buffer.from('x').toString('base64')}`;
    writeFrame(tmpDir, 555, 0, dataURL);
    expect(fs.existsSync(path.join(tmpDir, 'frames', '555'))).toBe(true);
  });

  it('keeps frames from different sessions in separate directories', () => {
    const dataURL = `data:image/jpeg;base64,${Buffer.from('x').toString('base64')}`;
    writeFrame(tmpDir, 1, 0, dataURL);
    writeFrame(tmpDir, 2, 0, dataURL);
    expect(fs.existsSync(path.join(tmpDir, 'frames', '1', '0.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'frames', '2', '0.jpg'))).toBe(true);
  });
});

// Generic named-capture sink (video recordings, screenshot rig exports) -
// see src/capture/save.js and src/capture/recorder.js/src/game/shots.js,
// which used to trigger an OS Downloads-folder save instead of this.
describe('telemetryStore: writeCapture', () => {
  it('writes a decoded file to <subdir>/<filename> under the telemetry dir', () => {
    const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]); // webm-ish magic bytes
    const dataURL = `data:video/webm;base64,${bytes.toString('base64')}`;
    const filePath = writeCapture(tmpDir, 'recordings', 'deadfall-capture-123.webm', dataURL);
    expect(filePath).toBe(path.join(tmpDir, 'recordings', 'deadfall-capture-123.webm'));
    expect(fs.existsSync(filePath)).toBe(true);
    expect(Buffer.compare(fs.readFileSync(filePath), bytes)).toBe(0);
  });

  it('creates the subdir recursively when it does not exist', () => {
    const dataURL = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
    writeCapture(tmpDir, 'shots', 'bloom-vista.png', dataURL);
    expect(fs.existsSync(path.join(tmpDir, 'shots'))).toBe(true);
  });

  it('keeps different subdirs (recordings vs shots) separate', () => {
    const dataURL = `data:application/octet-stream;base64,${Buffer.from('x').toString('base64')}`;
    writeCapture(tmpDir, 'recordings', 'a.webm', dataURL);
    writeCapture(tmpDir, 'shots', 'a.webm', dataURL);
    expect(fs.existsSync(path.join(tmpDir, 'recordings', 'a.webm'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'shots', 'a.webm'))).toBe(true);
  });

  it('overwrites an existing file of the same name in place', () => {
    const b1 = Buffer.from('first');
    const b2 = Buffer.from('second-longer-payload');
    writeCapture(tmpDir, 'recordings', 'run.webm', `data:video/webm;base64,${b1.toString('base64')}`);
    const filePath = writeCapture(tmpDir, 'recordings', 'run.webm', `data:video/webm;base64,${b2.toString('base64')}`);
    expect(Buffer.compare(fs.readFileSync(filePath), b2)).toBe(0);
  });
});

// Frame cadence (developer-only telemetry frames, docs/References/Telemetry.md):
// a frame every FRAME_INTERVAL_S of play, and a per-session cap on the number
// written to disk. The cap stops writing and logs once; old frames are kept.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FRAME_INTERVAL_S, FRAME_CAP_PER_SESSION } from '../src/game/frameCadence.js';
import { writeFrame } from '../src/server/telemetryStore.js';

const dataURL = `data:image/jpeg;base64,${Buffer.from('x').toString('base64')}`;
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadfall-frames-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('frame cadence constants', () => {
  it('a frame every 0.5 seconds of play', () => {
    expect(FRAME_INTERVAL_S).toBe(0.5);
  });

  it('at most 3000 frames per session', () => {
    expect(FRAME_CAP_PER_SESSION).toBe(3000);
  });
});

describe('writeFrame per-session cap', () => {
  it('writes up to the cap, then writes nothing more and returns null', () => {
    for (let i = 0; i < 3; i++) expect(writeFrame(tmpDir, 7, i * 0.5, dataURL, 3)).not.toBeNull();
    expect(writeFrame(tmpDir, 7, 1.5, dataURL, 3)).toBeNull();
    expect(writeFrame(tmpDir, 7, 2.0, dataURL, 3)).toBeNull();
    expect(fs.readdirSync(path.join(tmpDir, 'frames', '7')).length).toBe(3);
  });

  it('never deletes the oldest frames when the cap is reached', () => {
    for (let i = 0; i < 4; i++) writeFrame(tmpDir, 8, i * 0.5, dataURL, 3);
    // the first three frames stay; the fourth (t=1.5) was refused and never written
    expect(fs.existsSync(path.join(tmpDir, 'frames', '8', '0.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'frames', '8', '0.5.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'frames', '8', '1.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'frames', '8', '1.5.jpg'))).toBe(false);
  });

  it('logs once when the cap is reached, not on every refused frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 6; i++) writeFrame(tmpDir, 9, i * 0.5, dataURL, 2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('counts frames already on disk, so a restarted server still honours the cap', () => {
    // two frames from an earlier server process, written straight to disk
    const dir = path.join(tmpDir, 'frames', '10');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0.jpg'), 'x');
    fs.writeFileSync(path.join(dir, '0.5.jpg'), 'x');
    expect(writeFrame(tmpDir, 10, 1, dataURL, 2)).toBeNull();
  });

  it('the cap is per session: another run still writes', () => {
    writeFrame(tmpDir, 11, 0, dataURL, 1);
    expect(writeFrame(tmpDir, 11, 0.5, dataURL, 1)).toBeNull();
    expect(writeFrame(tmpDir, 12, 0, dataURL, 1)).not.toBeNull();
  });
});

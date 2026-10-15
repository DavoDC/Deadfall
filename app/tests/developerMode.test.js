// DF-144: frames, screenshots and contact sheets are developer-only.
// config/launcher.json developerMode is the switch: true writes captures under
// captures/, false answers 403 and writes nothing (no JPEG reaches disk).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeveloperMode, handleCaptureRoute } from '../src/server/captureRoutes.js';
import { parseDeveloperMode, loadDeveloperMode } from '../src/game/developerMode.js';

// a 1x1 JPEG, enough to prove bytes landed on disk
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

let dir;
let configPath;
let telemetryDir;

function writeConfig(text) {
  fs.writeFileSync(configPath, text);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadfall-devmode-'));
  configPath = path.join(dir, 'launcher.json');
  telemetryDir = path.join(dir, 'captures', 'telemetry');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readDeveloperMode', () => {
  it('true when launcher.json says developerMode true', () => {
    writeConfig('{"developerMode": true}');
    expect(readDeveloperMode(configPath)).toBe(true);
  });

  it('false when launcher.json says developerMode false', () => {
    writeConfig('{"developerMode": false}');
    expect(readDeveloperMode(configPath)).toBe(false);
  });

  it('defaults to false when the file is missing, malformed, or the value is not a real true', () => {
    expect(readDeveloperMode(configPath)).toBe(false);
    writeConfig('{ not json');
    expect(readDeveloperMode(configPath)).toBe(false);
    writeConfig('{"developerMode": "true"}');
    expect(readDeveloperMode(configPath)).toBe(false);
    writeConfig('{}');
    expect(readDeveloperMode(configPath)).toBe(false);
  });

  it('the tracked app/config/launcher.example.json keeps developerMode false by default', () => {
    expect(readDeveloperMode(fileURLToPath(new URL('../config/launcher.example.json', import.meta.url)))).toBe(false);
  });
});

describe('handleCaptureRoute: captures are written only in developer mode', () => {
  const frameBody = JSON.stringify({ startedAt: 111, t: 4.5, dataURL: TINY_JPEG });
  const captureBody = JSON.stringify({ subdir: 'shots', filename: 'a.jpg', dataURL: TINY_JPEG });

  it('developerMode true: frame and capture are written to disk and answered 204', () => {
    writeConfig('{"developerMode": true}');
    expect(handleCaptureRoute('/telemetry/frame', frameBody, { telemetryDir, configPath })).toBe(204);
    expect(fs.existsSync(path.join(telemetryDir, 'frames', '111', '4.5.jpg'))).toBe(true);
    expect(handleCaptureRoute('/telemetry/capture', captureBody, { telemetryDir, configPath })).toBe(204);
    expect(fs.existsSync(path.join(telemetryDir, 'shots', 'a.jpg'))).toBe(true);
  });

  it('developerMode false: answered 403 and no JPEG is written', () => {
    writeConfig('{"developerMode": false}');
    expect(handleCaptureRoute('/telemetry/frame', frameBody, { telemetryDir, configPath })).toBe(403);
    expect(handleCaptureRoute('/telemetry/capture', captureBody, { telemetryDir, configPath })).toBe(403);
    expect(fs.existsSync(telemetryDir)).toBe(false);
  });

  it('a URL that is not a capture route is left alone (null)', () => {
    writeConfig('{"developerMode": true}');
    expect(handleCaptureRoute('/telemetry', '{}', { telemetryDir, configPath })).toBe(null);
  });
});

describe('client developer flag (/api/config)', () => {
  it('parses only a real boolean true', () => {
    expect(parseDeveloperMode({ developerMode: true })).toBe(true);
    expect(parseDeveloperMode({ developerMode: false })).toBe(false);
    expect(parseDeveloperMode({ developerMode: 'true' })).toBe(false);
    expect(parseDeveloperMode(null)).toBe(false);
  });

  it('loadDeveloperMode reads the endpoint and falls back to false on any failure', async () => {
    const yes = async () => ({ ok: true, json: async () => ({ developerMode: true }) });
    const no = async () => ({ ok: true, json: async () => ({ developerMode: false }) });
    const broken = async () => { throw new Error('offline'); };
    expect(await loadDeveloperMode(yes)).toBe(true);
    expect(await loadDeveloperMode(no)).toBe(false);
    expect(await loadDeveloperMode(broken)).toBe(false);
  });
});

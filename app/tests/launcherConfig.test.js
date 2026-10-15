// config/launcher.json is per machine and gitignored. launcher.example.json is the
// tracked template: a missing launcher.json is created from it, an existing one is
// never overwritten, and a missing template still means developerMode false.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLauncherConfig } from '../src/server/launcherConfig.js';
import { readDeveloperMode } from '../src/server/captureRoutes.js';

const EXAMPLE = '{\n  "developerMode": false\n}\n';

let dir;
let configPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadfall-launcher-'));
  configPath = path.join(dir, 'launcher.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ensureLauncherConfig: auto-copy from launcher.example.json', () => {
  it('creates a missing launcher.json from the example', () => {
    fs.writeFileSync(path.join(dir, 'launcher.example.json'), EXAMPLE);
    ensureLauncherConfig(configPath);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(EXAMPLE);
  });

  it('never overwrites an existing launcher.json', () => {
    fs.writeFileSync(path.join(dir, 'launcher.example.json'), EXAMPLE);
    fs.writeFileSync(configPath, '{"developerMode": true}');
    ensureLauncherConfig(configPath);
    expect(fs.readFileSync(configPath, 'utf8')).toBe('{"developerMode": true}');
  });

  it('a missing example and launcher.json is not an error, and developer mode stays off', () => {
    expect(() => ensureLauncherConfig(configPath)).not.toThrow();
    expect(fs.existsSync(configPath)).toBe(false);
    expect(readDeveloperMode(configPath)).toBe(false);
  });

  it('readDeveloperMode creates the missing file from the example and then reads it', () => {
    fs.writeFileSync(path.join(dir, 'launcher.example.json'), EXAMPLE);
    expect(readDeveloperMode(configPath)).toBe(false);
    expect(fs.existsSync(configPath)).toBe(true);
    fs.writeFileSync(configPath, '{"developerMode": true}');
    expect(readDeveloperMode(configPath)).toBe(true);
  });
});

describe('the tracked template', () => {
  it('app/config/launcher.example.json keeps developerMode false', () => {
    const example = fileURLToPath(new URL('../config/launcher.example.json', import.meta.url));
    expect(JSON.parse(fs.readFileSync(example, 'utf8'))).toEqual({ developerMode: false });
  });
});

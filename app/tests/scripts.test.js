// Static checks on the user-facing Windows launchers (no network, nothing is executed).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name) => readFileSync(join(ROOT, 'scripts', name), 'utf8');
const DASHES = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const NON_ASCII = new RegExp(`[^${String.fromCharCode(0)}-${String.fromCharCode(127)}]`);

describe.each(['launch.bat', 'update.bat'])('scripts/%s', (name) => {
  const text = read(name);

  it('is plain ASCII with no em or en dashes', () => {
    expect(NON_ASCII.test(text)).toBe(false);
    expect(DASHES.test(text)).toBe(false);
  });

  it('is path-independent and leaks no absolute user paths', () => {
    expect(text).toMatch(/%~dp0|%~f0/);
    expect(text).not.toMatch(/[A-Za-z]:\\Users\\/i);
  });

  it('supports --no-pause', () => {
    expect(text).toContain('--no-pause');
  });
});

describe('launch.bat', () => {
  const text = read('launch.bat');

  it('uses the install stamp and the package lock to decide whether to npm install', () => {
    expect(text).toContain('.deadfall-install-stamp');
    expect(text).toContain('package-lock.json');
  });

  it('installs Node.js through winget and has a dry-run flag', () => {
    expect(text).toContain('winget install --id OpenJS.NodeJS.LTS');
    expect(text).toContain('--dry-run');
  });

  it('clears the stamp before npm install and writes it only after success', () => {
    const del = text.indexOf('del "%STAMP%"');
    const install = text.indexOf('call npm install');
    const fail = text.indexOf('goto :fail', install);
    const write = text.indexOf('> "%STAMP%"');
    expect(del).toBeGreaterThan(-1);
    expect(del).toBeLessThan(install);
    expect(fail).toBeLessThan(write);
  });

  it('checks the fixed dev port before starting a second server', () => {
    expect(text).toContain('set "PORT=5199"');
    expect(text).toContain('LISTENING');
  });
});

describe('update.bat', () => {
  const text = read('update.bat');

  it('downloads the GitHub main ZIP and pulls with --ff-only for clones', () => {
    expect(text).toContain('https://github.com/DavoDC/Deadfall/archive/refs/heads/main.zip');
    expect(text).toContain('pull --ff-only');
  });

  it('never overwrites installed packages, captures or the build output', () => {
    expect(text).toMatch(/robocopy .*\/XD node_modules captures dist/);
  });

  it('drops the install stamp before copying when the lock differs, and reports up to date', () => {
    expect(text.indexOf('del "%STAMP%"')).toBeLessThan(text.indexOf('robocopy "%NEWDIR%"'));
    expect(text).toContain('You are already up to date.');
  });

  it('decides "already up to date" from the robocopy exit code, not from log lines', () => {
    expect(text).toContain('set /a "COUNT=ROBO_RC & 1"');
    expect(text).not.toContain('find.exe');
  });

  it('resets the install stamp when the package lock changed and updates from a temp copy', () => {
    expect(text).toContain('.deadfall-install-stamp');
    expect(text).toContain('DF_UPDATE_COPY');
    expect(text).toContain('--source');
  });
});

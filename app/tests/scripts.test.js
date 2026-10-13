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

describe('launch.bat hidden server', () => {
  const text = read('launch.bat');

  it('starts the server hidden and never leaves a visible server window', () => {
    expect(text).toContain('-WindowStyle Hidden');
    expect(text).toContain('node_modules\\vite\\bin\\vite.js');
    expect(text).not.toMatch(/start "Deadfall Dev Server"/);
    expect(text).not.toMatch(/npm run dev/);
  });

  it('logs to app\\captures\\launcher.log and closes its own window (no cmd /k)', () => {
    expect(text).toContain('captures\\launcher.log');
    expect(text).not.toMatch(/cmd \/k/i);
    expect(text).toMatch(/:end_ok[\s\S]*exit \/b 0/);
  });

  it('waits at most 30 seconds for the server and keeps the window open on failure', () => {
    expect(text).toContain('if %WAITED% GEQ 30 goto :server_slow');
    expect(text).toMatch(/:server_slow[\s\S]*launcher\.log[\s\S]*goto :fail/);
  });

  it('tells the player to use the Quit button', () => {
    expect(text).toContain('QUIT');
  });
});

describe('update.bat stops a running server first', () => {
  const text = read('update.bat');

  it('asks /api/quit, falls back to the PID file, and verifies the port is free before copying', () => {
    expect(text).toContain('/api/quit');
    expect(text).toContain('server.pid');
    expect(text.indexOf('call :stop_server')).toBeGreaterThan(-1);
    expect(text.indexOf('call :stop_server')).toBeLessThan(text.indexOf('pull --ff-only'));
    expect(text.indexOf('call :stop_server')).toBeLessThan(text.indexOf('robocopy "%NEWDIR%"'));
    expect(text).toContain(':stop_stuck');
  });
});

describe.each(['launch.bat', 'update.bat'])('scripts/%s clean-machine rules', (name) => {
  const text = read(name);

  it('puts the built-in Windows folders first on PATH', () => {
    expect(text).toContain(String.raw`set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"`);
  });

  it('runs every powershell call with ExecutionPolicy Bypass', () => {
    const calls = text.split('\n').filter((l) => /^\s*(powershell|for .*powershell)|`powershell|'powershell/.test(l) || /\bpowershell -/.test(l));
    expect(calls.length).toBeGreaterThan(0);
    for (const l of calls) {
      if (/^\s*REM/i.test(l)) continue;
      expect(l).toContain('-ExecutionPolicy Bypass');
    }
  });

  it('never assumes bash, python, timeout.exe or a bare git without checking', () => {
    const code = text.split('\n').filter((l) => !/^\s*REM/i.test(l)).join('\n');
    expect(code).not.toMatch(/\bpython\b|\bbash\b|\bsh\.exe\b|timeout(\.exe)?\s+\/t/i);
    if (/\bgit\b/.test(code.replace(/\.git\b/g, ''))) expect(code).toContain('where git');
  });

  it('prints a banner with its title centred between two equal rules and a 2-space indent', () => {
    const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => /^echo /.test(l));
    const i = lines.findIndex((l) => /DEADFALL  -  /.test(l));
    expect(i).toBeGreaterThan(0);
    const rule = lines[i - 1];
    expect(rule).toMatch(/^echo   =+$/);
    expect(lines[i + 1]).toBe(rule);
    const width = rule.replace(/^echo   /, '').length;
    const title = lines[i].replace(/^echo /, '');
    const left = title.length - title.trimStart().length - 2;
    const right = width - left - title.trim().length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('indents every status line by two spaces', () => {
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*echo (\[\w[^\]]*\].*)$/);
      if (m) expect(l).toMatch(/^\s*echo {3}\[/);
    }
  });
});

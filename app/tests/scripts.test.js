// Static checks on the user-facing Windows launchers (no network, nothing is executed).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name) => readFileSync(join(ROOT, 'scripts', name), 'utf8');
const DASHES = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);
const NON_ASCII = new RegExp(`[^${String.fromCharCode(0)}-${String.fromCharCode(127)}]`);

describe.each(['launch.bat', 'update.bat', 'save-logs.bat'])('scripts/%s', (name) => {
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

  it('sends the server output to app\\logs\\server.log and closes its own window (no cmd /k)', () => {
    expect(text).toContain('logs\\server.log');
    expect(text).not.toContain('captures\\logs');
    expect(text).not.toContain('launcher.log');
    expect(text).not.toMatch(/cmd \/k/i);
    expect(text).toMatch(/:end_ok[\s\S]*exit \/b 0/);
  });

  it('waits at most 30 seconds for the server and keeps the window open on failure', () => {
    expect(text).toContain('if %WAITED% GEQ 30 goto :server_slow');
    expect(text).toMatch(/:server_slow[\s\S]*server\.log[\s\S]*goto :fail/);
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

describe.each(['launch.bat', 'update.bat', 'save-logs.bat'])('scripts/%s clean-machine rules', (name) => {
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

describe('save-logs.bat', () => {
  const bat = read('save-logs.bat');
  const ps = readFileSync(join(ROOT, 'app', 'src', 'tools', 'save-logs.ps1'), 'utf8');

  it('never touches the network (bat and PowerShell worker)', () => {
    for (const text of [bat, ps]) {
      expect(text).not.toMatch(/curl|Invoke-WebRequest|Invoke-RestMethod|WebClient|upload|https?:[/][/]/i);
    }
  });

  it('ends with the reassurance text and supports a no-Explorer test switch', () => {
    expect(bat).toContain('Saved to your Desktop. Nothing was');
    expect(bat).toContain('sent anywhere. Please send me this file.');
    expect(ps).toContain('DEADFALL_NO_EXPLORER');
    expect(ps).toContain('explorer.exe');
  });

  it('resolves the real Desktop, scrubs the user name and profile path on copies, and always makes a new zip', () => {
    expect(ps).toContain("GetFolderPath('Desktop')");
    expect(ps).toContain('USERPROFILE');
    expect(ps).toContain('USERNAME');
    expect(ps).toContain('IgnoreCase');
    expect(ps).toContain('Deadfall-logs-');
    expect(ps).toMatch(/while [(]Test-Path -LiteralPath [$]zipPath[)]/);
  });

  it('is plain ASCII with no dashes in the PowerShell workers too', () => {
    for (const f of ['save-logs.ps1', 'version.ps1']) {
      const text = readFileSync(join(ROOT, 'app', 'src', 'tools', f), 'utf8');
      expect(NON_ASCII.test(text), f).toBe(false);
      expect(DASHES.test(text), f).toBe(false);
    }
  });
});

describe('version display in the scripts', () => {
  it('launch.bat prints the version under the banner and logs the full sha', () => {
    const text = read('launch.bat');
    expect(text).toContain('Version: ');
    expect(text.indexOf('Version: ')).toBeLessThan(text.indexOf('[1/3]'));
    expect(text).toMatch(/server[.]log" echo .*version !DF_SHA!/);
  });
  it('update.bat reports the version it ended on', () => {
    expect(read('update.bat')).toContain('Now on version');
  });
});

describe('central logs folder', () => {
  const tool = (n) => readFileSync(join(ROOT, 'app', 'src', 'tools', n), 'utf8');
  it.each(['launch', 'update', 'save-logs'])('%s.bat logs through runlog.ps1 into app/logs', (n) => {
    const text = read(n + '.bat');
    expect(text).toContain('runlog.ps1');
    expect(text).toContain('-Name ' + n + ' ');
    expect(text).toContain('DF_LOGGED');
    expect(text).toMatch(/app.logs.<name>/);
  });
  it('runlog.ps1 appends dated logs, caps their size, and prints the path on failure', () => {
    const ps = tool('runlog.ps1');
    expect(ps).toMatch(/app.logs/);
    expect(ps).toContain('yyyy-MM-dd');
    expect(ps).toContain('FileMode]::Append');
    expect(ps).toContain('1MB');
    expect(ps).toContain('The details were saved to');
    expect(ps).not.toMatch(/https?:|Invoke-WebRequest|curl/i);
    expect(ps).not.toMatch(DASHES);
    expect(ps).not.toMatch(NON_ASCII);
  });
  it('save-logs.ps1 zips the whole logs folder', () => {
    const ps = tool('save-logs.ps1');
    expect(ps).toContain("'logs'");
    expect(ps).toContain("-Filter '*.log'");
  });
});

describe('launch.bat keeps tool noise off the console', () => {
  const text = read('launch.bat');
  it('sends npm and winget output to the tools log, not the screen', () => {
    expect(text).toMatch(/npm install --no-fund --no-audit --loglevel=error --progress=false >> "%TOOLLOG%" 2>&1/);
    expect(text).toMatch(/winget install .*>> "%TOOLLOG%" 2>&1/);
    expect(text).toContain('setup-tools.log');
  });
  it('prints Done. after first-time setup and names the log when npm fails', () => {
    expect(text).toMatch(/echo {9}Done\./);
    expect(text).toMatch(/The details are in: %TOOLLOG%/);
  });
});

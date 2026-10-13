// Pins the repo layout and docs conventions so they cannot drift silently.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in app/tests/, so the repo root is two levels up and the npm project is app/.
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..');

const ALLOWED_ROOT_FILES = ['.gitignore', '.gitattributes', 'LICENSE', 'README.md', 'CLAUDE.md'];
const ALLOWED_ROOT_DIRS = [
  'app', 'docs', 'scripts', '.github',
  // local, gitignored or tool-owned
  '.git', '.claude', 'TEMP',
];
const ALLOWED_APP_FILES = ['package.json', 'package-lock.json', 'index.html', 'VERSION'];
const ALLOWED_APP_DIRS = [
  'assets', 'config', 'src', 'tests',
  // local, gitignored
  '.vite', 'node_modules', 'dist', 'captures', 'logs',
];
// en dash (8211) and em dash (8212), built from char codes so this file stays dash-free
const DASHES = new RegExp(`[${String.fromCharCode(8211, 8212)}]`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const docsDir = join(ROOT, 'docs');
const docFiles = walk(docsDir);
const mdFiles = docFiles.filter((f) => f.endsWith('.md'));

describe('repo layout', () => {
  it('scripts/ contains only the three user-facing scripts', () => {
    expect(readdirSync(join(ROOT, 'scripts'))).toEqual(['launch.bat', 'save-logs.bat', 'update.bat']);
  });

  it('app/VERSION is stamped by git archive (export-subst) and holds the placeholder or a stamped sha', () => {
    const attrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
    expect(attrs).toMatch(/^app[/]VERSION export-subst[ ]*$/m);
    expect(attrs).toContain('*.bat text eol=crlf');
    const v = readFileSync(join(APP, 'VERSION'), 'utf8').trim();
    expect(v === '$Format:%H %cI$' || /^[0-9a-f]{40} [^ ]+$/.test(v)).toBe(true);
  });

  it('repo root contains only the allowed files and folders', () => {
    const entries = readdirSync(ROOT, { withFileTypes: true });
    const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name).sort();
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(files.filter((f) => !ALLOWED_ROOT_FILES.includes(f))).toEqual([]);
    expect(dirs.filter((d) => !ALLOWED_ROOT_DIRS.includes(d))).toEqual([]);
  });

  it('app/ holds the npm project and nothing else', () => {
    const entries = readdirSync(APP, { withFileTypes: true });
    const files = entries.filter((e) => !e.isDirectory()).map((e) => e.name);
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(files.filter((f) => !ALLOWED_APP_FILES.includes(f))).toEqual([]);
    expect(dirs.filter((d) => !ALLOWED_APP_DIRS.includes(d))).toEqual([]);
    for (const f of ALLOWED_APP_FILES) expect(existsSync(join(APP, f)), f).toBe(true);
  });

  it('the npm project is not at the repo root', () => {
    for (const f of ALLOWED_APP_FILES.filter((x) => x !== 'VERSION')) expect(existsSync(join(ROOT, f)), f).toBe(false);
  });

  it('the vite config lives in app/config/', () => {
    expect(existsSync(join(APP, 'config', 'vite.config.js'))).toBe(true);
    expect(existsSync(join(APP, 'vite.config.js'))).toBe(false);
  });
});

describe('docs conventions', () => {
  it('docs subfolders are capitalised single words', () => {
    const dirs = readdirSync(docsDir, { withFileTypes: true });
    expect(dirs.filter((d) => !d.isDirectory()).map((d) => d.name)).toEqual([]);
    for (const d of dirs) expect(d.name).toMatch(/^[A-Z][a-z]+$/);
  });

  it('markdown file names are PascalCase (images keep their names)', () => {
    for (const f of mdFiles) {
      const name = basename(f);
      const base = name.replace(/\.[^.]+$/, '');
      expect(base, name).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }
  });

  it('markdown under docs/ has no em or en dashes and no absolute user paths', () => {
    for (const f of mdFiles) {
      const text = readFileSync(f, 'utf8');
      expect(DASHES.test(text), f).toBe(false);
      expect(text, f).not.toMatch(/[A-Za-z]:[^A-Za-z0-9]+Users[^A-Za-z0-9]/i);
    }
  });

  it('every relative markdown link resolves to an existing file', () => {
    const sources = [join(ROOT, 'README.md'), join(ROOT, 'CLAUDE.md'), ...mdFiles];
    const linkRe = /\]\(([^)\s]+)\)/g;
    for (const src of sources) {
      const text = readFileSync(src, 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const m of text.matchAll(linkRe)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        expect(existsSync(resolve(dirname(src), target)), `${src} -> ${m[1]}`).toBe(true);
      }
    }
  });
});

describe('CI workflow', () => {
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  it('runs on pull requests and by hand only, never on push', () => {
    expect(ci).toMatch(/^on:\s*\r?\n\s+pull_request:/m);
    expect(ci).toContain('workflow_dispatch:');
    expect(ci).not.toMatch(/^\s+push:/m);
  });
  it('is one light job: no matrix, npm cache, superseded runs cancelled, short timeout', () => {
    expect(ci).not.toContain('matrix');
    expect(ci).toContain('cache: npm');
    expect(ci).toContain('cancel-in-progress: true');
    expect(ci).toMatch(/timeout-minutes: 10/);
  });
  it('pins every action to a major version', () => {
    for (const m of ci.matchAll(/uses: (\S+)/g)) expect(m[1]).toMatch(/@v\d+$/);
  });
  it('the repo has no local git hooks tracked', () => {
    expect(existsSync(join(ROOT, '.githooks'))).toBe(false);
  });
});

describe('renamed telemetry doc', () => {
  it('docs/References/Telemetry.md exists and no file still names the old spec file', () => {
    expect(existsSync(join(ROOT, 'docs', 'References', 'Telemetry.md'))).toBe(true);
    const old = 'TelemetryV2' + 'Spec';
    const files = [...walk(join(APP, 'src')), ...walk(join(APP, 'tests')), ...walk(join(APP, 'config')), ...walk(docsDir), join(ROOT, 'CLAUDE.md'), join(ROOT, 'README.md')];
    for (const f of files) {
      if (!/\.(js|mjs|md|json|ps1)$/.test(f)) continue;
      expect(readFileSync(f, 'utf8').includes(old), f).toBe(false);
    }
  });
});

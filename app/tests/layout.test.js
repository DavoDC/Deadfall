// Pins the repo layout and docs conventions so they cannot drift silently.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in app/tests/, so the repo root is two levels up and the npm project is app/.
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..');

const ALLOWED_ROOT_FILES = ['.gitignore', 'LICENSE', 'README.md', 'CLAUDE.md'];
const ALLOWED_ROOT_DIRS = [
  'app', 'docs', 'scripts',
  // local, gitignored or tool-owned
  '.git', '.claude', 'TEMP',
];
const ALLOWED_APP_FILES = ['package.json', 'package-lock.json', 'index.html'];
const ALLOWED_APP_DIRS = [
  'assets', 'config', 'src', 'tests',
  // local, gitignored
  '.vite', 'node_modules', 'dist', 'captures',
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
  it('scripts/ contains only launch.bat', () => {
    expect(readdirSync(join(ROOT, 'scripts'))).toEqual(['launch.bat']);
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
    for (const f of ALLOWED_APP_FILES) expect(existsSync(join(ROOT, f)), f).toBe(false);
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

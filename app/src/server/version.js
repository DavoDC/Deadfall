// Which build is this? app/VERSION holds `$Format:%H %cI$`; GitHub's Download ZIP (git archive) expands that
// placeholder (export-subst in .gitattributes) into "<40-hex sha> <commit date>". A git clone or dev checkout
// keeps the literal marker, so then we ask git (if installed). Otherwise the build is "unknown".
// Pure: the file reader and git runner are injected so it unit tests without a repo.
// The same rules live in app/src/tools/version.ps1 for the .bat scripts; tests keep the two in step.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAMPED = /^\s*([0-9a-f]{40})\s+(\S+)/i;

export const UNKNOWN_LABEL = 'unknown (not a release copy)';

// Returns { sha, date } for a stamped file body, or null for the literal marker or anything else.
export function parseVersionFile(text) {
  const m = STAMPED.exec(String(text ?? ''));
  return m ? { sha: m[1].toLowerCase(), date: m[2] } : null;
}

function gitRun(root, args) {
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

export function readVersion(root, { readFile = (p) => fs.readFileSync(p, 'utf8'), git = gitRun } = {}) {
  let stamped = null;
  try {
    stamped = parseVersionFile(readFile(path.join(root, 'app', 'VERSION')));
  } catch {
    // missing file: fall through to git
  }
  if (stamped) return { ...stamped, short: stamped.sha.slice(0, 7), source: 'zip', label: describe(stamped) };
  const sha = git(root, ['rev-parse', 'HEAD']);
  if (/^[0-9a-f]{40}$/i.test(sha)) {
    const date = git(root, ['log', '-1', '--format=%cI']) || 'unknown-date';
    const v = { sha: sha.toLowerCase(), date };
    return { ...v, short: v.sha.slice(0, 7), source: 'git', label: describe(v) };
  }
  return { sha: null, date: null, short: 'unknown', source: 'unknown', label: UNKNOWN_LABEL };
}

function describe({ sha, date }) {
  return `${sha.slice(0, 7)} (${String(date).slice(0, 10)})`;
}

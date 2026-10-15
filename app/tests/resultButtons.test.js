// DF-148: PLAY AGAIN is the primary button, the copy control is a small
// icon-only button beside the score, and the difficulty chooser sits directly
// under PLAY AGAIN (before QUIT).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const panel = html.slice(html.indexOf('class="result-panel"'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('result buttons (DF-148)', () => {
  it('the primary button reads PLAY AGAIN and RUN IT AGAIN is gone everywhere', () => {
    expect(panel).toMatch(/<button class="cta" id="btn-again">PLAY AGAIN<\/button>/);
    const files = [...walk(join(root, 'src')), join(root, 'index.html'), ...walk(join(root, '..', 'docs'))];
    for (const f of files.filter((p) => /\.(js|html|md)$/.test(p))) {
      expect(readFileSync(f, 'utf8'), f).not.toContain('RUN IT AGAIN');
    }
  });

  it('copy is an icon-only button beside the score, labelled Copy result', () => {
    const btn = panel.match(/<button[^>]*id="btn-copy"[^>]*>[\s\S]*?<\/button>/);
    expect(btn).not.toBeNull();
    expect(btn[0]).toContain('aria-label="Copy result"');
    expect(btn[0]).toContain('title="Copy result"');
    expect(btn[0]).toContain('<svg');
    expect(btn[0]).not.toContain('COPY RESULT');
    expect(panel.indexOf('id="btn-copy"')).toBeLessThan(panel.indexOf('id="btn-again"'));
    expect(panel.indexOf('id="btn-copy"')).toBeGreaterThan(panel.indexOf('class="result-score"'));
  });

  it('the difficulty chooser sits directly under PLAY AGAIN, before QUIT', () => {
    const again = panel.indexOf('id="btn-again"');
    const label = panel.indexOf('class="result-diff-label">DIFFICULTY');
    const chooser = panel.indexOf('id="end-difficulty"');
    const quit = panel.indexOf('id="btn-end-quit"');
    expect(again).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(again);
    expect(chooser).toBeGreaterThan(label);
    expect(quit).toBeGreaterThan(chooser);
    expect(panel.slice(again, label)).not.toContain('id="btn-copy"');
  });
});

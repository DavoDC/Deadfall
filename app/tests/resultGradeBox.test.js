// DF-147: the grade letter sits in its own labelled, thin-bordered box, so it
// does not read as part of the K.I.A. / EXTRACTED heading.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const panel = html.slice(html.indexOf('class="result-panel"'), html.indexOf('id="btn-again"'));

describe('grade box (DF-147)', () => {
  it('a grade box holds a small GRADE label above the letter', () => {
    const box = panel.match(/<div class="grade-box"[^>]*>([\s\S]*?)<\/div>\s*\n/);
    expect(box).not.toBeNull();
    const label = box[1].indexOf('GRADE');
    const letter = box[1].indexOf('id="end-grade"');
    expect(label).toBeGreaterThan(-1);
    expect(letter).toBeGreaterThan(label);
    expect(html).toMatch(/\.grade-box\s*\{[^}]*border:\s*1px solid/);
    expect(html).toMatch(/\.grade-label\s*\{[^}]*font-size:/);
  });

  it('the grade box is separate from the heading, not inside it', () => {
    const title = panel.match(/<div class="title" id="end-title">[^<]*<\/div>/);
    expect(title).not.toBeNull();
    expect(title[0]).not.toContain('GRADE');
    expect(title[0]).not.toContain('end-grade');
    const gradeAt = panel.indexOf('id="end-grade"');
    expect(gradeAt).toBeGreaterThan(panel.indexOf('id="end-title"'));
  });
});

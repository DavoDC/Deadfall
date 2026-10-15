// DF-136: the DEADFALL title on the start screen pulses with a slow glow in the
// accent colour, and the pulse is switched off for reduced-motion users.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

describe('title glow (DF-136)', () => {
  it('the title runs a named pulse animation of 3 to 5 seconds per cycle', () => {
    const rule = html.match(/\.title\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const dur = rule[0].match(/animation:\s*title-pulse\s+([\d.]+)s\b/);
    expect(dur).not.toBeNull();
    expect(Number(dur[1])).toBeGreaterThanOrEqual(3);
    expect(Number(dur[1])).toBeLessThanOrEqual(5);
  });

  it('the keyframes glow with a text-shadow in the accent colour (#ffc857)', () => {
    const start = html.indexOf('@keyframes title-pulse');
    expect(start).toBeGreaterThan(-1);
    const block = html.slice(start, start + 400);
    expect(block).toContain('text-shadow');
    expect(block).toContain('rgba(255, 200, 87');
  });

  it('reduced motion turns the title animation off', () => {
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.title\s*\{[^}]*animation:\s*none/);
  });
});

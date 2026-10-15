// DF-135 and DF-139: the start screen intro is short, plain and readable.
// At most 40 words, no butte / palisade / gorge / fracture / moat anywhere on the
// start screen, body text at least 18px, key words bold, five essential controls.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const BANNED = ['butte', 'palisade', 'gorge', 'fracture', 'moat'];

// the intro is the .brief block: line breaks and entities become spaces, inline tags
// vanish without a space so "<b>water</b>," reads as "water," (one word)
const briefRaw = html.match(/<div class="brief">([\s\S]*?)<\/div>/)[1];
const briefText = briefRaw.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// all visible start-screen text: the body without style or script blocks
const bodyText = html
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]+>/g, ' ');

describe('start screen intro text (DF-135, DF-139)', () => {
  it('the intro is at most 40 words', () => {
    const words = briefText.split(' ').filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(40);
  });

  it('the intro uses none of the five hard words (butte, palisade, gorge, fracture, moat)', () => {
    for (const word of BANNED) {
      expect(briefText.toLowerCase()).not.toMatch(new RegExp(`\\b${word}`));
    }
  });

  it('no banned word appears anywhere on the start screen', () => {
    for (const word of BANNED) {
      expect(bodyText.toLowerCase()).not.toMatch(new RegExp(`\\b${word}`));
    }
  });

  it('the intro body font is at least 18px', () => {
    const rule = html.match(/\.brief\s*\{([^}]*)\}/)[1];
    const size = Number(rule.match(/font-size:\s*(\d+)px/)[1]);
    expect(size).toBeGreaterThanOrEqual(18);
  });

  it('the key words in the intro are bold', () => {
    expect((briefRaw.match(/<b>/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('the controls line lists five keys', () => {
    const controls = html.match(/<div class="controls-hint">([\s\S]*?)<\/div>/)[1];
    const items = controls.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').split('·').map((s) => s.trim()).filter(Boolean);
    expect(items).toHaveLength(5);
  });
});

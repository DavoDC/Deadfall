// DF-106: the controls reminder names every action bound in input.js, shows
// on a fresh profile only once, and the pause menu can reopen it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTROLS, controlsText, shouldShowControlsOnLaunch, markControlsSeen, CONTROLS_SEEN_KEY,
} from '../src/player/controlsOverlay.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const inputSource = readFileSync(`${root}/src/player/input.js`, 'utf8');
const html = readFileSync(`${root}/index.html`, 'utf8');
const mainSource = readFileSync(`${root}/src/main.js`, 'utf8');

// the intent fields input.sample() returns, read from the real source
const intentBlock = inputSource.match(/const intent = \{([\s\S]*?)\n      \};/)[1];
const intentFields = [...intentBlock.matchAll(/^\s+(\w+)\s*[:,]/gm)].map((m) => m[1]);

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

describe('controls overlay text (DF-106)', () => {
  it('reads a real set of intent fields from input.js', () => {
    expect(intentFields.length).toBeGreaterThan(15);
    expect(intentFields).toContain('melee');
    expect(intentFields).toContain('weaponNext');
  });

  it('every action bound in input.js is covered by a control entry', () => {
    const covered = new Set(CONTROLS.flatMap((c) => c.intents));
    for (const f of intentFields) expect(covered.has(f), f).toBe(true);
  });

  it('the text names every bound action, including wheel switch, V melee, reload, sprint, jump and pause', () => {
    const text = controlsText();
    for (const c of CONTROLS) {
      expect(text).toContain(c.keys);
      expect(text).toContain(c.label);
    }
    expect(text).toMatch(/Mouse wheel: Switch weapon/);
    expect(text).toMatch(/V: Melee/);
    expect(text).toMatch(/R: Reload/);
    expect(text).toMatch(/Shift: Sprint/);
    expect(text).toMatch(/Space: Jump/);
    expect(text).toMatch(/Esc: Pause/);
  });

  it('every key code input.js binds appears as a key on the overlay', () => {
    const codes = [...inputSource.matchAll(/'(Key[A-Z]|Digit\d|Space|Shift(?:Left|Right))'/g)].map((m) => m[1]);
    const shown = controlsText().replace(/\s/g, '').toUpperCase();
    for (const code of new Set(codes)) {
      const k = code.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left|Right/, '').toUpperCase();
      expect(shown.includes(k) || shown.includes('WASD'), code).toBe(true);
    }
  });
});

describe('first launch versus second launch (DF-106)', () => {
  it('shows on a fresh profile, not on the second launch', () => {
    const storage = fakeStorage();
    expect(shouldShowControlsOnLaunch(storage)).toBe(true);
    markControlsSeen(storage);
    expect(storage.getItem(CONTROLS_SEEN_KEY)).toBe('1');
    expect(shouldShowControlsOnLaunch(storage)).toBe(false);
  });

  it('blocked storage never throws: it shows the reminder and skips the save', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    expect(shouldShowControlsOnLaunch(broken)).toBe(true);
    expect(() => markControlsSeen(broken)).not.toThrow();
    expect(shouldShowControlsOnLaunch(null)).toBe(true);
    expect(() => markControlsSeen(null)).not.toThrow();
  });
});

describe('pause menu Controls button (DF-106)', () => {
  const menu = html.slice(html.indexOf('id="menu"'), html.indexOf('id="controls"'));

  it('the menu has a CONTROLS button before QUIT, and a hidden overlay with a close button', () => {
    expect(menu).toContain('id="btn-controls">CONTROLS<');
    expect(menu.indexOf('id="btn-controls"')).toBeLessThan(menu.indexOf('id="btn-quit"'));
    expect(html).toMatch(/id="controls" class="overlay hidden"/);
    expect(html).toContain('id="btn-controls-close"');
  });

  it('main.js reopens the overlay from the button and shows it on launch only when unseen', () => {
    expect(mainSource).toMatch(/getElementById\('btn-controls'\)\.addEventListener\('click', \(\) => setControlsOpen\(true\)\)/);
    expect(mainSource).toMatch(/if \(shouldShowControlsOnLaunch\(store\)\)/);
    expect(mainSource).toContain('markControlsSeen(store)');
  });
});

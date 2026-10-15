// DF-160: the result screen has no difficulty buttons. PLAY AGAIN opens a
// difficulty step (the same cards as the start screen) with the last played
// difficulty preselected, and the DEPLOY press inside it starts the run.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resultView } from '../src/player/resultScreen.js';
import { DIFFICULTIES } from '../src/game/difficulty.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(`${root}/index.html`, 'utf8');
const panel = html.slice(html.indexOf('class="result-panel"'), html.indexOf('<script type="module"'));
const mainSource = readFileSync(`${root}/src/main.js`, 'utf8');

describe('result screen has no difficulty buttons (DF-160)', () => {
  it('the result panel has no permanent difficulty chooser or chips', () => {
    expect(panel).not.toContain('id="end-difficulty"');
    expect(panel).not.toContain('result-diff-label">DIFFICULTY');
    for (const d of Object.values(DIFFICULTIES)) {
      expect(panel).not.toContain(`>${d.label}<`);
    }
  });

  it('the result view model carries no difficulty choices (only the run label and score row)', () => {
    const v = resultView({ extracted: true, difficulty: 'hard', difficultyLabel: 'DEADFALL', time: 60, kills: 1, shots: 2, hits: 1, damage: 0, isRecord: false });
    expect(v.difficultyLabel).toBe('DEADFALL');
    expect(Object.keys(v)).not.toContain('difficulties');
    expect(Object.keys(v)).not.toContain('choices');
  });

  it('QUIT stays on the result panel', () => {
    expect(panel).toMatch(/<button class="cta quit" id="btn-end-quit">QUIT<\/button>/);
  });
});

describe('PLAY AGAIN opens the difficulty step (DF-160)', () => {
  it('PLAY AGAIN is followed by a hidden step holding the start-screen cards and a DEPLOY button', () => {
    const again = panel.indexOf('id="btn-again"');
    const step = panel.indexOf('id="again-step"');
    expect(again).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(again);
    expect(panel.slice(step, step + 40)).toContain('hidden');
    const stepHtml = panel.slice(step);
    expect(stepHtml).toContain('id="again-difficulty"');
    expect(stepHtml).toContain('id="btn-deploy-again"');
    expect(stepHtml).toContain('>DEPLOY<');
    expect(stepHtml.indexOf('id="again-difficulty"')).toBeLessThan(stepHtml.indexOf('id="btn-deploy-again"'));
  });

  it('the start screen and the step build their cards from the same loop', () => {
    expect(mainSource).toContain("for (const wrapId of ['difficulty', 'again-difficulty'])");
    expect(mainSource).toContain("wrap.appendChild(btn);");
    expect(mainSource).not.toContain('end-difficulty');
    expect(mainSource).not.toContain('diff-chip');
  });

  it('PLAY AGAIN preselects the last played difficulty, not the default', () => {
    expect(mainSource).toContain('let lastPlayedKey');
    expect(mainSource).toMatch(/lastPlayedKey = difficultyKey;/);
    expect(mainSource).toMatch(/btn-again'\)\.addEventListener\('click', \(\) => \{\s*selectDifficulty\(lastPlayedKey\);/);
  });

  it('DEPLOY in the step starts the run, which uses the selected difficulty', () => {
    expect(mainSource).toContain("document.getElementById('btn-deploy-again').addEventListener('click', startRun);");
    expect(mainSource).toContain('telemetry.start({ difficulty: difficultyKey,');
  });
});

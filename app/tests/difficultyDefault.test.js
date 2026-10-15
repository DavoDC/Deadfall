// DF-137: HUNTER is the preselected difficulty on a fresh profile and the default
// for telemetry/startRun. The internal key stays 'normal'; its label is HUNTER.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIFFICULTIES, DEFAULT_DIFFICULTY, getDifficulty } from '../src/game/difficulty.js';

const mainSource = readFileSync(fileURLToPath(new URL('../src/main.js', import.meta.url)), 'utf8');

describe('default difficulty (DF-137)', () => {
  it('the default key is normal, which is labelled HUNTER', () => {
    expect(DEFAULT_DIFFICULTY).toBe('normal');
    expect(DIFFICULTIES[DEFAULT_DIFFICULTY].label).toBe('HUNTER');
  });

  it('an unknown or missing difficulty falls back to HUNTER', () => {
    expect(getDifficulty(undefined).label).toBe('HUNTER');
    expect(getDifficulty('nonsense').label).toBe('HUNTER');
  });

  it('a fresh profile (no saved choice) starts on the default, and an invalid saved choice falls back to it', () => {
    expect(mainSource).toContain("localStorage.getItem('deadfall_difficulty') || DEFAULT_DIFFICULTY");
    expect(mainSource).toContain('if (!DIFFICULTIES[difficultyKey]) difficultyKey = DEFAULT_DIFFICULTY;');
  });

  it('telemetry.start receives the selected difficulty key, which defaults to HUNTER', () => {
    expect(mainSource).toContain('telemetry.start({ difficulty: difficultyKey,');
  });
});

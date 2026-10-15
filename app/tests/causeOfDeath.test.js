// DF-150: the K.I.A. screen names the damage source of the last hit in plain
// uppercase words. Missing or unknown sources read UNKNOWN.

import { describe, it, expect } from 'vitest';
import { causeLabel } from '../src/player/causeOfDeath.js';

describe('causeLabel (DF-150)', () => {
  it('names the environment: flood and acid', () => {
    expect(causeLabel('flood')).toBe('FLOOD');
    expect(causeLabel('acid')).toBe('ACID');
  });

  it('names an enemy in plain uppercase words', () => {
    expect(causeLabel('shrike')).toBe('SHRIKE');
    expect(causeLabel('miremother')).toBe('MIREMOTHER');
    expect(causeLabel('jugg-charge')).toBe('JUGGERNAUT');
  });

  it('reads UNKNOWN when the source is missing or unknown', () => {
    expect(causeLabel(undefined)).toBe('UNKNOWN');
    expect(causeLabel(null)).toBe('UNKNOWN');
    expect(causeLabel('')).toBe('UNKNOWN');
    expect(causeLabel('unknown')).toBe('UNKNOWN');
  });
});

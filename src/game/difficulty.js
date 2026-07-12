// Difficulty definitions - pure data, unit-testable, shared by the browser
// game and the headless playtest runner. Every knob the director, enemies
// and hazards read lives here so balance work happens in ONE place.
//
// Round-2 baseline: NORMAL is deliberately harder than round 1 (the human
// verdict was "too easy - you can almost sprint to extraction"). EASY is
// round-1-ish for learning the map; HARD is for people who want the jungle
// to win most of the time.

export const DIFFICULTIES = {
  easy: {
    key: 'easy',
    label: 'RECRUIT',
    blurb: 'Learn the jungle. It bites, but it lets you breathe.',
    playerDamageTaken: 0.65,  // incoming damage multiplier
    enemyHp: 0.85,
    budgetRate: 0.7,          // director budget regen multiplier
    capBonus: -1,             // added to the live-enemy cap
    tickScale: 1.45,          // >1 = slower spawn cadence
    rampTime: 460,            // seconds to full baseline threat
    grace: 22,                // opening seconds before the first squad
    holdTime: 15,             // extraction channel seconds
    heatGain: 0.8,            // gunfire noise multiplier
    razorfinDps: 4,
    startGrenades: 2,
  },
  normal: {
    key: 'normal',
    label: 'HUNTER',
    blurb: 'The intended run. Earn every metre north.',
    playerDamageTaken: 1.0,
    enemyHp: 1.0,
    budgetRate: 1.0,
    capBonus: 0,
    tickScale: 1.1,
    rampTime: 330,
    grace: 13,
    holdTime: 20,
    heatGain: 1.0,
    razorfinDps: 6,
    startGrenades: 2,
  },
  hard: {
    key: 'hard',
    label: 'DEADFALL',
    blurb: 'The jungle expects you. Extraction is a rumour.',
    playerDamageTaken: 1.2,
    enemyHp: 1.1,
    budgetRate: 1.25,
    capBonus: 1,
    tickScale: 0.9,
    rampTime: 255,
    grace: 8,
    holdTime: 20,
    heatGain: 1.3,
    razorfinDps: 8,
    startGrenades: 2,
  },
};

export function getDifficulty(name) {
  return DIFFICULTIES[name] || DIFFICULTIES.normal;
}

export const DEFAULT_DIFFICULTY = 'normal';

// One-time controls reminder (DF-106). CONTROLS lists every action bound in
// input.js (each entry names the intent fields it covers, and a test checks
// that no intent field in input.sample() is missing), shown once on a fresh
// profile and reopenable from the pause menu. No DOM here: the logic is pure
// so it unit tests in plain Node.

export const CONTROLS_SEEN_KEY = 'deadfall_controls_seen';

export const CONTROLS = [
  { keys: 'W A S D', label: 'Move', intents: ['moveX', 'moveZ'] },
  { keys: 'Mouse', label: 'Look', intents: ['lookDX', 'lookDY'] },
  { keys: 'Left mouse button', label: 'Fire', intents: ['firing', 'fireDown'] },
  { keys: 'Right mouse button', label: 'Aim down sights', intents: ['aim'] },
  { keys: 'Shift', label: 'Sprint', intents: ['sprint'] },
  { keys: 'Space', label: 'Jump', intents: ['jump'] },
  { keys: 'R', label: 'Reload', intents: ['reload'] },
  { keys: '1 2 3', label: 'Select weapon', intents: ['weapon1', 'weapon2', 'weapon3'] },
  { keys: 'Q', label: 'Swap to last weapon', intents: ['swap'] },
  { keys: 'Mouse wheel', label: 'Switch weapon (scroll up or down)', intents: ['weaponNext', 'weaponPrev'] },
  { keys: 'V', label: 'Melee', intents: ['melee'] },
  { keys: 'G', label: 'Grenade (hold to aim, release to throw)', intents: ['grenadeHold', 'grenadeThrow'] },
  { keys: 'E', label: 'Interact', intents: ['interact'] },
  { keys: 'Esc', label: 'Pause', intents: [] },
];

// the text shown on the overlay, one line per control
export function controlsLines() {
  return CONTROLS.map((c) => `${c.keys}: ${c.label}`);
}

export function controlsText() {
  return controlsLines().join('\n');
}

// true on a fresh profile (or when storage is unavailable, so a player in a
// private window still gets the reminder rather than losing it)
export function shouldShowControlsOnLaunch(storage) {
  try {
    return storage.getItem(CONTROLS_SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

export function markControlsSeen(storage) {
  try {
    storage.setItem(CONTROLS_SEEN_KEY, '1');
  } catch {
    // storage blocked: the reminder simply shows again next launch
  }
}

// Pure pause/resume state logic, isolated from the DOM so it can be unit
// tested without a browser. This is the seam the 2026-07-19 freeze bug
// lived in: the pause menu's visibility must be a PURE function of
// (game state, pointer-lock state) - never something toggled optimistically
// ahead of a browser event that might not arrive (throttled relock,
// missed pointerlockchange on alt-tab, pointerlockerror, etc).
//
// shouldShowMenu(gameState, locked) answers: given where the run and the
// pointer lock actually are right now, should the pause/menu overlay be
// visible? The main loop calls this every frame as a self-healing
// watchdog - even if an event was dropped, the next frame corrects it.

export function shouldShowMenu(gameState, locked) {
  if (gameState !== 'RUNNING') return true; // menu, end screen, etc.
  return !locked; // running but not locked = paused (blur/alt-tab/ESC/etc.)
}

export function resumeButtonLabel(gameState) {
  return gameState === 'RUNNING' ? 'RESUME' : 'DEPLOY';
}

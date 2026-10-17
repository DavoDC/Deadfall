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
  // the result panel (#endscreen) owns WIN and DEAD: showing the brief and
  // difficulty cards underneath it overlapped the result text
  if (isResultState(gameState)) return false;
  if (gameState !== 'RUNNING') return true; // title menu
  return !locked; // running but not locked = paused (blur/alt-tab/ESC/etc.)
}

// While a run is paused the menu overlay covers the HUD, dimming the top-left
// stats (timer, difficulty, beacon distance, cycle, seed). In that state the
// HUD is lifted above the overlay and everything but those stats is hidden
// (#hud.over-menu in index.html), so a paused screenshot still reads them.
export function statsAboveMenu(gameState, locked) {
  return gameState === 'RUNNING' && !locked;
}

// A finished run: the result panel shows, the title menu does not.
export function isResultState(gameState) {
  return gameState === 'WIN' || gameState === 'DEAD';
}

export function shouldShowEndScreen(gameState) {
  return isResultState(gameState);
}

export function resumeButtonLabel(gameState) {
  return gameState === 'RUNNING' ? 'RESUME' : 'DEPLOY';
}

// Broken-telemetry P0 (2026-08-20): main.js used to gate telemetry.tick()
// and its burst-flush behind the exact same condition as sim.step(), so
// any pause or alt-tab silently halted telemetry capture along with the
// sim - none of David's real playtest sessions produced usable data
// because of this. These two predicates are the seam that keeps the two
// concerns separate:
//
// shouldStepSim: the sim must stay gated strictly on RUNNING+locked - ESC
// is a real pause, and the autotest bot steps the sim itself while
// unlocked, so double-ticking must never happen.
export function shouldStepSim(gameState, locked) {
  return gameState === 'RUNNING' && locked;
}

// shouldRecordTelemetry: telemetry must survive a pause/alt-tab so a
// human session is captured continuously - it only cares that a run is
// in progress, never whether pointer lock currently holds.
export function shouldRecordTelemetry(gameState) {
  return gameState === 'RUNNING';
}

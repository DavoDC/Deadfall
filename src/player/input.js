// Keyboard + mouse input with pointer lock. Produces an intent snapshot each
// frame (move vector, look delta, actions) - the player controller consumes
// intents, never raw events. This is the seam a future co-op netcode layer
// plugs into: a remote player is just another intent source.

export function createInput(canvas) {
  const keys = new Set();
  let lookDX = 0;
  let lookDY = 0;
  let firing = false;
  let firedThisFrame = false; // single-click edge for semi-auto/pump
  let aiming = false;         // RMB held = aim-down-sights
  let grenadeReleased = false;
  const pressed = new Set(); // one-frame key edges
  const released = new Set();

  const state = {
    locked: false,
    onLockChange: null,
    onFireDown: null,
  };

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    pressed.add(e.code);
  });
  document.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyG') grenadeReleased = true;
  });
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
    // Alt-tab does not reliably fire pointerlockchange in every browser
    // before or in place of blur (2026-07-19 freeze playtest bug: resume
    // then alt-tab left the sim gated off with the pause menu never shown
    // because callers only heard about the unlock via pointerlockchange).
    // Treat blur itself as an authoritative "we are not locked" signal so
    // the caller's menu/pause logic runs even if pointerlockchange is late,
    // dropped, or the browser silently keeps the OS-level lock object.
    if (state.locked) {
      state.locked = false;
      if (state.onLockChange) state.onLockChange(false);
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) {
      firing = true;
      firedThisFrame = true;
      if (state.onFireDown) state.onFireDown();
    } else if (e.button === 2) {
      aiming = true;
    }
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  });
  // RMB is a game control, not a browser menu
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      firing = false;
      aiming = false;
    }
    if (state.onLockChange) state.onLockChange(state.locked);
  });
  // Browsers throttle/deny requestPointerLock() calls made too soon after
  // an unlock (a real quirk, not a bug in this game) - e.g. clicking RESUME
  // right after an alt-tab. No pointerlockchange fires when that happens,
  // so without this handler the caller never hears back and the menu the
  // click already hid never returns: sim frozen, ESC a no-op (no lock left
  // to exit). Report the denial explicitly so the caller can recover.
  document.addEventListener('pointerlockerror', () => {
    state.locked = false;
    if (state.onLockChange) state.onLockChange(false);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    exitLock() {
      if (state.locked) document.exitPointerLock();
    },
    // Consume one frame of input intent.
    sample() {
      let mx = 0;
      let mz = 0;
      if (keys.has('KeyW')) mz -= 1;
      if (keys.has('KeyS')) mz += 1;
      if (keys.has('KeyA')) mx -= 1;
      if (keys.has('KeyD')) mx += 1;
      const intent = {
        moveX: mx,
        moveZ: mz,
        lookDX,
        lookDY,
        sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        jump: pressed.has('Space'),
        reload: pressed.has('KeyR'),
        weapon1: pressed.has('Digit1'),
        weapon2: pressed.has('Digit2'),
        weapon3: pressed.has('Digit3'),
        swap: pressed.has('KeyQ'),
        interact: pressed.has('KeyE'),
        melee: pressed.has('KeyV'),
        grenadeHold: keys.has('KeyG'),
        grenadeThrow: grenadeReleased,
        aim: aiming,
        firing,
        fireDown: firedThisFrame,
      };
      lookDX = 0;
      lookDY = 0;
      firedThisFrame = false;
      grenadeReleased = false;
      pressed.clear();
      released.clear();
      return intent;
    },
  };
}

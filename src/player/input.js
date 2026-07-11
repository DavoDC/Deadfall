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
  const pressed = new Set(); // one-frame key edges

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
  document.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    lookDX += e.movementX;
    lookDY += e.movementY;
  });
  document.addEventListener('mousedown', (e) => {
    if (!state.locked || e.button !== 0) return;
    firing = true;
    firedThisFrame = true;
    if (state.onFireDown) state.onFireDown();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) firing = false;
  });

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) keys.clear();
    if (state.onLockChange) state.onLockChange(state.locked);
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
        swap: pressed.has('KeyQ'),
        interact: pressed.has('KeyE'),
        firing,
        fireDown: firedThisFrame,
      };
      lookDX = 0;
      lookDY = 0;
      firedThisFrame = false;
      pressed.clear();
      return intent;
    },
  };
}

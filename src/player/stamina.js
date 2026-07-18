// Stamina is a sprint resource: drains while sprinting, regens otherwise,
// and must be able to hit true zero and force a walk (round-8 playtest:
// "STAMINA NEVER FULLY GOES DOWN"). The old inline logic gated sprint at
// stamina > 0.05, so the drain branch stopped firing a hair before empty
// and the regen branch started immediately after - the bar never actually
// bottomed out. This version drains all the way to 0, then holds an
// EXHAUSTED state (forced walk) until stamina climbs back above a recovery
// threshold, so hitting empty is a real, felt event rather than a floor.
//
// Pure function - no THREE, no player object - so it is unit-testable on
// its own and the controller just wires it to real input/dt.

export const STAMINA_DRAIN = 0.22;   // per second while sprinting
export const STAMINA_REGEN = 0.14;   // per second while not sprinting
export const EXHAUST_RECOVER = 0.5;  // stamina must climb back to this to sprint again

// state: { stamina: 0..1, exhausted: bool }
// sprintRequested: true if input+movement conditions want a sprint (caller
//   has already checked moving/aim/direction - this only owns the resource)
// Returns a NEW state object plus `sprinting` (whether sprint actually ran).
export function updateStamina(state, sprintRequested, dt, drain = STAMINA_DRAIN, regen = STAMINA_REGEN, recover = EXHAUST_RECOVER) {
  let { stamina, exhausted } = state;
  if (stamina <= 0) exhausted = true;
  else if (stamina >= recover) exhausted = false;

  const sprinting = sprintRequested && stamina > 0 && !exhausted;
  if (sprinting) {
    stamina = Math.max(0, stamina - dt * drain);
  } else {
    stamina = Math.min(1, stamina + dt * regen);
  }
  if (stamina <= 0) exhausted = true;

  return { stamina, exhausted, sprinting };
}

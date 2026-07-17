// THE FLOOD (round 5, SPEC O) - the second environmental hazard, and the
// first TIME-PRESSURED one. Once per run, as the player closes on the
// gorge, the rift swells and drowns its whole band under nine metres of
// razorfin-red water over ~40 seconds, forcing a vertical retreat (the
// gorge roosts, src/world/roosts.js) or a run for the band's edge.
//
// Sim-side and headless-safe, like weather.js: this file owns the MECHANIC
// (phases, rise curve, hazard); presentation (rising water mesh, spreading
// red tint, toasts, rumble) subscribes through ui.onFlood and reads state.
//
// Phase machine:
//   idle      - armed; triggers when a player nears the gorge (time-gated)
//   telegraph - 12s: red tint sweeps out from the rift, water creeps up
//               ~1m, "THE GORGE IS SWELLING". No damage yet - this is the
//               read-and-react window.
//   surge     - 26s: water climbs to RISE_MAX. Razorfins ride the flood in
//               (hazard ramps with the water).
//   peak      - 16s: full flood. Deep water everywhere in the band; being
//               swum-over is death-by-swarm. Survive HIGH.
//   recede    - 22s: drains back; hazard fades with the water.
//   done      - spent for this run (resetRun re-arms).
//
// The telegraph-to-peak climb is 38s - inside SPEC O's 30-60s window.

import { WORLD, FLOOD, floodMask, waterLevelAt, gorgeZ } from '../world/heightmap.js';
import { clamp, smoothstep } from '../core/noise.js';

export const PHASES = {
  telegraph: 12,
  surge: 26,
  peak: 16,
  recede: 22,
};

// A run must be underway before the jungle turns the river against you -
// the insertion plain stays a tutorial space.
const MIN_TRIGGER_TIME = 50;
// Arm distance from the gorge centre-line: far enough out that the
// telegraph lands BEFORE the player is wading the band.
const TRIGGER_DIST = 120;

export function createFlood(ui = {}) {
  const f = {
    phase: 'idle',
    t: 0,            // seconds in current phase
    spent: false,    // one flood per run
    rise: 0,         // mirror of FLOOD.rise (metres)
    tintFront: 0,    // 0..1: how far the red telegraph has swept out
    tintIntensity: 0, // 0..1: blood saturation of the flood tint
    fins: 0,         // 0..1: razorfin presence riding the flood
  };

  function announce(kind) {
    if (ui.onFlood) ui.onFlood(kind, f);
  }

  function setPhase(phase) {
    f.phase = phase;
    f.t = 0;
    announce(phase);
  }

  // Trigger check: first alive player to close on the gorge springs it.
  function shouldTrigger(players, time) {
    if (f.spent || f.phase !== 'idle' || time < MIN_TRIGGER_TIME) return false;
    for (const ctrl of players) {
      if (!ctrl.p.alive) continue;
      const pp = ctrl.p.pos;
      if (Math.abs(pp.z - gorgeZ(pp.x)) < TRIGGER_DIST) return true;
    }
    return false;
  }

  function trigger() {
    if (f.phase !== 'idle' || f.spent) return false;
    f.spent = true;
    setPhase('telegraph');
    return true;
  }

  function update(dt, players, time) {
    if (f.phase === 'idle') {
      if (shouldTrigger(players, time)) trigger();
      return;
    }
    if (f.phase === 'done') return;

    f.t += dt;
    const dur = PHASES[f.phase];
    const k = clamp(f.t / dur, 0, 1);

    if (f.phase === 'telegraph') {
      // the water stirs (a creeping first metre) while the red sweeps out
      f.rise = 1.2 * k;
      f.tintFront = k;
      f.tintIntensity = 0.55 * k;
      f.fins = 0;
      if (f.t >= dur) setPhase('surge');
    } else if (f.phase === 'surge') {
      const s = smoothstep(0, 1, k); // ease the climb - reads as a swell
      f.rise = 1.2 + (FLOOD.RISE_MAX - 1.2) * s;
      f.tintFront = 1;
      f.tintIntensity = 0.55 + 0.45 * k;
      f.fins = 0.75 * k;
      if (f.t >= dur) setPhase('peak');
    } else if (f.phase === 'peak') {
      f.rise = FLOOD.RISE_MAX;
      f.tintIntensity = 1;
      f.fins = 1;
      if (f.t >= dur) setPhase('recede');
    } else if (f.phase === 'recede') {
      const s = smoothstep(0, 1, k);
      f.rise = FLOOD.RISE_MAX * (1 - s);
      f.tintIntensity = 1 - s;
      f.fins = 1 - s;
      if (f.t >= dur) {
        f.rise = 0;
        f.tintFront = 0;
        f.tintIntensity = 0;
        f.fins = 0;
        setPhase('done');
      }
    }
    FLOOD.rise = f.rise;
  }

  // Is the flood a live threat (worth retreating from)? Used by the bot.
  function dangerous() {
    if (f.phase === 'telegraph' || f.phase === 'surge' || f.phase === 'peak') return true;
    return f.phase === 'recede' && f.rise > 2.5;
  }

  // Razorfin-swarm hazard riding the flood, in [0,1]. Zero until the
  // surge brings the swarm in; zero whenever your FEET are above the
  // water (a roost, a hilltop - height is safety, that is the mechanic).
  function hazardAt(x, z, feetY) {
    if (f.fins <= 0) return 0;
    const m = floodMask(x, z);
    if (m < 0.15) return 0;
    const over = waterLevelAt(x, z) - feetY;   // metres of water above feet
    return f.fins * m * smoothstep(0.9, 2.2, over);
  }

  function reset() {
    f.phase = 'idle';
    f.t = 0;
    f.spent = false;
    f.rise = 0;
    f.tintFront = 0;
    f.tintIntensity = 0;
    f.fins = 0;
    FLOOD.rise = 0;
  }

  return { state: f, update, trigger, dangerous, hazardAt, reset, PHASES };
}

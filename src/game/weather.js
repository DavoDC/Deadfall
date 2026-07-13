// Variable weather - a sim-side state machine (headless-safe), because
// weather is a MECHANIC here, not just a mood:
//   STORM  - thunder masks your gunfire (the director barely hears shots);
//            the jungle darkens, lightning walks the canopy
//   FOG    - a rolling bank; hunters track you far worse (their periodic
//            fix on you gets much noisier)... but you cannot see them far
//            either. Sneaking weather.
//   RAIN   - a light veil; slightly muffles noise
//   CLEAR  - the fever-bright baseline
// Presentation (fog lerps, rain particles, lightning flashes, thunder)
// subscribes through ui.onWeather.

export const WEATHER = {
  clear: {
    key: 'clear',
    label: 'THE SKY CLEARS',
    heatMult: 1,       // gunfire noise reaching the director
    fixNoiseMult: 1,   // enemy tracking error multiplier
    fogMult: 1,
    sunMult: 1,
    rain: 0,
  },
  rain: {
    key: 'rain',
    label: 'RAIN MOVES IN',
    heatMult: 0.8,
    fixNoiseMult: 1.15,
    fogMult: 1.15,
    sunMult: 0.85,
    rain: 0.45,
  },
  storm: {
    key: 'storm',
    label: 'STORMFRONT - THUNDER SWALLOWS YOUR GUNFIRE',
    heatMult: 0.4,
    fixNoiseMult: 1.4,
    fogMult: 1.35,
    sunMult: 0.5,
    rain: 1,
  },
  fog: {
    key: 'fog',
    label: 'FOG BANK - NOTHING SEES FAR IN THIS',
    heatMult: 0.9,
    fixNoiseMult: 2.3,
    fogMult: 2.5,
    sunMult: 0.75,
    rain: 0,
  },
};

// transition weights (from any state; same-state redraws just extend)
const WEIGHTS = [
  ['clear', 0.34],
  ['rain', 0.26],
  ['storm', 0.18],
  ['fog', 0.22],
];

export function createWeather(ui = {}) {
  const w = {
    kind: 'clear',
    t: 0,          // seconds in current state
    dur: 50,       // seconds until next roll
  };

  function roll() {
    const r = Math.random();
    let acc = 0;
    let next = 'clear';
    for (const [kind, p] of WEIGHTS) {
      acc += p;
      if (r <= acc) {
        next = kind;
        break;
      }
    }
    w.t = 0;
    w.dur = 45 + Math.random() * 50;
    if (next !== w.kind) {
      w.kind = next;
      if (ui.onWeather) ui.onWeather(WEATHER[next]);
    }
  }

  function update(dt) {
    w.t += dt;
    if (w.t >= w.dur) roll();
  }

  function mods() {
    return WEATHER[w.kind];
  }

  function reset() {
    // every run opens readable: clear or light rain, first roll comes later
    w.kind = Math.random() < 0.7 ? 'clear' : 'rain';
    w.t = 0;
    w.dur = 40 + Math.random() * 40;
    if (ui.onWeather) ui.onWeather(WEATHER[w.kind], true);
  }

  return { state: w, update, mods, reset };
}

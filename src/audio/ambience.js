// Living jungle ambience, and the oldest trick in horror: the birds know
// before you do. Bird calls thin out as hostiles close in; below the calls,
// a low drone swells with danger. The silence IS the warning (pillar 1).

import { audioCtx, master } from './engine.js';

let nodes = null;

export function startAmbience() {
  const ctx = audioCtx();
  if (!ctx || nodes) return;

  // wind/foliage bed: looped noise through a slow-wobbling lowpass
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // cheap pink-ish: integrate white noise with leak
    last = last * 0.97 + (Math.random() * 2 - 1) * 0.15;
    data[i] = last;
  }
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuf;
  wind.loop = true;
  const windLp = ctx.createBiquadFilter();
  windLp.type = 'lowpass';
  windLp.frequency.value = 480;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.16;
  const windLfo = ctx.createOscillator();
  windLfo.frequency.value = 0.07;
  const windLfoG = ctx.createGain();
  windLfoG.gain.value = 180;
  windLfo.connect(windLfoG).connect(windLp.frequency);
  wind.connect(windLp).connect(windGain).connect(master);
  wind.start();
  windLfo.start();

  // insect shimmer: hissy band up top, chirpy AM
  const insects = ctx.createBufferSource();
  insects.buffer = noiseBuf;
  insects.loop = true;
  insects.playbackRate.value = 1.7;
  const insHp = ctx.createBiquadFilter();
  insHp.type = 'bandpass';
  insHp.frequency.value = 5200;
  insHp.Q.value = 2.2;
  const insGain = ctx.createGain();
  insGain.gain.value = 0.035;
  const insLfo = ctx.createOscillator();
  insLfo.frequency.value = 9;
  const insLfoG = ctx.createGain();
  insLfoG.gain.value = 0.017;
  insLfo.connect(insLfoG).connect(insGain.gain);
  insects.connect(insHp).connect(insGain).connect(master);
  insects.start();
  insLfo.start();

  // danger drone: silent until something is close
  const drone = ctx.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.value = 47;
  const drone2 = ctx.createOscillator();
  drone2.type = 'sine';
  drone2.frequency.value = 63.4; // detuned beat
  const droneLp = ctx.createBiquadFilter();
  droneLp.type = 'lowpass';
  droneLp.frequency.value = 240;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0;
  drone.connect(droneLp);
  drone2.connect(droneLp);
  droneLp.connect(droneGain).connect(master);
  drone.start();
  drone2.start();

  // rain layer (gated by mood)
  const rain = ctx.createBufferSource();
  rain.buffer = noiseBuf;
  rain.loop = true;
  rain.playbackRate.value = 1.3;
  const rainHp = ctx.createBiquadFilter();
  rainHp.type = 'highpass';
  rainHp.frequency.value = 2400;
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  rain.connect(rainHp).connect(rainGain).connect(master);
  rain.start();

  nodes = { windGain, insGain, droneGain, rainGain, birdTimer: 2, danger: 0 };
}

export function setRain(on) {
  if (!nodes) return;
  const ctx = audioCtx();
  nodes.rainGain.gain.setTargetAtTime(on ? 0.06 : 0, ctx.currentTime, 1.2);
}

function birdCall() {
  const ctx = audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const kind = Math.floor(Math.random() * 3);
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(master);
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const tt = t + i * (0.09 + kind * 0.05);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = [2100, 1450, 2900][kind] * (0.92 + Math.random() * 0.16);
    osc.frequency.setValueAtTime(f0, tt);
    osc.frequency.linearRampToValueAtTime(f0 * (kind === 1 ? 0.7 : 1.3), tt + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, tt);
    g.gain.linearRampToValueAtTime(0.05, tt + 0.015);
    g.gain.linearRampToValueAtTime(0.0001, tt + 0.09);
    osc.connect(g).connect(pan);
    osc.start(tt);
    osc.stop(tt + 0.12);
  }
}

// danger in [0,1]: 0 = calm jungle, 1 = something is on top of you
export function updateAmbience(danger, dt) {
  if (!nodes) return;
  nodes.danger += (danger - nodes.danger) * Math.min(1, dt * 1.5);
  const d = nodes.danger;
  const ctx = audioCtx();

  // drone swells with danger
  nodes.droneGain.gain.setTargetAtTime(d * d * 0.16, ctx.currentTime, 0.4);
  // insects hush a little
  nodes.insGain.gain.setTargetAtTime(0.035 * (1 - d * 0.7), ctx.currentTime, 0.6);

  // birds: frequent when calm, gone when hunted
  nodes.birdTimer -= dt;
  if (nodes.birdTimer <= 0) {
    if (d < 0.35 && Math.random() > d * 2) birdCall();
    nodes.birdTimer = 2.2 + Math.random() * 5 + d * 9;
  }
}

export function ambienceRunning() {
  return !!nodes;
}

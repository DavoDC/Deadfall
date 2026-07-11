// WebAudio synthesis engine. Zero audio assets - every sound is built from
// oscillators and shaped noise at runtime. One master compressor glues the
// mix and stops gunfire from clipping.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 22;
  comp.ratio.value = 9;
  comp.attack.value = 0.002;
  comp.release.value = 0.16;
  master = ctx.createGain();
  master.gain.value = 0.85;
  master.connect(comp);
  comp.connect(ctx.destination);

  // 2s of white noise, reused by everything
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function audioCtx() {
  return ctx;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function noiseSource() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  return src;
}

// Fire-and-forget envelope helper.
function env(node, t0, points) {
  // points: [ [dt, value], ... ] linear ramps from t0
  node.setValueAtTime(points[0][1], t0);
  for (let i = 1; i < points.length; i++) {
    node.linearRampToValueAtTime(points[i][1], t0 + points[i][0]);
  }
}

// Optional 3D position: route through a panner.
function out(gainNode, pos) {
  if (pos) {
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'exponential';
    pan.refDistance = 4;
    pan.rolloffFactor = 1.5;
    pan.positionX.value = pos.x;
    pan.positionY.value = pos.y;
    pan.positionZ.value = pos.z;
    gainNode.connect(pan);
    pan.connect(master);
    return pan;
  }
  gainNode.connect(master);
  return gainNode;
}

export function setListener(pos, fwd) {
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    l.positionX.value = pos.x;
    l.positionY.value = pos.y;
    l.positionZ.value = pos.z;
    l.forwardX.value = fwd.x;
    l.forwardY.value = fwd.y;
    l.forwardZ.value = fwd.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }
}

// ---------------- one-shot SFX ----------------

export function sfxGunshot(kind) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const big = kind === 'shotgun';

  // crack transient
  const n1 = noiseSource();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = big ? 900 : 1600;
  const g1 = ctx.createGain();
  env(g1.gain, t, [[0, big ? 0.9 : 0.75], [big ? 0.05 : 0.03, 0.001]]);
  n1.connect(hp).connect(g1);
  out(g1);
  n1.start(t);
  n1.stop(t + 0.08);

  // body thump
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  env(osc.frequency, t, [[0, big ? 130 : 170], [big ? 0.11 : 0.07, big ? 38 : 55]]);
  const g2 = ctx.createGain();
  env(g2.gain, t, [[0, big ? 0.95 : 0.7], [big ? 0.14 : 0.09, 0.001]]);
  osc.connect(g2);
  out(g2);
  osc.start(t);
  osc.stop(t + 0.16);

  // tail
  const n2 = noiseSource();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  env(lp.frequency, t, [[0, big ? 1400 : 2000], [big ? 0.4 : 0.25, 220]]);
  const g3 = ctx.createGain();
  env(g3.gain, t, [[0, big ? 0.5 : 0.34], [big ? 0.42 : 0.26, 0.001]]);
  n2.connect(lp).connect(g3);
  out(g3);
  n2.start(t);
  n2.stop(t + 0.5);
}

export function sfxDryFire() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 2600;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.12], [0.025, 0.001]]);
  osc.connect(g);
  out(g);
  osc.start(t);
  osc.stop(t + 0.04);
}

export function sfxReload(stage) {
  // stage: 'out' | 'in' | 'shell' | 'pump'
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = stage === 'pump' ? 700 : stage === 'shell' ? 1500 : 1100;
  bp.Q.value = 3;
  const g = ctx.createGain();
  const len = stage === 'pump' ? 0.09 : 0.05;
  env(g.gain, t, [[0, 0.3], [len, 0.001]]);
  n.connect(bp).connect(g);
  out(g);
  n.start(t);
  n.stop(t + len + 0.02);
  if (stage === 'in' || stage === 'pump') {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = stage === 'pump' ? 300 : 420;
    const g2 = ctx.createGain();
    env(g2.gain, t + len * 0.5, [[0, 0.14], [0.03, 0.001]]);
    osc.connect(g2);
    out(g2);
    osc.start(t + len * 0.5);
    osc.stop(t + len * 0.5 + 0.05);
  }
}

export function sfxHitmarker(kill) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = kill ? 320 : 1250;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.22], [kill ? 0.1 : 0.045, 0.001]]);
  osc.connect(g);
  out(g);
  osc.start(t);
  osc.stop(t + 0.12);
}

export function sfxFootstep(wet, sprint) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const f = ctx.createBiquadFilter();
  f.type = wet ? 'bandpass' : 'lowpass';
  f.frequency.value = wet ? 900 + Math.random() * 500 : 300 + Math.random() * 160;
  f.Q.value = wet ? 2.5 : 0.8;
  const g = ctx.createGain();
  const v = (sprint ? 0.16 : 0.1) * (wet ? 1.5 : 1);
  env(g.gain, t, [[0, v], [wet ? 0.12 : 0.07, 0.001]]);
  n.connect(f).connect(g);
  out(g);
  n.start(t);
  n.stop(t + 0.15);
}

export function sfxLand(impact) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.3 * impact + 0.08], [0.12, 0.001]]);
  n.connect(lp).connect(g);
  out(g);
  n.start(t);
  n.stop(t + 0.14);
}

export function sfxPickup(kind) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const base = kind === 'medkit' ? 620 : 440;
  env(osc.frequency, t, [[0, base], [0.09, base * 1.5]]);
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.2], [0.14, 0.001]]);
  osc.connect(g);
  out(g);
  osc.start(t);
  osc.stop(t + 0.16);
}

export function sfxHurt() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  env(osc.frequency, t, [[0, 220], [0.12, 90]]);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 800;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.3], [0.16, 0.001]]);
  osc.connect(lp).connect(g);
  out(g);
  osc.start(t);
  osc.stop(t + 0.2);
}

// Positional creature call. kind: 'prowler' | 'spitter' | 'juggernaut'
export function sfxCreature(kind, pos, intensity = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (kind === 'prowler') {
    // low feline growl: saw through wobbling lowpass
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    env(osc.frequency, t, [[0, 95], [0.5, 70 + Math.random() * 20]]);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 130;
    lfo.connect(lfoG).connect(lp.frequency);
    const g = ctx.createGain();
    env(g.gain, t, [[0, 0.001], [0.06, 0.5 * intensity], [0.55, 0.001]]);
    osc.connect(lp).connect(g);
    out(g, pos);
    osc.start(t); osc.stop(t + 0.6);
    lfo.start(t); lfo.stop(t + 0.6);
  } else if (kind === 'spitter') {
    // insectoid chitter: fast FM blips
    for (let i = 0; i < 6; i++) {
      const tt = t + i * 0.045;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 900 + Math.random() * 700;
      const g = ctx.createGain();
      env(g.gain, tt, [[0, 0.16 * intensity], [0.025, 0.001]]);
      osc.connect(g);
      out(g, pos);
      osc.start(tt);
      osc.stop(tt + 0.04);
    }
  } else {
    // juggernaut: sub-bass bellow + chest rumble
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    env(osc.frequency, t, [[0, 55], [0.3, 80], [1.0, 40]]);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = ctx.createGain();
    env(g.gain, t, [[0, 0.001], [0.12, 0.75 * intensity], [1.1, 0.001]]);
    osc.connect(lp).connect(g);
    out(g, pos);
    osc.start(t);
    osc.stop(t + 1.2);
  }
}

export function sfxAcidSpit(pos) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  env(bp.frequency, t, [[0, 500], [0.18, 1900]]);
  bp.Q.value = 4;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.35], [0.2, 0.001]]);
  n.connect(bp).connect(g);
  out(g, pos);
  n.start(t);
  n.stop(t + 0.22);
}

export function sfxAcidSplat(pos) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  env(lp.frequency, t, [[0, 2400], [0.16, 300]]);
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.4], [0.18, 0.001]]);
  n.connect(lp).connect(g);
  out(g, pos);
  n.start(t);
  n.stop(t + 0.2);
}

export function sfxHeartbeat() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const [dt2, vol] of [[0, 0.34], [0.16, 0.22]]) { // lub-dub
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    env(osc.frequency, t + dt2, [[0, 58], [0.09, 34]]);
    const g = ctx.createGain();
    env(g.gain, t + dt2, [[0, 0.001], [0.015, vol], [0.12, 0.001]]);
    osc.connect(g);
    out(g);
    osc.start(t + dt2);
    osc.stop(t + dt2 + 0.15);
  }
}

export function sfxExtractTone(progress) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 500 + progress * 400;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.16], [0.1, 0.001]]);
  osc.connect(g);
  out(g);
  osc.start(t);
  osc.stop(t + 0.12);
}

export function sfxStinger(kind) {
  // 'win' | 'death'
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = kind === 'win' ? [392, 523, 659, 784] : [300, 220, 155, 110];
  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = kind === 'win' ? 'triangle' : 'sawtooth';
    osc.frequency.value = f;
    const g = ctx.createGain();
    const tt = t + i * (kind === 'win' ? 0.12 : 0.22);
    env(g.gain, tt, [[0, 0.001], [0.03, 0.25], [kind === 'win' ? 0.3 : 0.5, 0.001]]);
    osc.connect(g);
    out(g);
    osc.start(tt);
    osc.stop(tt + 0.6);
  });
}

export { master };

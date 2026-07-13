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

// Positional creature call.
// kind: 'prowler' | 'spitter' | 'juggernaut' | 'stingerwing' | 'shrike' | 'bloomcaller'
export function sfxCreature(kind, pos, intensity = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (kind === 'stingerwing') {
    // glassy wing-buzz: detuned saw pair with a tremolo wobble
    const g = ctx.createGain();
    env(g.gain, t, [[0, 0.001], [0.04, 0.09 * intensity], [0.5, 0.001]]);
    for (const detune of [0, 9]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 210 + Math.random() * 60;
      osc.detune.value = detune;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 1.4;
      osc.connect(bp).connect(g);
      osc.start(t);
      osc.stop(t + 0.55);
    }
    out(g, pos);
    return;
  }
  if (kind === 'shrike') {
    // whooping gibbon shriek: fast rising-falling sine whoops
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.14;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      env(osc.frequency, tt, [[0, 700], [0.06, 1500], [0.13, 800]]);
      const g = ctx.createGain();
      env(g.gain, tt, [[0, 0.001], [0.02, 0.22 * intensity], [0.13, 0.001]]);
      osc.connect(g);
      out(g, pos);
      osc.start(tt);
      osc.stop(tt + 0.15);
    }
    return;
  }
  if (kind === 'bloomcaller') {
    // deep hollow croon, like wind over a giant bottle
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    env(osc.frequency, t, [[0, 130], [0.5, 190], [1.2, 110]]);
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    env(osc2.frequency, t, [[0, 262], [0.5, 382], [1.2, 222]]);
    const g = ctx.createGain();
    env(g.gain, t, [[0, 0.001], [0.2, 0.3 * intensity], [1.3, 0.001]]);
    osc.connect(g);
    osc2.connect(g);
    out(g, pos);
    osc.start(t);
    osc.stop(t + 1.35);
    osc2.start(t);
    osc2.stop(t + 1.35);
    return;
  }
  if (kind === 'miremother') {
    // the apex: a chest-crushing sub bellow under a rising serpent scream
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    env(sub.frequency, t, [[0, 38], [0.4, 52], [1.6, 24]]);
    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.value = 160;
    const gSub = ctx.createGain();
    env(gSub.gain, t, [[0, 0.001], [0.15, 0.85 * intensity], [1.8, 0.001]]);
    sub.connect(subLp).connect(gSub);
    out(gSub, pos);
    sub.start(t);
    sub.stop(t + 1.9);
    const scream = ctx.createOscillator();
    scream.type = 'sawtooth';
    env(scream.frequency, t + 0.15, [[0, 240], [0.5, 690], [1.1, 180]]);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.6;
    const gScr = ctx.createGain();
    env(gScr.gain, t + 0.15, [[0, 0.001], [0.1, 0.4 * intensity], [1.2, 0.001]]);
    scream.connect(bp).connect(gScr);
    out(gScr, pos);
    scream.start(t + 0.15);
    scream.stop(t + 1.5);
    // hiss bed
    const n = noiseSource();
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 3200;
    const gH = ctx.createGain();
    env(gH.gain, t, [[0, 0.001], [0.3, 0.14 * intensity], [1.6, 0.001]]);
    n.connect(hp2).connect(gH);
    out(gH, pos);
    n.start(t);
    n.stop(t + 1.7);
    return;
  }
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

// The bloomcaller's summon pulse: a rising wail that breaks into a boom.
export function sfxBloomPulse(pos) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  env(osc.frequency, t, [[0, 300], [0.5, 980]]);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1600;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.001], [0.4, 0.34], [0.55, 0.001]]);
  osc.connect(lp).connect(g);
  out(g, pos);
  osc.start(t);
  osc.stop(t + 0.6);
  // the answering boom
  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  env(osc2.frequency, t + 0.5, [[0, 90], [0.4, 34]]);
  const g2 = ctx.createGain();
  env(g2.gain, t + 0.5, [[0, 0.001], [0.03, 0.5], [0.5, 0.001]]);
  osc2.connect(g2);
  out(g2, pos);
  osc2.start(t + 0.5);
  osc2.stop(t + 1.05);
}

// Grenade: pin-flick throw whoosh.
export function sfxThrow() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  env(bp.frequency, t, [[0, 400], [0.18, 1200]]);
  bp.Q.value = 1.8;
  const g = ctx.createGain();
  env(g.gain, t, [[0, 0.18], [0.2, 0.001]]);
  n.connect(bp).connect(g);
  out(g);
  n.start(t);
  n.stop(t + 0.22);
}

// Grenade detonation: sub thump + crack + long rumble tail, positional.
export function sfxExplosion(pos) {
  if (!ctx) return;
  const t = ctx.currentTime;
  // sub thump
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  env(osc.frequency, t, [[0, 110], [0.25, 26]]);
  const g1 = ctx.createGain();
  env(g1.gain, t, [[0, 1.0], [0.3, 0.001]]);
  osc.connect(g1);
  out(g1, pos);
  osc.start(t);
  osc.stop(t + 0.32);
  // crack
  const n1 = noiseSource();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 700;
  const g2 = ctx.createGain();
  env(g2.gain, t, [[0, 0.9], [0.07, 0.001]]);
  n1.connect(hp).connect(g2);
  out(g2, pos);
  n1.start(t);
  n1.stop(t + 0.1);
  // rumble tail
  const n2 = noiseSource();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  env(lp.frequency, t, [[0, 900], [0.9, 90]]);
  const g3 = ctx.createGain();
  env(g3.gain, t, [[0, 0.6], [1.0, 0.001]]);
  n2.connect(lp).connect(g3);
  out(g3, pos);
  n2.start(t);
  n2.stop(t + 1.05);
}

// Machete: a fast air-cut (miss) or wet chop (hit).
export function sfxMelee(hit) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const n = noiseSource();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  env(bp.frequency, t, [[0, hit ? 900 : 2400], [0.09, hit ? 300 : 3400]]);
  bp.Q.value = hit ? 1.2 : 3;
  const g = ctx.createGain();
  env(g.gain, t, [[0, hit ? 0.5 : 0.22], [hit ? 0.12 : 0.08, 0.001]]);
  n.connect(bp).connect(g);
  out(g);
  n.start(t);
  n.stop(t + 0.14);
}

// Razorfin bite: quick frantic ripples + a snap. The water is angry.
export function sfxRazorfin() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.05;
    const n = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 900;
    bp.Q.value = 3;
    const g = ctx.createGain();
    env(g.gain, tt, [[0, 0.22], [0.05, 0.001]]);
    n.connect(bp).connect(g);
    out(g);
    n.start(tt);
    n.stop(tt + 0.07);
  }
}

// Ayahuasca: a shimmering upward gliss - the vine opens your eyes.
export function sfxAyahuasca() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 5; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 300 * Math.pow(1.335, i);
    env(osc.frequency, t + i * 0.09, [[0, f0], [0.5, f0 * 1.5]]);
    const g = ctx.createGain();
    env(g.gain, t + i * 0.09, [[0, 0.001], [0.05, 0.12], [0.55, 0.001]]);
    osc.connect(g);
    out(g);
    osc.start(t + i * 0.09);
    osc.stop(t + i * 0.09 + 0.6);
  }
}

// Thunder: a crack, a sub-bass body, and a long rolling tail. Loudness ~
// distance (far strikes just rumble).
export function sfxThunder(loud = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (loud > 0.55) {
    const n1 = noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g1 = ctx.createGain();
    env(g1.gain, t, [[0, 0.5 * loud], [0.09, 0.001]]);
    n1.connect(hp).connect(g1);
    out(g1);
    n1.start(t);
    n1.stop(t + 0.12);
  }
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  env(osc.frequency, t, [[0, 64], [1.3, 26]]);
  const g2 = ctx.createGain();
  env(g2.gain, t, [[0, 0.001], [0.05, 0.6 * loud], [1.5, 0.001]]);
  osc.connect(g2);
  out(g2);
  osc.start(t);
  osc.stop(t + 1.6);
  const n2 = noiseSource();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  env(lp.frequency, t, [[0, 520], [2.6, 70]]);
  const g3 = ctx.createGain();
  env(g3.gain, t, [[0, 0.001], [0.12, 0.45 * loud], [2.8, 0.001]]);
  n2.connect(lp).connect(g3);
  out(g3);
  n2.start(t);
  n2.stop(t + 2.9);
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

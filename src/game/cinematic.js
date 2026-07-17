// THE TRAILER (round 5B) - a replayable in-game cinematic: ~60 seconds of
// composed shots played back deterministically from a single time parameter.
//
// Split like every other system in this repo: this file owns the pure,
// unit-testable COMPOSITION (the shot table, the timeline math, the camera
// evaluator) and a createCinematic() runtime that drives the live scene
// (mood cuts, the flood clock, posed creatures, viewmodel, letterbox,
// title card) from seek(t).
//
// API (wired onto window.__deadfall.cinematic in main.js):
//   cinematic.seek(t)        - position camera + world at absolute time t and render
//   cinematic.play()         - real-time playback (foreground window)
//   cinematic.record()       - recorder.start() + play() + recorder.stop() at the end
//   cinematic.stop()         - restore normal presentation
//   cinematic.duration       - total timeline length in seconds
//   cinematic.SHOTS          - the shot table (names, durations, beats)
//
// Determinism: the camera is keyframed; wind/dapple/water are pure
// functions of t; the flood is recomputed by stepping flood.update() with
// a fixed dt from trigger to the shot's flood clock; creatures are posed
// analytically (position/heading/walk-phase as functions of shot-local
// time), never stepped through the unseeded AI. Transient weapon-fire
// effects are play-time garnish cued on the timeline (fireCue), not part
// of the deterministic seek.

import * as THREE from 'three';
import { terrainHeight, WORLD } from '../world/heightmap.js';
import { ROOSTS } from '../world/roosts.js';

// ---------------------------------------------------------------------------
// Authoring helpers (module-load time, deterministic from the world seed)
// ---------------------------------------------------------------------------

// ground y at (x, z) plus an offset - keyframes author in "metres above
// the terrain" so a heightmap tweak cannot bury a shot underground.
function gy(x, z, dy = 0) {
  return terrainHeight(x, z) + dy;
}

// water surface (base level - flood rise is applied live at seek time)
const WATER_Y = WORLD.waterLevel;

// The crown perch used for the flood-peak shot: the roost crown nearest
// the gorge heart on the east bank. ROOSTS is computed deterministically
// from the world seed, so this is stable run to run.
function pickFloodPerch() {
  let best = null;
  let bestD = Infinity;
  for (const r of ROOSTS) {
    const d = Math.hypot(r.top.x - 40, r.top.z + 60);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best ? best.top : { x: 40, y: gy(40, -60, 8), z: -60 };
}
const PERCH = pickFloodPerch();

// ---------------------------------------------------------------------------
// THE SHOT TABLE - the trailer. Every number here is a creative decision.
// ---------------------------------------------------------------------------
// Shot fields:
//   name, dur (s), mood (MOODS key), fov (deg, default 74)
//   cam: { keys: [{ u, pos:[x,y,z], look:[x,y,z] }] }  u in [0,1] shot-local
//     OR orbit: { cx, cz, r, h, a0, a1, lookY } - parametric arc around a point
//   flood: { base, rate }  - flood clock (s since trigger) = base + local*rate
//   cast: [{ type, x, z, heading, speed, walkRate, scale }] - posed creatures
//   pov: true - show the first-person weapon rig
//   cues: [{ t, at:[x,y,z] }] - play-time weapon fire (tracer + impact)
//   title: { text, sub, tIn, tHold, tOut } - in-canvas title card

export const SHOTS = [
  {
    // Cold open: the whole valley in golden-hour light, long warm shadows,
    // slow descending push off the eastern ridge. Scale first.
    name: 'VALLEY REVEAL',
    dur: 6.0,
    mood: 'gold',
    fov: 74,
    cam: {
      keys: [
        { u: 0, pos: [155, gy(155, 55, 26), 55], look: [40, gy(40, -140, 6), -140] },
        { u: 1, pos: [140, gy(140, 30, 13), 30], look: [30, gy(30, -180, 6), -180] },
      ],
    },
  },
  {
    // The lit deep: violet fever in the wet western understory, sunspire
    // fungi burning through the dark. Low, slow, close to the ground.
    name: 'SUNSPIRE HOLLOW',
    dur: 5.5,
    mood: 'violet',
    fov: 66,
    cam: {
      keys: [
        { u: 0, pos: [-126, gy(-126, 94, 1.3), 94], look: [-100, gy(-100, 62, 1.2), 62] },
        { u: 1, pos: [-114, gy(-114, 82, 1.6), 82], look: [-96, gy(-96, 58, 1.5), 58] },
      ],
    },
  },
  {
    // Lantern medusae drifting over the river lowlands - the camera rises
    // out of the reeds and up through the shoal.
    name: 'LANTERN SHOALS',
    dur: 5.5,
    mood: 'violet',
    fov: 70,
    cam: {
      keys: [
        { u: 0, pos: [-4, WATER_Y + 1.4, 4], look: [24, WATER_Y + 7, -46] },
        { u: 1, pos: [2, WATER_Y + 7.5, -6], look: [30, WATER_Y + 6, -60] },
      ],
    },
  },
  {
    // The reshaped prowler, telephoto, low angle, stalking through open
    // gold light. The camera arcs around it as it moves.
    name: 'THE PROWLER',
    dur: 5.5,
    mood: 'gold',
    fov: 52,
    orbit: { cx: 30, cz: 120, r: 7.5, h: 1.0, a0: 2.4, a1: 3.6, lookY: 1.0 },
    cast: [
      { type: 'prowler', x: 30, z: 120, heading: 2.8, speed: 0, walkRate: 7.5, scale: 1.05 },
    ],
  },
  {
    // First person: the rebuilt carbine up, a juggernaut and two prowlers
    // coming straight down the lane. Fire cues land on the walk beats.
    name: 'CONTACT',
    dur: 5.5,
    mood: 'gold',
    fov: 70,
    pov: true,
    cam: {
      keys: [
        { u: 0, pos: [0, gy(0, 60, 1.66), 60], look: [0, gy(0, 38, 1.4), 38] },
        { u: 1, pos: [0, gy(0, 53, 1.66), 53], look: [0, gy(0, 38, 1.4), 38] },
      ],
    },
    cast: [
      { type: 'juggernaut', x: 0, z: 38, heading: Math.PI, speed: 1.6, walkRate: 6.0 },
      { type: 'prowler', x: -7, z: 44, heading: Math.PI + 0.25, speed: 2.6, walkRate: 9.0 },
      { type: 'prowler', x: 8, z: 46, heading: Math.PI - 0.22, speed: 2.4, walkRate: 9.0 },
    ],
    cues: [
      { t: 1.3, castIdx: 0 },
      { t: 2.5, castIdx: 1 },
      { t: 3.7, castIdx: 0 },
    ],
  },
  {
    // THE FLOOD, movement 1 - the telegraph. From the gorge lip the red
    // tint sweeps down the channel. Thunder on the cut (flood.trigger
    // announces itself). Slow push toward the drop.
    name: 'THE SWELLING',
    dur: 5.0,
    mood: 'gold',
    fov: 74,
    flood: { base: 2.0, rate: 1.8 },
    cam: {
      keys: [
        { u: 0, pos: [14, gy(14, -48, 2.2), -48], look: [14, gy(14, -180, -2), -180] },
        { u: 1, pos: [14, gy(14, -58, 1.8), -58], look: [14, gy(14, -180, -4), -180] },
      ],
    },
  },
  {
    // THE FLOOD, movement 2 - the surge swallowing the banks, watched from
    // the ridge shoulder. Flood clock runs at 2x so seven screen-seconds
    // carry fourteen seconds of climb.
    name: 'THE SURGE',
    dur: 7.0,
    mood: 'gold',
    fov: 74,
    flood: { base: 13.0, rate: 2.0 },
    cam: {
      keys: [
        { u: 0, pos: [105, gy(105, -30, 4.5), -30], look: [30, WATER_Y + 4, -70] },
        { u: 1, pos: [98, gy(98, -34, 5.5), -34], look: [-10, WATER_Y + 7, -75] },
      ],
    },
  },
  {
    // THE FLOOD, movement 3 - full peak from a crown perch: a sun-glinted
    // blood-red sheet to the horizon, drowned canopy breaking the surface.
    // The camera lifts off the perch and keeps rising.
    name: 'DROWNED WORLD',
    dur: 6.0,
    mood: 'gold',
    fov: 74,
    flood: { base: 40.0, rate: 1.0 },
    cam: {
      keys: [
        { u: 0, pos: [PERCH.x, PERCH.y + 1.6, PERCH.z], look: [-180, WATER_Y + 9, -80] },
        { u: 1, pos: [PERCH.x + 4, PERCH.y + 7.0, PERCH.z + 4], look: [-200, WATER_Y + 9, -70] },
      ],
    },
  },
  {
    // Cinder Fang: the lone spike in violet fever, hot light shafts,
    // slow drift along its flank.
    name: 'CINDER FANG',
    dur: 4.5,
    mood: 'violet',
    fov: 62,
    cam: {
      keys: [
        { u: 0, pos: [168, gy(168, -118, 9), -118], look: [196, gy(196, -96, 30), -96] },
        { u: 1, pos: [176, gy(176, -128, 12), -128], look: [196, gy(196, -96, 26), -96] },
      ],
    },
  },
  {
    // The Sunken Maw: descend over the rim into the crimson boss basin.
    name: 'THE MAW',
    dur: 6.0,
    mood: 'violet',
    fov: 70,
    cam: {
      keys: [
        { u: 0, pos: [40, gy(40, -266, 9), -266], look: [60, WATER_Y + 1, -320] },
        { u: 1, pos: [50, gy(50, -282, 4), -282], look: [62, WATER_Y + 1, -322] },
      ],
    },
  },
  {
    // Last light: rising away from Extraction Mesa, the destination
    // standing against the fog. The way out.
    name: 'EXTRACTION',
    dur: 5.0,
    mood: 'gold',
    fov: 74,
    cam: {
      keys: [
        { u: 0, pos: [86, gy(86, -290, 3), -290], look: [86, gy(86, -340, 14), -340] },
        { u: 1, pos: [78, gy(78, -274, 20), -274], look: [86, gy(86, -340, 12), -340] },
      ],
    },
  },
  {
    // Title card over a slow high drift down the valley spine.
    name: 'TITLE',
    dur: 5.5,
    mood: 'gold',
    fov: 74,
    cam: {
      keys: [
        { u: 0, pos: [0, gy(0, -70, 38), -70], look: [10, gy(10, -220, 10), -220] },
        { u: 1, pos: [-4, gy(-4, -84, 42), -84], look: [10, gy(10, -220, 10), -220] },
      ],
    },
    title: {
      text: 'DEADFALL',
      sub: 'THE JUNGLE KEEPS WHAT IT KILLS',
      tIn: 1.0, tHold: 3.2, tOut: 5.2,
    },
  },
];

// ---------------------------------------------------------------------------
// Pure timeline math (unit-tested)
// ---------------------------------------------------------------------------

export function totalDuration(shots = SHOTS) {
  return shots.reduce((acc, s) => acc + s.dur, 0);
}

// Map absolute time t to { index, shot, local } (local = seconds into shot).
// t is clamped to the timeline.
export function shotAt(t, shots = SHOTS) {
  let acc = 0;
  for (let i = 0; i < shots.length; i++) {
    if (t < acc + shots[i].dur || i === shots.length - 1) {
      return { index: i, shot: shots[i], local: Math.min(Math.max(0, t - acc), shots[i].dur) };
    }
    acc += shots[i].dur;
  }
  return { index: 0, shot: shots[0], local: 0 };
}

function smooth(u) {
  u = Math.min(1, Math.max(0, u));
  return u * u * (3 - 2 * u);
}

function lerp3(a, b, k, out) {
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
}

// Evaluate a shot's camera at u01 in [0,1]. Returns { pos:[3], look:[3] }.
export function evalCam(shot, u01) {
  u01 = Math.min(1, Math.max(0, u01));
  if (shot.orbit) {
    const o = shot.orbit;
    const a = o.a0 + (o.a1 - o.a0) * smooth(u01);
    const cy = terrainHeight(o.cx, o.cz);
    const px = o.cx + Math.sin(a) * o.r;
    const pz = o.cz + Math.cos(a) * o.r;
    // camera height rides the terrain under the CAMERA (the subject's
    // ground and the arc's ground can differ by metres on a slope)
    const pos = [px, Math.max(cy, terrainHeight(px, pz)) + o.h, pz];
    const look = [o.cx, cy + (o.lookY !== undefined ? o.lookY : 1), o.cz];
    return { pos, look };
  }
  const keys = shot.cam.keys;
  if (keys.length === 1) {
    return { pos: keys[0].pos.slice(), look: keys[0].look.slice() };
  }
  let k0 = keys[0];
  let k1 = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (u01 >= keys[i].u && u01 <= keys[i + 1].u) {
      k0 = keys[i];
      k1 = keys[i + 1];
      break;
    }
  }
  const span = Math.max(1e-6, k1.u - k0.u);
  const e = smooth((u01 - k0.u) / span);
  return {
    pos: lerp3(k0.pos, k1.pos, e, [0, 0, 0]),
    look: lerp3(k0.look, k1.look, e, [0, 0, 0]),
  };
}

// Analytic creature pose for a cast member at shot-local time.
// Returns { x, y, z, heading, phase } - the runtime applies it to the model.
export function evalCast(c, local) {
  const dist = (c.speed || 0) * local;
  const x = c.x + Math.sin(c.heading) * dist;
  const z = c.z + Math.cos(c.heading) * dist;
  return {
    x, z,
    y: terrainHeight(x, z),
    heading: c.heading,
    phase: (c.walkRate || 0) * local + (c.phase0 || 0),
  };
}

// ---------------------------------------------------------------------------
// Runtime - drives the live scene. Browser only.
// ---------------------------------------------------------------------------

const IDLE_INTENT = {
  moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0,
  sprint: false, jump: false, reload: false,
};

export function createCinematic(deps) {
  const {
    camera, renderer, scene, setMood, flood, water, enemyMgr,
    viewmodel, effects, recorder, tickWind, tickDapple, trackShadow, sun,
  } = deps;

  let active = false;
  let playing = false;
  let curShot = -1;
  let floodClock = -1; // seconds of flood sim applied since trigger, -1 = idle
  let activeCast = []; // [{ e, c }]
  let savedFov = camera.fov;
  let overlay = null;  // { group, barTop, barBot, titleMesh, titleMat }
  const _v = new THREE.Vector3();

  // --- letterbox + in-canvas title card (must live in the CANVAS: the
  // recorder captures canvas pixels only, DOM overlays would be lost) ---
  function buildOverlay() {
    const group = new THREE.Group();
    const barMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, fog: false });
    const barGeo = new THREE.PlaneGeometry(1, 1);
    const barTop = new THREE.Mesh(barGeo, barMat);
    const barBot = new THREE.Mesh(barGeo, barMat);
    barTop.renderOrder = 9998;
    barBot.renderOrder = 9998;
    group.add(barTop, barBot);

    // title texture drawn once
    const cvs = document.createElement('canvas');
    cvs.width = 1024;
    cvs.height = 400;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, 1024, 400);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2ead8';
    ctx.font = '900 130px Arial, sans-serif';
    try { ctx.letterSpacing = '26px'; } catch { /* older canvas */ }
    ctx.fillText('DEADFALL', 512 + 13, 190);
    ctx.font = '400 34px Arial, sans-serif';
    try { ctx.letterSpacing = '10px'; } catch { /* older canvas */ }
    ctx.fillStyle = '#d8c8a8';
    ctx.fillText('THE JUNGLE KEEPS WHAT IT KILLS', 512 + 5, 285);
    const tex = new THREE.CanvasTexture(cvs);
    const titleMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthTest: false, fog: false,
    });
    const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 400 / 1024), titleMat);
    titleMesh.renderOrder = 9999;
    group.add(titleMesh);

    camera.add(group);
    return { group, barTop, barBot, titleMesh, titleMat };
  }

  function updateOverlay(shot, local) {
    if (!overlay) overlay = buildOverlay();
    const fov = shot.fov || 74;
    const d = 1; // overlay plane distance
    const viewH = 2 * Math.tan((fov * Math.PI) / 360) * d;
    const viewW = viewH * camera.aspect;
    const barH = viewH * 0.105;
    for (const [bar, sign] of [[overlay.barTop, 1], [overlay.barBot, -1]]) {
      bar.scale.set(viewW * 1.1, barH, 1);
      bar.position.set(0, sign * (viewH / 2 - barH / 2), -d);
    }
    // title fade
    let op = 0;
    if (shot.title) {
      const tt = shot.title;
      if (local >= tt.tIn) {
        op = smooth((local - tt.tIn) / 0.9);
        if (local > tt.tHold) op *= 1 - smooth((local - tt.tHold) / Math.max(0.2, tt.tOut - tt.tHold));
      }
      overlay.titleMesh.scale.setScalar(viewW * 0.62);
      overlay.titleMesh.position.set(0, 0, -d);
    }
    overlay.titleMat.opacity = op;
    overlay.group.visible = true;
  }

  // --- deterministic flood clock ---
  const FLOOD_DT = 1 / 30;
  function setFloodTime(ft) {
    if (ft === null || ft < 0) {
      if (floodClock !== -1) {
        flood.reset();
        floodClock = -1;
      }
      return;
    }
    if (floodClock < 0 || ft < floodClock) {
      flood.reset();
      flood.trigger();
      floodClock = 0;
    }
    while (floodClock + FLOOD_DT <= ft) {
      flood.update(FLOOD_DT, [], 1e4);
      floodClock += FLOOD_DT;
    }
  }

  // --- cast management ---
  function clearCast() {
    for (const m of activeCast) {
      m.e.model.group.visible = false;
      m.e.dead = true;
      m.e.state = 'hunt';
    }
    activeCast = [];
  }

  function setCast(shot) {
    clearCast();
    for (const c of shot.cast || []) {
      const e = enemyMgr.spawn(c.type, c.x, c.z);
      if (!e) continue;
      activeCast.push({ e, c });
    }
  }

  function poseCast(local) {
    for (const { e, c } of activeCast) {
      const p = evalCast(c, local);
      const g = e.model.group;
      g.visible = true;
      g.position.set(p.x, p.y, p.z);
      // +PI: models face -Z, heading moves along +Z (same fix as enemies.js)
      g.rotation.set(0, p.heading + Math.PI, 0);
      g.scale.setScalar(c.scale || 1);
      const refs = e.model.refs;
      if (!refs) continue;
      const swing = Math.sin(p.phase);
      if (refs.legs) {
        refs.legs.forEach((leg, i) => {
          leg.rotation.x = swing * 0.55 * (i % 2 === 0 ? 1 : -1);
        });
      }
      if (refs.knees) {
        refs.knees.forEach((knee, i) => {
          const s = swing * (i % 2 === 0 ? 1 : -1);
          knee.rotation.x = 0.35 + Math.max(0, -s) * 0.7;
        });
      }
      const bob = Math.abs(swing) * 0.05;
      if (e.type === 'prowler' && refs.body) refs.body.position.y = 0.62 + bob;
      if (e.type === 'juggernaut' && refs.torso) refs.torso.position.y = 1.55 + bob * 1.6;
    }
  }

  // --- play-time weapon-fire garnish (not part of deterministic seek) ---
  function fireCue(shotIdx, cueIdx) {
    const shot = SHOTS[shotIdx];
    const cue = shot.cues && shot.cues[cueIdx];
    if (!cue) return;
    const from = viewmodel.muzzleWorld(_v).clone();
    let to;
    if (cue.castIdx !== undefined && activeCast[cue.castIdx]) {
      const g = activeCast[cue.castIdx].e.model.group;
      to = g.position.clone();
      to.y += 1.2;
    } else if (cue.at) {
      to = new THREE.Vector3(cue.at[0], cue.at[1], cue.at[2]);
    } else {
      to = from.clone().add(camera.getWorldDirection(_v).multiplyScalar(40));
    }
    effects.spawnTracer(from, to);
    effects.burst(to, 'flesh', 9, 4);
  }

  // --- enter/exit cinematic presentation ---
  function domEl(id) { return document.getElementById(id); }

  function enter() {
    if (active) return;
    active = true;
    savedFov = camera.fov;
    for (const id of ['hud', 'menu', 'endscreen']) {
      const el = domEl(id);
      if (el) el.classList.add('hidden');
    }
    viewmodel.rig.visible = false;
    curShot = -1;
  }

  function stop() {
    playing = false;
    if (!active) return;
    active = false;
    clearCast();
    setFloodTime(-1);
    if (water.userData.setFlood) water.userData.setFlood(0, 0, 0);
    if (overlay) overlay.group.visible = false;
    viewmodel.rig.visible = true;
    camera.fov = savedFov;
    camera.updateProjectionMatrix();
    const menu = domEl('menu');
    if (menu) menu.classList.remove('hidden');
    curShot = -1;
  }

  function applyShot(index, shot) {
    curShot = index;
    setMood(shot.mood);
    camera.fov = shot.fov || 74;
    camera.updateProjectionMatrix();
    setCast(shot);
    viewmodel.rig.visible = !!shot.pov;
  }

  // --- the core: position everything at absolute time t ---
  function seek(t, opts = {}) {
    const { render = true } = opts;
    enter();
    const { index, shot, local } = shotAt(t);
    if (index !== curShot) applyShot(index, shot);

    // camera
    const cam = evalCam(shot, local / shot.dur);
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);

    // flood clock (deterministic recompute; forward stepping is cached)
    setFloodTime(shot.flood ? shot.flood.base + local * (shot.flood.rate || 1) : -1);
    if (water.userData.setFlood) {
      const fs = flood.state;
      water.userData.setFlood(fs.rise, fs.tintFront, fs.tintIntensity);
    }

    // world clocks - pure functions of timeline time
    if (water.userData.tick) water.userData.tick(t);
    if (tickWind) tickWind(t);
    if (tickDapple) tickDapple(t);
    if (trackShadow && sun) trackShadow(sun, camera.position);

    poseCast(local);
    if (shot.pov) viewmodel.update(IDLE_INTENT, 1 / 60);

    updateOverlay(shot, local);
    if (render) renderer.render(scene, camera);
    return { index, name: shot.name, local };
  }

  // --- real-time playback (foreground window; rAF-driven) ---
  function play(opts = {}) {
    const { from = 0, onDone = null } = opts;
    enter();
    playing = true;
    let t = from;
    let prev = performance.now();
    let lastT = from;
    const dur = totalDuration();
    function frame(now) {
      if (!playing) return;
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      t += dt;
      if (t >= dur) {
        playing = false;
        stop();
        if (onDone) onDone();
        return;
      }
      seek(t, { render: false }); // main loop renders every rAF
      // fire any cues crossed this frame (shot-local times)
      const cur = shotAt(t);
      const prevPos = shotAt(lastT);
      if (cur.shot.cues) {
        for (let i = 0; i < cur.shot.cues.length; i++) {
          const ct = cur.shot.cues[i].t;
          const crossed = (prevPos.index !== cur.index && ct <= cur.local)
            || (prevPos.index === cur.index && ct > prevPos.local && ct <= cur.local);
          if (crossed) fireCue(cur.index, i);
        }
      }
      effects.update(dt, camera); // tracers/bursts live only in play mode
      lastT = t;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // --- one-call record: start recorder, play, stop + download at the end ---
  function record(opts = {}) {
    if (!recorder) {
      console.error('[cinematic] no recorder wired');
      return false;
    }
    const ok = recorder.start(opts);
    if (!ok) return false;
    play({
      onDone: () => {
        recorder.stop().then((blob) => {
          console.log('[cinematic] trailer recorded -', blob ? blob.size + ' bytes' : 'no blob');
        });
      },
    });
    return true;
  }

  return {
    SHOTS,
    get duration() { return totalDuration(); },
    get playing() { return playing; },
    seek,
    play,
    record,
    stop,
    fireCue,
    shotAt: (t) => shotAt(t),
  };
}

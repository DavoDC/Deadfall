// Creature viewer - a turntable/portrait rig for grading enemy models.
//
// The round-5 creature pass could not frame an enemy properly with the debug
// camera, so it could not grade its own work. This module closes that hole:
// spawn ONE creature, park the camera at a good framing distance, orbit it,
// and capture portraits straight to disk (via the telemetry frame endpoint -
// files land in gitignored captures/telemetry/frames/<tag>/<label>.jpg, no
// browser downloads involved).
//
// Usage (browser console):
//   const v = window.__deadfall.viewer;
//   v.show('prowler');            // freeze world, spawn one, frame it
//   v.orbit(120);                 // move camera to another angle (degrees)
//   await v.capture('prowler-a30');   // save current frame to disk
//   v.hide();                     // clean up, unfreeze
//   await v.portrait('prowler', 'before');  // show + capture 3 angles + hide
//   await v.sheet('before-sheet');          // contact-sheet all captures so far
//
// rAF-independent: capture() renders the frame itself (same pattern as
// legibility.js), so it works in background/throttled automation tabs.

import { freezeForCapture } from './shots.js';

// Open insertion-beach plain (shots.js vantage 1) - portraits need a clear
// sightline, not the legibility probe's dense understory (foliage occludes).
const VIEW_POS = { x: -10, z: 215 };
const CAPTURE_WIDTH = 640;
const SHEET_TILE_WIDTH = 480;

export function makeViewer({
  renderer, scene, camera, game, enemyMgr, drizzle, effects, motes, renderFrame, sim,
}) {
  let active = null; // { e, cleanup }
  const captures = new Map(); // label -> dataURL (for contact sheets)

  // Rough world-space bounding info for framing, from the model contract.
  function frameInfo(e) {
    const m = e.model;
    const s = e.baseScale || 1;
    const g = m.group;
    // creature vertical span in local units
    const top = Math.max(m.headOffset.y + m.headR, m.bodyOffset.y + m.bodyR);
    const size = Math.max(top, m.bodyR * 2.2);
    const center = g.position.clone();
    center.y += ((m.headOffset.y + m.bodyOffset.y) / 2) * s;
    return { center, size: size * s };
  }

  function orbit(angleDeg = 30, elevDeg = 8, distMult = 1) {
    if (!active) { console.warn('[viewer] nothing shown'); return; }
    const { center, size } = frameInfo(active.e);
    const dist = Math.max(1.1, size * 1.65) * distMult;
    const a = (angleDeg * Math.PI) / 180;
    const el = (elevDeg * Math.PI) / 180;
    // models face -Z; angle 0 = camera in FRONT of the face, orbiting CCW
    camera.position.set(
      center.x + Math.sin(a) * dist * Math.cos(el),
      center.y + Math.sin(el) * dist,
      center.z - Math.cos(a) * dist * Math.cos(el)
    );
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  function show(type, opts = {}) {
    if (active) hide();
    if (game.state !== 'RUNNING' && sim) sim.resetRun();
    const cleanup = freezeForCapture(game, drizzle, effects, motes, camera);
    const e = enemyMgr.spawn(type, VIEW_POS.x, VIEW_POS.z);
    // deterministic pose: face -Z (the camera default), not a random heading
    if (type !== 'miremother') {
      e.model.group.rotation.set(0, 0, 0);
      e.model.group.scale.setScalar(1); // portrait at authored scale
      e.baseScale = 1;
      // turntable lift: raise the model well above the terrain so grass,
      // slope, and shoreline never occlude the silhouette - portraits read
      // against sky/fog, the classic neutral backdrop
      e.model.group.position.y += 7;
    } else {
      // the boss writes world positions per-frame from its chain; the sim is
      // frozen, so pose the chain by hand: head high, body trailing away
      const refs = e.model.refs;
      const y = e.model.group.position.y;
      refs.head.position.set(VIEW_POS.x, 3.2, VIEW_POS.z - 2);
      refs.head.lookAt(VIEW_POS.x, 2.6, VIEW_POS.z - 8);
      for (let i = 0; i < refs.segments.length; i++) {
        const t = i / (refs.segments.length - 1);
        refs.segments[i].position.set(
          VIEW_POS.x + Math.sin(t * 2.2) * 3.5,
          Math.max(0.6, 3.0 - i * 0.35),
          VIEW_POS.z - 1 + i * 1.6
        );
      }
    }
    active = { e, cleanup, type };
    if (type === 'miremother') {
      // frame on the posed head, not the origin-anchored group
      camera.position.set(VIEW_POS.x + 4.5, 3.4, VIEW_POS.z - 6.5);
      camera.lookAt(VIEW_POS.x, 2.6, VIEW_POS.z - 1);
      camera.updateProjectionMatrix();
    } else {
      orbit(opts.angleDeg ?? 30, opts.elevDeg ?? 8, opts.distMult ?? 1);
    }
    return active;
  }

  function hide() {
    if (!active) return;
    active.e.dead = true;
    active.e.model.group.visible = false;
    active.cleanup();
    if (enemyMgr.reset) enemyMgr.reset();
    active = null;
  }

  // Render now (rAF-independent), downscale, return a jpeg dataURL.
  function grab(targetWidth = CAPTURE_WIDTH) {
    renderFrame();
    const src = renderer.domElement;
    const scale = targetWidth / src.width;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(src.height * scale));
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  async function save(tag, label, dataURL) {
    await fetch('/telemetry/frame', {
      method: 'POST',
      body: JSON.stringify({ startedAt: tag, t: label, dataURL }),
    });
    return `captures/telemetry/frames/${tag}/${label}.jpg`;
  }

  async function capture(label, tag = 'creatures') {
    const dataURL = grab();
    captures.set(label, dataURL);
    const path = await save(tag, label, dataURL);
    console.log(`[viewer] saved ${path}`);
    return path;
  }

  // Full portrait set for one archetype: front-3q, side, back-3q.
  async function portrait(type, suffix, angles = [30, 90, 150]) {
    const paths = [];
    show(type);
    for (const a of angles) {
      if (type !== 'miremother') orbit(a);
      paths.push(await capture(`${type}-${suffix}-a${a}`));
      if (type === 'miremother') break; // single posed shot for the boss
    }
    hide();
    return paths;
  }

  // Composite every capture taken so far (insertion order) into one labelled
  // contact sheet and save it.
  async function sheet(label, cols = 3, tag = 'creatures') {
    const entries = [...captures.entries()];
    if (entries.length === 0) { console.warn('[viewer] no captures to sheet'); return null; }
    const imgs = await Promise.all(entries.map(([, url]) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    })));
    const tileW = SHEET_TILE_WIDTH;
    const tileH = Math.round(tileW * (imgs[0].height / imgs[0].width));
    const rows = Math.ceil(imgs.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = tileW * cols;
    canvas.height = tileH * rows;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    imgs.forEach((img, i) => {
      const x = (i % cols) * tileW;
      const y = Math.floor(i / cols) * tileH;
      ctx.drawImage(img, x, y, tileW, tileH);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y + tileH - 22, tileW, 22);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      ctx.fillText(entries[i][0], x + 6, y + tileH - 6);
    });
    const dataURL = canvas.toDataURL('image/jpeg', 0.85);
    const path = await save(tag, label, dataURL);
    console.log(`[viewer] sheet saved ${path}`);
    return path;
  }

  function clearCaptures() { captures.clear(); }

  return { show, hide, orbit, capture, portrait, sheet, clearCaptures, captures };
}

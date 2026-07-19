// Enemy-legibility metric - objective difference-imaging check that a threat
// stays readable against the (increasingly dark/dappled) foliage.
//
// The screenshot rig (shots.js) and its colour metrics (computeStats) only
// ever grade EMPTY scenery - no enemy is in frame. That leaves a hole: art
// direction could darken the jungle, pass every existing check, and still
// make an enemy invisible against it. This module closes that hole with a
// number instead of a human glance:
//
//   1. Freeze the scene (reusing shots.js's freezeForCapture/placeCamera).
//   2. Capture a BACKGROUND frame at a fixed dark, vegetated vantage.
//   3. Spawn ONE enemy of a given archetype at the aim point, capture an
//      ENEMY frame from the same fixed camera.
//   4. Diff the two frames -> a pixel mask of "this changed because the
//      enemy is standing there" (maskFromDiff).
//   5. Score = luminance+colour distance between the enemy-mask pixels and
//      a dilated ring of surrounding background pixels (contrastScore).
//      Higher = more legible. Also reports the mask pixel count (too few =
//      barely visible / too far from camera).
//
// Usage (browser console):
//   window.__deadfall.checkLegibility()
//   window.__deadfall.checkLegibility({ archetypes: ['prowler', 'spitter'] })

import { freezeForCapture, placeCamera } from './shots.js';
import { ENEMY_DEFS } from '../enemies/enemies.js';
import { terrainHeight } from '../world/heightmap.js';

// Director-spawned archetypes only - miremother (boss) and viperblossom
// (dormant, seed-placed mimic) are placed specially, not director-spawned,
// so they are skipped here per the brief.
const ARCHETYPES = ['prowler', 'spitter', 'juggernaut', 'stingerwing', 'shrike', 'bloomcaller'];

// Reuses the camera position of shots.js's "JUNGLE CANOPY (dense west)"
// vantage - the flattest, most solid-colour dark-understory interior in the
// screenshot rig - but aims at a fixed point ~13m ahead (within the
// 12-15m range asked for) instead of the far-off establishing lookAt, since
// that is also where the enemy under test is spawned.
const LEGIBILITY_VANTAGE = {
  name: 'JUNGLE CANOPY (dense west) - legibility probe',
  pos: { x: -110, z: 80 },
  lookAt: { x: -100, z: 72 }, // ~12.8m ahead - also the enemy spawn point
};

const DIFF_THRESHOLD = 24; // sum(|dR|+|dG|+|dB|) above this = "changed"
const RING_RADIUS_PX = 6;  // dilation radius for the surrounding background ring
const CAPTURE_WIDTH = 320; // downscaled for speed, matches shots.js's analyzeOneShot

// ---------------------------------------------------------------------
// Pure pixel math - no canvas/renderer dependency, unit-testable under
// vitest's node environment (mirrors shots.js's computeStats pattern).
// ---------------------------------------------------------------------

// Returns a Uint8Array (1 = changed, 0 = unchanged), one entry per pixel.
export function maskFromDiff(bgRGBA, enemyRGBA, width, height, threshold = DIFF_THRESHOLD) {
  const count = width * height;
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const dr = Math.abs(enemyRGBA[o] - bgRGBA[o]);
    const dg = Math.abs(enemyRGBA[o + 1] - bgRGBA[o + 1]);
    const db = Math.abs(enemyRGBA[o + 2] - bgRGBA[o + 2]);
    if (dr + dg + db > threshold) mask[i] = 1;
  }
  return mask;
}

// Returns a Uint8Array marking pixels within `radius` of a masked pixel but
// NOT themselves masked - a ring of background immediately surrounding the
// enemy silhouette, sampled from the BACKGROUND frame for the contrast calc.
export function dilateRing(mask, width, height, radius = RING_RADIUS_PX) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx]) continue;
      let near = false;
      for (let dy = -radius; dy <= radius && !near; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          if (mask[ny * width + nx]) { near = true; break; }
        }
      }
      if (near) out[idx] = 1;
    }
  }
  return out;
}

// Mean RGB (and pixel count) over the masked pixels of an RGBA buffer.
export function meanRGBForMask(rgba, width, height, mask) {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let i = 0; i < width * height; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    sumR += rgba[o];
    sumG += rgba[o + 1];
    sumB += rgba[o + 2];
    count++;
  }
  if (count === 0) return { r: 0, g: 0, b: 0, count: 0 };
  return { r: sumR / count, g: sumG / count, b: sumB / count, count };
}

// Legibility contrast score between an enemy-mask mean colour and its
// surrounding background mean colour. Blends luminance distance (the
// biggest legibility driver - "is it darker/brighter than what's behind
// it") with raw colour distance (hue/chroma separation). Higher = more
// legible. Not normalised to a fixed range - compare archetypes/runs
// relative to each other and to prior baselines, not to an absolute scale.
export function contrastScore(enemyMeanRGB, bgMeanRGB) {
  const lumEnemy = 0.2126 * enemyMeanRGB.r + 0.7152 * enemyMeanRGB.g + 0.0722 * enemyMeanRGB.b;
  const lumBg = 0.2126 * bgMeanRGB.r + 0.7152 * bgMeanRGB.g + 0.0722 * bgMeanRGB.b;
  const lumDiff = Math.abs(lumEnemy - lumBg);
  const colourDist = Math.hypot(
    enemyMeanRGB.r - bgMeanRGB.r,
    enemyMeanRGB.g - bgMeanRGB.g,
    enemyMeanRGB.b - bgMeanRGB.b
  );
  return Number((lumDiff * 0.6 + colourDist * 0.4).toFixed(2));
}

// ---------------------------------------------------------------------
// Browser-only capture path (cannot be exercised under vitest - no WebGL).
// ---------------------------------------------------------------------

// Render the scene and downscale the canvas into an offscreen 2D canvas so
// we can read pixel data back out (mirrors shots.js's analyzeOneShot, which
// does the same downscale-then-getImageData dance from a dataURL instead).
function captureFramePixels(renderer, scene, camera, renderFrame, targetWidth = CAPTURE_WIDTH) {
  renderFrame();
  const srcCanvas = renderer.domElement;
  const scale = targetWidth / srcCanvas.width;
  const width = targetWidth;
  const height = Math.max(1, Math.round(srcCanvas.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

// Main routine: for each archetype, spawn it alone at the fixed aim point,
// diff against the background, score contrast, then clean it up before the
// next archetype. Returns { perArchetype, minContrast, meanContrast,
// worstArchetype }.
export async function checkLegibility(options = {}) {
  const {
    renderer, camera, scene, game, drizzle, effects, motes,
    vantage = LEGIBILITY_VANTAGE,
    archetypes = ARCHETYPES,
  } = options;
  // round-6: probe through the post pipeline when provided - legibility is
  // measured on the pixels the player actually sees (grade, AO, bloom, rays)
  const renderFrame = options.renderFrame || (() => renderer.render(scene, camera));
  const enemyMgr = options.enemyMgr || (options.sim && options.sim.enemyMgr);

  if (!renderer || !camera || !scene || !game || !enemyMgr) {
    console.error('[legibility] checkLegibility requires: renderer, camera, scene, game, enemyMgr (or sim)');
    return null;
  }

  const cleanup = freezeForCapture(game, drizzle, effects, motes, camera);
  const perArchetype = [];

  try {
    placeCamera(camera, vantage);
    const bgFrame = captureFramePixels(renderer, scene, camera, renderFrame);

    for (const type of archetypes) {
      if (!ENEMY_DEFS[type]) {
        console.warn(`[legibility] unknown archetype: ${type}, skipping`);
        continue;
      }

      console.log(`[legibility] probing ${type}...`);
      const e = enemyMgr.spawn(type, vantage.lookAt.x, vantage.lookAt.z);
      // the shrike spawns perched 7-10m aloft - usually OUTSIDE the probe
      // frame, so its score was mostly 0-mask noise (round-8 audit: 6 of 11
      // probes returned an empty mask). Ground it for the measurement; the
      // player meets it at ground level mid-leap anyway.
      if (type === 'shrike') {
        e.pos.y = terrainHeight(vantage.lookAt.x, vantage.lookAt.z);
        e.model.group.position.copy(e.pos);
      }
      const enemyFrame = captureFramePixels(renderer, scene, camera, renderFrame);

      const mask = maskFromDiff(bgFrame.data, enemyFrame.data, bgFrame.width, bgFrame.height);
      const ring = dilateRing(mask, bgFrame.width, bgFrame.height);
      const enemyMean = meanRGBForMask(enemyFrame.data, bgFrame.width, bgFrame.height, mask);
      const bgMean = meanRGBForMask(bgFrame.data, bgFrame.width, bgFrame.height, ring);

      const contrast = enemyMean.count > 0 && bgMean.count > 0
        ? contrastScore(enemyMean, bgMean)
        : 0;

      perArchetype.push({ type, contrast, maskPixels: enemyMean.count });

      // Clean up before the next archetype - same convention enemyMgr.reset()
      // uses (mark dead, hide the model group) rather than routing through
      // applyDamage, since the scene is frozen (game.time is pinned) and the
      // dying-animation timer would never advance.
      e.dead = true;
      e.model.group.visible = false;
    }
  } finally {
    cleanup();
    // Belt-and-braces: fully reset the manager so no probe enemy survives
    // into the next real run, even if something above threw mid-loop.
    if (enemyMgr.reset) enemyMgr.reset();
  }

  if (perArchetype.length === 0) {
    return { perArchetype: [], minContrast: null, meanContrast: null, worstArchetype: null };
  }

  const contrasts = perArchetype.map((a) => a.contrast);
  const minContrast = Math.min(...contrasts);
  const meanContrast = Number((contrasts.reduce((a, b) => a + b, 0) / contrasts.length).toFixed(2));
  const worstArchetype = perArchetype.reduce((w, a) => (a.contrast < w.contrast ? a : w)).type;

  console.log(`[legibility] done: min=${minContrast} mean=${meanContrast} worst=${worstArchetype}`);
  return { perArchetype, minContrast, meanContrast, worstArchetype };
}

// Screenshot rig for deterministic before/after grading of art/lighting changes.
// Captures canonical vantage points across all three moods, freezing all
// non-deterministic elements (wind, weather RNG, particle effects, HUD overlays,
// the trip effect) so two runs are pixel-for-pixel identical except for the art.
//
// Usage (browser console):
//   window.__deadfall.shots.captureShots({ mood: 'bloom' })   # single mood
//   window.__deadfall.shots.captureShots()                    # all 3 moods
//   window.__deadfall.shots.downloadShots(shots)              # save to disk + contact sheet

import * as THREE from 'three';
import { LANDMARKS, terrainHeight, WORLD } from '../world/heightmap.js';

// Canonical vantage points - chosen to cover the visual range of the game.
// Each has deterministic position and look-at direction to ensure pixel-perfect
// comparisons across runs. Camera is placed at eye height above terrain.
const VANTAGES = [
  {
    name: 'INSERTION BEACH',
    // Southern insertion plain where the player starts
    pos: { x: 4, z: 200 },
    lookAt: { x: 4, z: -100 },
  },
  {
    name: 'JUNGLE CANOPY (dense west)',
    // Dense thicket interior - the flattest, most solid-colour visual challenge
    pos: { x: -110, z: 80 },
    lookAt: { x: -40, z: 20 },
  },
  {
    name: 'RIVER CROSSING (The Rapids)',
    // Open water crossing, exposes the carved channel and sky reflection
    pos: { x: 2, z: -14 },
    lookAt: { x: 20, z: -80 },
  },
  {
    name: 'GORGE LIP (Rivergate)',
    // Looking down the flooded gorge - vertical drop, atmospheric
    pos: { x: 14, z: -52 },
    lookAt: { x: 14, z: -180 },
  },
  {
    name: 'RIDGE VISTA (Eastern spine)',
    // High ground with long sightlines across the whole valley
    pos: { x: 148, z: 34 },
    lookAt: { x: 40, z: -200 },
  },
  {
    name: 'CINDER FANG (mountain peak)',
    // The isolated southeastern spike - extreme geometry and lighting test
    pos: { x: 196, z: -96 },
    lookAt: { x: 196, z: -200 },
  },
  {
    name: 'THE SUNKEN MAW (boss basin)',
    // The flooded depression where the Miremother waits - final arena geometry
    pos: { x: 44, z: -272 },
    lookAt: { x: 60, z: -320 },
  },
  {
    name: 'EXTRACTION MESA (destination)',
    // The final butte - geometry and elevation test
    pos: { x: 86, z: -308 },
    lookAt: { x: 86, z: -380 },
  },
];

// Freeze non-deterministic behaviours during screenshot capture.
// Returns cleanup function to restore original state.
function freezeForCapture(game, drizzle, effects, motes, camera) {
  const originals = {};

  // Freeze game time (no behaviour updates)
  originals.time = game.time;
  Object.defineProperty(game, 'time', {
    get() { return originals.time; },
    set(v) { /* no-op */ },
  });

  // Disable motes (spore particles)
  if (motes && motes.update) {
    originals.motesUpdate = motes.update;
    motes.update = () => {}; // frozen
  }

  // Disable drizzle (rain particles) - set visibility off and freeze updates
  if (drizzle && drizzle.update) {
    originals.drizzleUpdate = drizzle.update;
    originals.drizzleSetLevel = drizzle.setLevel;
    drizzle.update = () => {}; // frozen
    drizzle.setLevel = () => {}; // frozen
  }

  // Disable effects (muzzle flashes, bullet tracers, explosions)
  if (effects) {
    originals.effectsUpdate = effects.update;
    originals.spawnTracer = effects.spawnTracer;
    originals.burst = effects.burst;
    effects.update = () => {}; // frozen
    effects.spawnTracer = () => {}; // no-op
    effects.burst = () => {}; // no-op
  }

  // Freeze wind/vegetation sway globally (via viewport module)
  // The sway multiplier is set at the vegetation level
  originals.vegetationSway = window.__deadfallVegetationSway;

  // Disable HUD visibility
  const hudEl = document.getElementById('hud');
  if (hudEl) {
    originals.hudDisplay = hudEl.style.display;
    hudEl.style.display = 'none';
  }

  // Disable vignette/atmospheric overlays
  const vignetteEl = document.getElementById('vignette');
  if (vignetteEl) {
    originals.vignetteDisplay = vignetteEl.style.display;
    vignetteEl.style.display = 'none';
  }

  // Disable underwater overlay
  const underwaterEl = document.getElementById('underwater');
  if (underwaterEl) {
    originals.underwaterDisplay = underwaterEl.style.display;
    underwaterEl.style.display = 'none';
  }

  // Disable fever (trip) effect overlay
  const feverEl = document.getElementById('fever');
  if (feverEl) {
    originals.feverDisplay = feverEl.style.display;
    feverEl.style.display = 'none';
  }

  // Disable lightning overlay
  const lightningEl = document.getElementById('lightning');
  if (lightningEl) {
    originals.lightningDisplay = lightningEl.style.display;
    lightningEl.style.display = 'none';
  }

  // Cleanup function to restore everything
  function cleanup() {
    // Restore game time
    Object.defineProperty(game, 'time', {
      value: originals.time,
      writable: true,
    });

    // Restore motes
    if (motes && originals.motesUpdate) {
      motes.update = originals.motesUpdate;
    }

    // Restore drizzle
    if (drizzle) {
      if (originals.drizzleUpdate) drizzle.update = originals.drizzleUpdate;
      if (originals.drizzleSetLevel) drizzle.setLevel = originals.drizzleSetLevel;
    }

    // Restore effects
    if (effects && originals.effectsUpdate) {
      effects.update = originals.effectsUpdate;
      effects.spawnTracer = originals.spawnTracer;
      effects.burst = originals.burst;
    }

    // Restore HUD
    if (hudEl) {
      hudEl.style.display = originals.hudDisplay || '';
    }

    // Restore overlays
    if (vignetteEl) {
      vignetteEl.style.display = originals.vignetteDisplay || '';
    }
    if (underwaterEl) {
      underwaterEl.style.display = originals.underwaterDisplay || '';
    }
    if (feverEl) {
      feverEl.style.display = originals.feverDisplay || '';
    }
    if (lightningEl) {
      lightningEl.style.display = originals.lightningDisplay || '';
    }
  }

  return cleanup;
}

// Place camera at vantage point with deterministic look-at direction.
function placeCamera(camera, vantage) {
  const groundHeight = terrainHeight(vantage.pos.x, vantage.pos.z, WORLD.seed);
  const eyeHeight = 1.66; // player eye height
  camera.position.set(vantage.pos.x, groundHeight + eyeHeight, vantage.pos.z);
  camera.lookAt(vantage.lookAt.x, groundHeight + eyeHeight, vantage.lookAt.z);
  camera.updateProjectionMatrix();
}

// Capture a single frame from the canvas as PNG dataURL.
function captureFrame(renderer) {
  // Force a render
  renderer.render(renderer._scene || new THREE.Scene(), renderer._camera || new THREE.Camera());

  // Grab the canvas and convert to PNG dataURL
  return renderer.domElement.toDataURL('image/png');
}

// Create a contact sheet - all vantages tiled with labels burned in.
function createContactSheet(shots, gridCols = 2) {
  if (!shots || shots.length === 0) {
    console.warn('[shots] no shots to composite');
    return null;
  }

  // Load all images in parallel
  const imgPromises = shots.map((shot) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = shot.dataURL;
    });
  });

  return Promise.all(imgPromises).then((images) => {
    // Assume all images are the same size (they will be - same viewport)
    const imgWidth = images[0].width;
    const imgHeight = images[0].height;
    const gridRows = Math.ceil(shots.length / gridCols);

    // Canvas to hold the grid
    const canvas = document.createElement('canvas');
    canvas.width = imgWidth * gridCols;
    canvas.height = imgHeight * gridRows;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw each image with its label
    shots.forEach((shot, i) => {
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const x = col * imgWidth;
      const y = row * imgHeight;

      // Draw the screenshot
      ctx.drawImage(images[i], x, y);

      // Draw the vantage name as text label
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x, y + imgHeight - 32, imgWidth, 32);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(shot.name, x + 8, y + imgHeight - 16);
    });

    return canvas.toDataURL('image/png');
  });
}

// Main capture routine. Freezes the game state, iterates all vantages,
// and captures them in the given mood(s).
export async function captureShots(options = {}) {
  const { mood = null, renderer, camera, game, drizzle, effects, motes, applyMood, MOODS, scene } = options;

  if (!renderer || !camera || !game || !applyMood || !MOODS || !scene) {
    console.error('[shots] captureShots requires: renderer, camera, game, drizzle, effects, motes, applyMood, MOODS, scene');
    return [];
  }

  // Determine which moods to capture
  let moods = [];
  if (mood) {
    if (MOODS[mood]) {
      moods = [mood];
    } else {
      console.error(`[shots] unknown mood: ${mood}`);
      return [];
    }
  } else {
    moods = Object.keys(MOODS);
  }

  console.log(`[shots] capturing ${moods.length} mood(s) x ${VANTAGES.length} vantages = ${moods.length * VANTAGES.length} frames`);

  const allShots = [];
  const cleanup = freezeForCapture(game, drizzle, effects, motes, camera);

  try {
    for (const moodKey of moods) {
      const moodConfig = MOODS[moodKey];
      console.log(`[shots] switching to mood: ${moodKey}`);
      applyMood(moodConfig);

      // Force a render to apply mood lighting
      renderer.render(scene, camera);

      for (const vantage of VANTAGES) {
        console.log(`[shots] capturing ${vantage.name}...`);
        placeCamera(camera, vantage);
        renderer.render(scene, camera);
        const dataURL = renderer.domElement.toDataURL('image/png');
        allShots.push({
          mood: moodKey,
          name: vantage.name,
          dataURL,
        });
      }
    }

    console.log(`[shots] captured ${allShots.length} frames`);
    return allShots;
  } finally {
    cleanup();
  }
}

// Download shots to disk. Triggers browser downloads of individual PNGs
// and a contact-sheet composite showing all vantages at a glance.
export async function downloadShots(shots) {
  if (!shots || shots.length === 0) {
    console.warn('[shots] no shots to download');
    return;
  }

  console.log(`[shots] preparing downloads for ${shots.length} frames...`);

  // Create contact sheet
  const contactSheetDataURL = await createContactSheet(shots, 2);
  if (contactSheetDataURL) {
    const link = document.createElement('a');
    link.href = contactSheetDataURL;
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    link.download = `deadfall-contact-sheet-${timestamp}.png`;
    link.click();
    console.log('[shots] downloading contact sheet...');
  }

  // Download individual frames (grouped by mood)
  const shotsByMood = {};
  for (const shot of shots) {
    if (!shotsByMood[shot.mood]) {
      shotsByMood[shot.mood] = [];
    }
    shotsByMood[shot.mood].push(shot);
  }

  for (const [moodKey, moodShots] of Object.entries(shotsByMood)) {
    for (const shot of moodShots) {
      // Small delay between downloads to avoid browser throttling
      await new Promise((resolve) => setTimeout(resolve, 100));

      const link = document.createElement('a');
      link.href = shot.dataURL;
      const sanitized = shot.name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      link.download = `deadfall-${moodKey}-${sanitized}-${timestamp}.png`;
      link.click();
    }
  }

  console.log('[shots] downloads complete');
}

// Pure pixel-math helper - no canvas/Image dependency, so it is unit-testable
// under vitest's node environment. Takes a flat RGBA Uint8 array (as returned
// by CanvasRenderingContext2D.getImageData().data) and its width/height, and
// returns the objective colour-grading metrics for that image.
export function computeStats(rgbaUint8, width, height) {
  const pixelCount = width * height;
  let sumR = 0, sumG = 0, sumB = 0;
  let sumSat = 0, sumVal = 0;
  let muddyCount = 0, vividCount = 0, skyCount = 0, darkCount = 0;

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const r = rgbaUint8[o];
    const g = rgbaUint8[o + 1];
    const b = rgbaUint8[o + 2];

    sumR += r;
    sumG += g;
    sumB += b;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const val = max / 255;

    sumSat += sat;
    sumVal += val;

    const isSky = b > 140 && b >= r && b >= g && val > 0.55;
    if (isSky) skyCount++;
    if (sat < 0.28 && val > 0.2 && val < 0.75 && !isSky) muddyCount++;
    if (sat > 0.45) vividCount++;
    if (val < 0.2) darkCount++;
  }

  return {
    meanR: Math.round(sumR / pixelCount),
    meanG: Math.round(sumG / pixelCount),
    meanB: Math.round(sumB / pixelCount),
    meanSat: Number((sumSat / pixelCount).toFixed(3)),
    meanVal: Number((sumVal / pixelCount).toFixed(3)),
    pctMuddy: Number(((muddyCount / pixelCount) * 100).toFixed(1)),
    pctVivid: Number(((vividCount / pixelCount) * 100).toFixed(1)),
    pctSky: Number(((skyCount / pixelCount) * 100).toFixed(1)),
    pctDark: Number(((darkCount / pixelCount) * 100).toFixed(1)),
  };
}

// Average a list of per-shot stat objects into one aggregate object (used to
// roll individual shots up into a per-mood summary).
function averageStats(statsList) {
  if (!statsList || statsList.length === 0) return null;
  const keys = Object.keys(statsList[0]);
  const out = {};
  for (const key of keys) {
    const sum = statsList.reduce((acc, s) => acc + s[key], 0);
    out[key] = Number((sum / statsList.length).toFixed(3));
  }
  return out;
}

// Draw a shot's dataURL to an offscreen canvas (downscaled for speed) and
// compute its objective colour-grading metrics via computeStats.
function analyzeOneShot(shot, targetWidth = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = targetWidth / img.width;
      const w = targetWidth;
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const { data } = ctx.getImageData(0, 0, w, h);
      const stats = computeStats(data, w, h);
      resolve({ mood: shot.mood, name: shot.name, ...stats });
    };
    img.onerror = reject;
    img.src = shot.dataURL;
  });
}

// Compute objective colour-grading metrics for a set of captured shots.
// Returns per-shot stats plus per-mood aggregates (mean of that mood's shots).
export async function analyzeShots(shots) {
  if (!shots || shots.length === 0) {
    console.warn('[shots] no shots to analyze');
    return { perShot: [], perMood: {} };
  }

  console.log(`[shots] analyzing ${shots.length} frames...`);
  const perShot = await Promise.all(shots.map((shot) => analyzeOneShot(shot)));

  const perMood = {};
  const shotsByMood = {};
  for (const s of perShot) {
    if (!shotsByMood[s.mood]) shotsByMood[s.mood] = [];
    shotsByMood[s.mood].push(s);
  }
  for (const [moodKey, moodShots] of Object.entries(shotsByMood)) {
    perMood[moodKey] = averageStats(moodShots);
  }

  console.log(`[shots] analysis complete for ${perShot.length} frames`);
  return { perShot, perMood };
}

// Convenience: capture then immediately analyze in one call.
export async function captureAndAnalyze(options = {}) {
  const shots = await captureShots(options);
  const analysis = await analyzeShots(shots);
  return { shots, analysis };
}

// Wired onto window.__deadfall.shots - the debug API surface
export function createShotsAPI(options) {
  return {
    captureShots: (opts = {}) => captureShots({ ...options, ...opts }),
    downloadShots,
    analyzeShots,
    captureAndAnalyze: (opts = {}) => captureAndAnalyze({ ...options, ...opts }),
  };
}

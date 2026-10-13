// Async texture loading system with fallbacks for headless/missing-file cases.
// Textures are CC0 from Poly Haven (polyhaven.com) and ambientCG (ambientcg.com).
// See assets/textures/CREDITS.md for provenance.

import * as THREE from 'three';

const loader = new THREE.TextureLoader();

// Track loading state - never block game startup on texture load failures
const textureCache = new Map();
const loadingPromises = new Map();

/**
 * Load a PBR texture set. Returns a promise that resolves when all maps are loaded,
 * but game startup does NOT wait for this. If loading fails, materials render
 * with fallback colours (the vertex-colour palette is preserved).
 *
 * @param {string} name - Texture set name (e.g. 'bark-01')
 * @param {string} basePath - Path prefix (e.g. '/textures/bark-01/')
 * @returns {Promise<Object>} { diffuse, normal, roughness, ao? } or empty {} on failure
 */
export async function loadTextureSet(name, basePath) {
  // Return cached result if available
  if (textureCache.has(name)) {
    return textureCache.get(name);
  }

  // Return in-flight promise if already loading
  if (loadingPromises.has(name)) {
    return loadingPromises.get(name);
  }

  // Create new loading promise
  const promise = (async () => {
    try {
      const maps = await Promise.all([
        loadTexture(`${basePath}diffuse.jpg`),
        loadTexture(`${basePath}normal.png`),
        loadTexture(`${basePath}roughness.jpg`),
        loadTexture(`${basePath}ao.jpg`).catch(() => null), // AO is optional
      ]);

      // Configure textures correctly
      if (maps[0]) maps[0].colorSpace = THREE.SRGBColorSpace;
      if (maps[1]) {
        maps[1].colorSpace = THREE.LinearSRGBColorSpace;
        // Normal maps often have inverted green channel depending on convention
        maps[1].needsUpdate = true;
      }
      if (maps[2]) maps[2].colorSpace = THREE.LinearSRGBColorSpace;
      if (maps[3]) maps[3].colorSpace = THREE.LinearSRGBColorSpace;

      // World geometry drives UVs directly from world-space coordinates
      // (see terrain.js "texture bombing" comment), so values routinely
      // exceed the 0-1 range. Without repeat wrapping the sampler clamps
      // at the edge and the texture reads as stretched/smeared instead of
      // tiling. All four maps must agree or edges will visibly mismatch.
      for (const map of maps) {
        if (!map) continue;
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
      }

      const result = {
        diffuse: maps[0],
        normal: maps[1],
        roughness: maps[2],
        ao: maps[3],
      };

      textureCache.set(name, result);
      return result;
    } catch (err) {
      console.warn(`[textures] failed to load set '${name}':`, err.message);
      // Return empty object - materials will use fallback colour
      const empty = { diffuse: null, normal: null, roughness: null, ao: null };
      textureCache.set(name, empty);
      return empty;
    }
  })();

  loadingPromises.set(name, promise);
  return promise;
}

/**
 * Load a single texture file with error handling.
 */
function loadTexture(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

// Real CC0 photo-scan diffuse maps read as muddy/desaturated compared to the
// game's vibrant vertex-colour palette. `strength` below controls how much
// of that real colour comes through: at 1 the map's own colour is used
// as-is (multiplied with vertex colour); as it drops toward 0 the map is
// desaturated toward its own luminance so the underlying vertex-colour hue
// dominates while the photo's surface grain/detail (the whole point of
// adding real textures) is preserved. Processed maps are cached per
// (source texture, strength) so repeated applyTextures() calls don't
// reprocess pixels.
const desaturatedCache = new WeakMap();

function desaturatedDiffuse(sourceTexture, strength) {
  if (strength >= 1) return sourceTexture;

  let byStrength = desaturatedCache.get(sourceTexture);
  if (!byStrength) {
    byStrength = new Map();
    desaturatedCache.set(sourceTexture, byStrength);
  }
  const cached = byStrength.get(strength);
  if (cached) return cached;

  const image = sourceTexture.image;
  if (!image || !image.width) return sourceTexture; // not decoded yet, fall back

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    // Rec. 709 luma - keeps the photo's lightness variation (the surface
    // detail) while discarding the hue/saturation that reads as "realistic".
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    px[i] = luma + (r - luma) * strength;
    px[i + 1] = luma + (g - luma) * strength;
    px[i + 2] = luma + (b - luma) * strength;
  }
  ctx.putImageData(data, 0, 0);

  const processed = new THREE.CanvasTexture(canvas);
  processed.colorSpace = sourceTexture.colorSpace;
  processed.wrapS = sourceTexture.wrapS;
  processed.wrapT = sourceTexture.wrapT;
  processed.needsUpdate = true;

  byStrength.set(strength, processed);
  return processed;
}

/**
 * Apply a loaded texture set to a material. Mutates the material.
 * Uses alpha blending to mix texture with vertex colours.
 * @param {THREE.MeshStandardMaterial} material
 * @param {Object} textures - From loadTextureSet()
 * @param {number} strength - Blend strength 0-1 (default 0.6). Lower values
 *   desaturate the diffuse map toward luminance-only, letting the vertex
 *   colour palette dominate hue while keeping surface grain. Tune this per
 *   material if a texture set drags the fantastical palette toward realism.
 */
export function applyTextures(material, textures, strength = 0.6) {
  if (!textures || !textures.diffuse) return; // No textures loaded

  material.map = desaturatedDiffuse(textures.diffuse, strength);
  material.normalMap = textures.normal;
  material.roughnessMap = textures.roughness;
  if (textures.ao) material.aoMap = textures.ao;

  // Preserve vertex colours by multiplying with texture albedo
  material.vertexColors = true;

  // Normal map scale
  if (material.normalScale) material.normalScale.set(1, 1);

  material.needsUpdate = true;
}

/**
 * Preload all texture sets asynchronously (non-blocking).
 * Call once at game startup if you want textures ready ASAP.
 */
export async function preloadAllTextures() {
  const sets = [
    ['bark-01', '/textures/bark-01/'],
    ['bark-02', '/textures/bark-02/'],
    ['foliage', '/textures/foliage/'],
    ['mud', '/textures/mud/'],
    ['rock', '/textures/rock/'],
    ['stone-ruin', '/textures/stone-ruin/'],
  ];

  await Promise.all(sets.map(([name, path]) => loadTextureSet(name, path)));
}

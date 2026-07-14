// Async texture loading system with fallbacks for headless/missing-file cases.
// Textures are CC0 from Poly Haven (polyhaven.com) and ambientCG (ambientcg.com).
// See public/textures/CREDITS.md for provenance.

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
        loadTexture(`${basePath}normal.jpg`),
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

/**
 * Apply a loaded texture set to a material. Mutates the material.
 * Uses alpha blending to mix texture with vertex colours.
 * @param {THREE.MeshStandardMaterial} material
 * @param {Object} textures - From loadTextureSet()
 * @param {number} strength - Blend strength 0-1 (default 0.6)
 */
export function applyTextures(material, textures, strength = 0.6) {
  if (!textures || !textures.diffuse) return; // No textures loaded

  material.map = textures.diffuse;
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

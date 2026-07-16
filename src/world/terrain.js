// Terrain mesh built from the analytic heightmap, coloured per-vertex by
// height / moisture / slope so the three routes read at a glance:
// dark boggy swamp, olive riverbed, khaki-rock ridge, deep green jungle floor.
// Textures are blended with vertex colours to preserve the vibrant palette.
// Triplanar mapping prevents stretching on slopes.

import * as THREE from 'three';
import {
  WORLD, terrainHeight, moisture, terrainNormal, razorfinHazard,
} from './heightmap.js';
import { clamp, lerp, smoothstep } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { loadTextureSet, applyTextures } from '../core/textures.js';
import { dapplify } from './dapple.js';

// Fever-dream ground palette, round-3 saturation push (Far Cry New Dawn
// vibrancy): electric greens, golden dry grass, warm violet-cast rock -
// nothing crushes toward black (round-1 "too dark" fix).
const COL = {
  mud: new THREE.Color(0x6b4c2e),
  wetMud: new THREE.Color(0x513a20),
  lush: new THREE.Color(0x2f8a14),
  deepLush: new THREE.Color(0x1a6e12),
  dry: new THREE.Color(0xb8a838),
  rock: new THREE.Color(0x968294),
  sand: new THREE.Color(0xc9a95e),
};

export function buildTerrain(scene) {
  const segs = 320;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);

    terrainNormal(x, z, n);
    const m = moisture(x, z);
    const slope = 1 - n.y;

    // base colour: dry khaki -> lush deep green by moisture
    c.copy(COL.dry).lerp(COL.lush, clamp(m * 1.25, 0, 1));
    if (m > 0.75) c.lerp(COL.deepLush, (m - 0.75) * 3);

    // waterline mud banks
    const bank = clamp((WORLD.waterLevel + 1.6 - h) / 2.4, 0, 1);
    if (bank > 0) c.lerp(h < WORLD.waterLevel ? COL.wetMud : COL.mud, bank * 0.9);

    // steep = exposed rock (the new cliff walls read as bare stone)
    if (slope > 0.25) c.lerp(COL.rock, clamp((slope - 0.25) * 3.2, 0, 0.85));
    // only true summits fade to rock (the highlands shelf stays jungle)
    if (h > 19) c.lerp(COL.rock, clamp((h - 19) / 22, 0, 0.6));

    // per-vertex variance breaks up flat shading; slight hue drift keeps
    // big same-colour fields alive (round-3 saturation pass)
    const v = hash2(Math.round(x * 2.3), Math.round(z * 2.3), 91) * 0.16 - 0.08;
    c.offsetHSL(v * 0.07, 0.03, v * 0.35);

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // Add per-vertex UV variance to break up tiling. Each vertex gets a unique
  // offset into the texture, driven by world position hash, so repeated
  // textures don't read as wallpaper (the "texture bombing" technique).
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Combine multiple scales: 0.5 and 2.0 sampling
    const v = hash2(Math.round(x * 0.5), Math.round(z * 0.5), 137);
    // 0.04 -> 0.06: one mud tile per ~17m instead of 25m - at 0.04 the
    // grain vanished on open ground (mesa top, river banks read as flat
    // colour fields at gameplay distance)
    uvs[i * 2] = x * 0.06 + v * 0.5;
    uvs[i * 2 + 1] = z * 0.06 + (1 - v) * 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const mat = dapplify(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  }));

  // Note: Textures will be applied by applyTextures() when they load.
  // Vertex colors are multiplied with the texture to preserve the vibrant palette.

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // Load and apply textures asynchronously (non-blocking)
  loadTextureSet('mud', '/textures/mud/')
    .then((textures) => {
      applyTextures(mat, textures, 0.68);
    })
    .catch(() => {
      // Silently fail - material renders with vertex colour fallback
    });

  return mesh;
}

export function buildWater(scene) {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 128, 128);
  geo.rotateX(-Math.PI / 2);

  // per-vertex colour: living teal water, blooming BLOOD RED over the
  // razorfin gorge AND the Sunken Maw (the boss's moat) - hazards
  // telegraph themselves from a distance.
  // per-vertex swell AMPLITUDE is scaled by real water depth; where the
  // plane would form a paper-thin film over near-coplanar ground (the
  // round-2 "pool grows and shrinks with view angle" z-fighting bug) the
  // vertex is sunk below the terrain instead.
  const pos = geo.attributes.position;
  const wCol = new Float32Array(pos.count * 3);
  const amp = new Float32Array(pos.count);
  const depthAttr = new Float32Array(pos.count); // 0 shallow edge -> 1 deep
  const cSafe = new THREE.Color(0x25b89a);
  const cBlood = new THREE.Color(0xa01a2e);
  const cw = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const hC = terrainHeight(x, z);
    const depth = WORLD.waterLevel - hC;
    if (depth < 0.22) {
      // Sink the dry film just below ground - deep enough that the linear
      // plane between grid verts never pokes out of the hillside, shallow
      // enough that pool borders stay a thin band instead of a visible
      // "dune" wall (the old fixed -2.5 painted red slopes at the Maw;
      // a fixed -0.45 poked a giant teal sheet through the mesa cliff).
      // Slope-adaptive: flat shoreline sinks 0.45, steep ground sinks by
      // its own per-cell height change plus margin.
      const cell = WORLD.size / 128;
      const slope = Math.max(
        Math.abs(terrainHeight(x + cell, z) - hC),
        Math.abs(terrainHeight(x - cell, z) - hC),
        Math.abs(terrainHeight(x, z + cell) - hC),
        Math.abs(terrainHeight(x, z - cell) - hC)
      );
      pos.setY(i, hC - WORLD.waterLevel - (0.45 + slope * 1.3));
      amp[i] = 0;
    } else {
      amp[i] = clamp(depth / 1.2, 0, 1);
    }
    depthAttr[i] = clamp(depth / 2.5, 0, 1);
    const dMaw = Math.hypot(x - WORLD.maw.x, z - WORLD.maw.z);
    const blood = Math.max(
      razorfinHazard(x, z),
      smoothstep(WORLD.maw.r + 6, WORLD.maw.r - 12, dMaw) * 0.85
    );
    cw.copy(cSafe).lerp(cBlood, blood);
    wCol[i * 3] = cw.r;
    wCol[i * 3 + 1] = cw.g;
    wCol[i * 3 + 2] = cw.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depthAttr, 1));

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 1, // alpha is fully shader-driven (depth + fresnel), see below
    roughness: 0.16,
    metalness: 0.05,
    // DoubleSide + no depth-write: the surface stays visible from BELOW
    // (round-1 bug: wading the deep channel put the camera under the
    // single-sided plane and the water "vanished")
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Round 4 "kill the flat slab": animated procedural ripple normals (sun
  // specular glints), depth-driven transparency/colour (shallow edges read
  // thin and bright, the channel reads deep and dark) and a fresnel term
  // (grazing angles go reflective-opaque - the classic water cue).
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWTime = { value: 0 };
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aDepth;
        varying float vWDepth;
        varying vec3 vWaterWP;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWDepth = aDepth;
        vWaterWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWTime;
        varying float vWDepth;
        varying vec3 vWaterWP;
        float waterHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float waterNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x),
            mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x),
            u.y);
        }
        // two scrolling octaves - broad swell + fine chop
        float rippleHeight(vec2 p) {
          return waterNoise(p * 0.35 + uWTime * vec2(0.10, 0.04)) * 0.6
               + waterNoise(p * 1.30 - uWTime * vec2(0.07, 0.12)) * 0.4;
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          // finite-difference gradient of the ripple field -> world normal
          vec2 wp = vWaterWP.xz;
          float e = 0.35;
          float h0 = rippleHeight(wp);
          float hx = rippleHeight(wp + vec2(e, 0.0));
          float hz = rippleHeight(wp + vec2(0.0, e));
          // calm shallow edges, lively deep channel
          float k = 2.0 * mix(0.35, 1.0, vWDepth);
          vec3 nW = normalize(vec3(-(hx - h0) * k / e, 1.0, -(hz - h0) * k / e));
          nW.y *= gl_FrontFacing ? 1.0 : -1.0; // seen from underwater
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          // depth-based colour + alpha: thin bright edges, deep dark water
          // (lives here, not color_fragment, because 'normal' only exists
          // from normal_fragment_begin onward - chunk order matters)
          diffuseColor.rgb *= mix(0.95, 0.52, vWDepth);
          float wAlpha = mix(0.38, 0.84, vWDepth);
          vec3 wViewDir = normalize(vViewPosition);
          float wFres = pow(1.0 - saturate(dot(wViewDir, normal)), 3.0);
          diffuseColor.a = clamp(wAlpha + wFres * 0.28, 0.0, 0.9);
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.waterLevel;
  mesh.name = 'water';
  scene.add(mesh);

  // gentle swell so the river reads as liquid even without textures;
  // depth-scaled so puddle edges hold still instead of pulsing
  const base = geo.attributes.position.array.slice();
  mesh.userData.tick = (t) => {
    if (mat.userData.shader) mat.userData.shader.uniforms.uWTime.value = t;
    const arr = geo.attributes.position.array;
    for (let i = 0, v = 0; i < arr.length; i += 3, v++) {
      if (amp[v] === 0) continue;
      const x = base[i];
      const z = base[i + 2];
      arr[i + 1] = base[i + 1] + amp[v] * (
        Math.sin(t * 1.1 + x * 0.11 + z * 0.13) * 0.09
        + Math.sin(t * 0.7 + z * 0.07) * 0.06);
    }
    geo.attributes.position.needsUpdate = true;
  };
  return mesh;
}

export function heightAt(x, z) {
  return terrainHeight(x, z);
}

export { lerp };

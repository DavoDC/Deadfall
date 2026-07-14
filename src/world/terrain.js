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
    uvs[i * 2] = x * 0.04 + v * 0.5;
    uvs[i * 2 + 1] = z * 0.04 + (1 - v) * 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });

  // Inject triplanar mapping shader
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;`
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        vec4 triplanarSample(sampler2D tex, vec3 pos, vec3 normal, float scale) {
          vec3 projNormal = abs(normal);
          projNormal /= (projNormal.x + projNormal.y + projNormal.z);
          vec4 x = texture2D(tex, pos.yz * scale);
          vec4 y = texture2D(tex, pos.xz * scale);
          vec4 z = texture2D(tex, pos.xy * scale);
          return x * projNormal.x + y * projNormal.y + z * projNormal.z;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Triplanar texture sampling (if texture is loaded)
        if (diffuse != vec4(1.0)) {
          vec4 triColor = triplanarSample(map, vWorldPos * 0.5, normalize(vWorldNormal), 2.0);
          diffuse.rgb = mix(diffuse.rgb, triColor.rgb, 0.55);
        }`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // Load and apply textures asynchronously (non-blocking)
  loadTextureSet('mud', '/textures/mud/')
    .then((textures) => {
      applyTextures(mat, textures, 0.6);
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
  const cSafe = new THREE.Color(0x25b89a);
  const cBlood = new THREE.Color(0xa01a2e);
  const cw = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const depth = WORLD.waterLevel - terrainHeight(x, z);
    if (depth < 0.22) {
      pos.setY(i, terrainHeight(x, z) - WORLD.waterLevel - 2.5); // sink film
      amp[i] = 0;
    } else {
      amp[i] = clamp(depth / 1.2, 0, 1);
    }
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

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    roughness: 0.3,
    metalness: 0.1,
    // DoubleSide + no depth-write: the surface stays visible from BELOW
    // (round-1 bug: wading the deep channel put the camera under the
    // single-sided plane and the water "vanished")
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.waterLevel;
  mesh.name = 'water';
  scene.add(mesh);

  // gentle swell so the river reads as liquid even without textures;
  // depth-scaled so puddle edges hold still instead of pulsing
  const base = geo.attributes.position.array.slice();
  mesh.userData.tick = (t) => {
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

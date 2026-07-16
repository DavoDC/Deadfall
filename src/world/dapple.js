// Dappled canopy light - round 4's highest-leverage item. Real jungle light
// is a texture: hot shafts stab through gaps in the canopy while the
// understory pools in shadow. This module injects a world-space "sun through
// leaves" term into ground-level materials: a procedural gap field (the
// canopy-hole model) ADDS sun-coloured irradiance in hot pools. Additive
// only - dappling raises the peaks in the gaps, it NEVER lowers the dark
// floor (HARD GATE: the round-1 "too dark" failure must not re-run).
//
// The gap field is scaled by a baked moisture texture: dapple lives where
// the canopy lives (moist dense jungle), not on the open mesa or dry ridge,
// so exposed rock never turns blotchy.

import * as THREE from 'three';
import { WORLD, moisture } from './heightmap.js';

// Shared uniforms - one set for every dappled material, updated per-frame.
// Exported onto window.__deadfall for live art tuning from the console.
export const uniforms = {
  uDappleTime: { value: 0 },
  uDappleDebug: { value: 0 },
  // flat additive floor inside a shaft: even a near-black leaf GLOWS when a
  // sunbeam hits it (translucency) - pure albedo scaling cannot lift the
  // dark understory, which is exactly where the shafts must read
  uDappleLift: { value: 0.035 },
  uDappleGain: { value: 1.0 },
  uSunSlope: { value: new THREE.Vector2(0, 0) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uDappleColor: { value: new THREE.Color(1, 1, 1) },
  uDappleMask: { value: null },
  uDappleWorldSize: { value: 1 },
};

// Bake the analytic moisture field into a small texture the shader can
// sample - canopy density correlates with moisture (the vegetation scatter
// uses the same field), so this is "where the canopy is" for free.
function bakeMoistureMask() {
  const size = 128;
  const data = new Uint8Array(size * size);
  const span = WORLD.size;
  for (let iz = 0; iz < size; iz++) {
    for (let ix = 0; ix < size; ix++) {
      const x = (ix / (size - 1) - 0.5) * span;
      const z = (iz / (size - 1) - 0.5) * span;
      // below 0.35 moisture the canopy is sparse - no dapple
      const m = Math.max(0, Math.min(1, (moisture(x, z) - 0.35) / 0.5));
      data[iz * size + ix] = Math.round(m * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const GLSL_COMMON = /* glsl */ `
  varying vec3 vDappleWP;
  uniform float uDappleTime;
  uniform float uDappleDebug;
  uniform float uDappleLift;
  uniform float uDappleGain;
  uniform vec2 uSunSlope;
  uniform vec3 uSunDir;
  uniform vec3 uDappleColor;
  uniform sampler2D uDappleMask;
  uniform float uDappleWorldSize;

  float dappleHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float dappleNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dappleHash(i), dappleHash(i + vec2(1.0, 0.0)), u.x),
      mix(dappleHash(i + vec2(0.0, 1.0)), dappleHash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
  // 0..1 canopy-gap field: broad pools with sharp cores, projected along
  // the sun ray so a shaft lines up vertically (a trunk and the ground
  // under it share the same beam).
  float dappleField(vec3 wp) {
    vec2 q = wp.xz + uSunSlope * wp.y;
    // the canopy breathes: gaps drift slowly as if leaves sway
    q += vec2(sin(uDappleTime * 0.29), cos(uDappleTime * 0.23)) * 1.1;
    float n = dappleNoise(q * 0.055) * 0.56 + dappleNoise(q * 0.17) * 0.44;
    float pool = smoothstep(0.58, 0.80, n);      // broad soft pool
    float core = smoothstep(0.72, 0.92, n);      // hot centre
    float mask = texture2D(uDappleMask, wp.xz / uDappleWorldSize + 0.5).r;
    return (pool * 0.45 + core * 0.9) * mask;
  }
`;

// Inject the dapple term into a MeshStandardMaterial. Composes with any
// existing onBeforeCompile (windify's sway) by chaining.
export function dapplify(mat) {
  // bake eagerly - the mask must exist even if the rAF loop never runs
  // (hidden tabs pause rAF; the screenshot rig renders manually)
  if (!uniforms.uDappleMask.value) {
    uniforms.uDappleMask.value = bakeMoistureMask();
    uniforms.uDappleWorldSize.value = WORLD.size;
  }
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDappleWP;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 dwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            dwp = instanceMatrix * dwp;
          #endif
          dwp = modelMatrix * dwp;
          vDappleWP = dwp.xyz;
        }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_COMMON}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
        {
          float dap = dappleField(vDappleWP) * uDappleGain;
          // shafts come from the sun's direction: surfaces facing the sun
          // catch them fully, undersides do not (leaves use abs - both
          // sides of a frond light up when a beam hits it). NOTE: 'normal'
          // here is VIEW space, so the world-space sun dir must be rotated
          // into view space before the dot.
          vec3 sunDirView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float facing = dot(normal, sunDirView);
          #ifdef DOUBLE_SIDED
            facing = abs(facing);
          #else
            facing = saturate(facing);
          #endif
          vec3 dappleIrradiance = uDappleColor * (dap * facing);
          reflectedLight.indirectDiffuse += dappleIrradiance
            * (BRDF_Lambert(diffuseColor.rgb) + vec3(uDappleLift));
          // DEBUG scaffolding (uDappleDebug: 1=dap, 2=facing, 3=mask, 4=wp)
          if (uDappleDebug > 0.5 && uDappleDebug < 1.5) reflectedLight.indirectDiffuse += vec3(5.0, 0.0, 5.0) * dap;
          if (uDappleDebug > 1.5 && uDappleDebug < 2.5) reflectedLight.indirectDiffuse += vec3(5.0, 0.0, 5.0) * facing;
          if (uDappleDebug > 2.5 && uDappleDebug < 3.5) reflectedLight.indirectDiffuse += vec3(5.0, 0.0, 5.0) * texture2D(uDappleMask, vDappleWP.xz / uDappleWorldSize + 0.5).r;
          if (uDappleDebug > 3.5) reflectedLight.indirectDiffuse += abs(vDappleWP) * 0.02;
        }`);
  };
  // distinct program per (windify strength x dapple) combination - windify
  // bakes its strength into the shader STRING, so materials with different
  // sway strengths must never share a compiled program
  mat.customProgramCacheKey = () =>
    'dapple|sway' + (mat.userData.swayStrength || 0);
  return mat;
}

// Sun-tracking uniform update. Called from applyMood (so captures are
// correct even with the rAF loop paused) AND per-frame from main.js (so
// storms dim the shafts live). sunPos is the mood's sun offset.
export function updateDappleSun(sunPos, sunColor, sunIntensity) {
  if (sunPos) {
    // slope of the light ray: how far the gap pattern shifts per metre of
    // height, and the normalized direction toward the sun
    uniforms.uSunSlope.value.set(sunPos[0] / sunPos[1], sunPos[2] / sunPos[1]);
    const len = Math.hypot(sunPos[0], sunPos[1], sunPos[2]);
    uniforms.uSunDir.value.set(sunPos[0] / len, sunPos[1] / len, sunPos[2] / len);
  }
  if (sunColor !== undefined && sunIntensity !== undefined) {
    // NB: the shader multiplies this by BRDF_Lambert (albedo / PI, roughly
    // 0.05 on the dark understory), so the irradiance here must be LARGE
    // for a shaft to visibly lift a surface out of the gloom.
    uniforms.uDappleColor.value.copy(sunColor).multiplyScalar(sunIntensity * 2.2);
  }
}

// Per-frame time advance (the gap pattern drifts as the canopy sways).
export function tickDapple(t) {
  uniforms.uDappleTime.value = t;
}

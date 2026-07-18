// LANTERN MEDUSAE, round 7: alive. Round 5C hung frozen jelly shapes in
// the humid air; David named them directly ("MAKE jellyfish animated
// living floating and fluid"). This module gives the shoal real motion -
// a pulsing bell (slow swell, contraction, recovery), a propulsion bob
// riding the pulse, tendrils that trail the bell with depth-lagged waves,
// slow wander drift, and an emissive glow that breathes with each
// contraction. Everything runs in the vertex shader off one time uniform:
// 800+ medusae animate with zero per-frame CPU.
//
// Bell and tendrils are two instanced meshes sharing the same instance
// transforms; the drift/bob GLSL is identical on both (same instance
// position in, same offset out) so the tendrils stay rooted to the rim.

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, terrainHeight } from './heightmap.js';
import { makeRng } from '../core/rng.js';

const mats = [];

// Shared per-instance motion. ph: stable phase from instance grid position.
// c: this medusa's pulse clock. s: raw pulse wave. drift/bob applied in
// LOCAL space (pre-instanceMatrix) - the instance rotation is a small tilt
// and the scale is uniform, so the offset survives as a world wander.
const MOTION_GLSL = /* glsl */ `
  vec2 iwp = instanceMatrix[3].xz;
  float ph = fract(sin(dot(iwp, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float spd = 0.55 + fract(ph * 0.731) * 0.4;
  float c = uTime * spd + ph;
  // asymmetric pulse: slow fill, brisk contraction (real medusae push
  // hard and relax slow) - sharpen the positive half of the wave
  float sraw = sin(c);
  float s = sign(sraw) * pow(abs(sraw), 0.7);
  vec2 drift = vec2(sin(uTime * 0.11 + ph * 3.0), cos(uTime * 0.09 + ph * 5.0)) * 0.85;
  // each contraction kicks the medusa up; between pulses it settles,
  // plus a slow long-period rise and fall of the whole animal
  float bob = sin(c - 1.25) * 0.22 + sin(uTime * 0.21 + ph * 7.0) * 0.35;
`;

function addTimeUniform(shader) {
  shader.uniforms.uTime = { value: 0 };
}

function bellGeo() {
  const parts = [];
  const bell = new THREE.SphereGeometry(0.5, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62);
  bell.scale(1, 0.78, 1);
  // scalloped rim: the bell edge waves gently instead of a perfect circle
  {
    const pos = bell.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const rimness = THREE.MathUtils.clamp((0.18 - y) / 0.3, 0, 1);
      const a = Math.atan2(z, x);
      const k = 1 + Math.sin(a * 7) * 0.05 * rimness;
      pos.setXYZ(i, x * k, y - Math.sin(a * 7) * 0.03 * rimness, z * k);
    }
    bell.computeVertexNormals();
  }
  parts.push(bell);
  const skirt = new THREE.TorusGeometry(0.42, 0.05, 5, 10);
  skirt.rotateX(Math.PI / 2);
  skirt.translate(0, -0.12, 0);
  parts.push(skirt);
  return BufferGeometryUtils.mergeGeometries(parts);
}

function tendrilGeo() {
  const parts = [];
  // six trailing tendrils from the rim ring
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const len = 1.7 + (i % 3) * 0.4;
    const t = new THREE.CylinderGeometry(0.007, 0.02, len, 4, 10, true);
    t.translate(0, -len / 2 - 0.14, 0);
    const r = 0.3;
    t.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(t);
  }
  // two thicker central oral arms
  for (let i = 0; i < 2; i++) {
    const len = 1.15 + i * 0.3;
    const t = new THREE.CylinderGeometry(0.016, 0.045, len, 5, 8, true);
    t.translate(0, -len / 2 - 0.1, 0);
    t.translate(i === 0 ? 0.08 : -0.07, 0, i === 0 ? -0.06 : 0.07);
    parts.push(t);
  }
  return BufferGeometryUtils.mergeGeometries(parts);
}

function animateBell(mat) {
  mat.onBeforeCompile = (shader) => {
    addTimeUniform(shader);
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          ${MOTION_GLSL}
          // the bell: rim flares out on the fill, snaps in on the push;
          // apex stays firm (weight the squeeze by depth below the apex)
          float rimW = clamp((0.34 - position.y) / 0.6, 0.15, 1.0);
          transformed.xz *= 1.0 + 0.16 * s * rimW;
          transformed.y *= 1.0 - 0.11 * s;
          transformed.xz += drift;
          transformed.y += bob;
          // glow breathes with the contraction
          vGlow = 0.72 + 0.55 * max(0.0, -s);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= vGlow;`);
  };
  mat.customProgramCacheKey = () => 'medusa-bell';
  mats.push(mat);
  return mat;
}

function animateTendrils(mat) {
  mat.onBeforeCompile = (shader) => {
    addTimeUniform(shader);
    mat.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          ${MOTION_GLSL}
          // depth down the tendril: 0 at the rim, 1 at the deepest tip
          float d = clamp(-transformed.y / 2.4, 0.0, 1.0);
          // rim follows the bell's flare; tips lag the pulse and whip
          float lag = sin(c - 1.1 - d * 2.6);
          transformed.xz *= 1.0 + 0.16 * mix(s, lag * 0.55, d);
          // free trailing wave, stronger toward the tips
          transformed.x += sin(uTime * 0.9 + ph * 2.0 + d * 3.3) * 0.16 * d;
          transformed.z += cos(uTime * 0.73 + ph * 3.1 + d * 2.8) * 0.13 * d;
          // tips also ride the bob late - the trail streams behind
          transformed.xz += drift;
          transformed.y += bob + sin(c - 1.9) * 0.08 * d;
          vGlow = 0.6 + 0.45 * max(0.0, -lag);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= vGlow;`);
  };
  mat.customProgramCacheKey = () => 'medusa-tendril';
  mats.push(mat);
  return mat;
}

// Same placement contract the round-5C vegetation scatter used: shoals of
// 1-3 hanging 5-9m over the wet lowlands. Seed offset unchanged so the
// shoal keeps its familiar homes.
export function buildMedusae(scene) {
  const rng = makeRng(WORLD.seed + 127);
  const cell = 17;
  const half = WORLD.playable + 24;
  const transforms = [];
  const colors = [];
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _e = new THREE.Euler();
  const cTmp = new THREE.Color();

  for (let gx = -half; gx < half; gx += cell) {
    for (let gz = -half; gz < half; gz += cell) {
      const x = gx + rng.next() * cell;
      const z = gz + rng.next() * cell;
      const h = terrainHeight(x, z);
      if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.playable) continue;
      if (h > WORLD.waterLevel + 6) continue;
      if (rng.next() > 0.55) continue;
      const n = 1 + Math.floor(rng.next() * 3);
      for (let i = 0; i < n; i++) {
        const jx = x + rng.range(-3, 3);
        const jz = z + rng.range(-3, 3);
        const jy = Math.max(terrainHeight(jx, jz), WORLD.waterLevel) + 5 + rng.next() * 4;
        const s = 0.5 + rng.next() * 0.9;
        _e.set((rng.next() - 0.5) * 0.24, rng.next() * Math.PI * 2, (rng.next() - 0.5) * 0.24);
        _q.setFromEuler(_e);
        _m.compose(_p.set(jx, jy, jz), _q, _s.set(s, s, s));
        transforms.push(_m.clone());
        cTmp.setHSL(rng.pick([0.5, 0.55, 0.8, 0.88]), 0.75, 0.6 + rng.next() * 0.15);
        colors.push(cTmp.clone());
      }
    }
  }

  const bellMat = animateBell(new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0x4fd8f0, emissiveIntensity: 1.8,
    roughness: 0.3, transparent: true, opacity: 0.82, side: THREE.DoubleSide,
    depthWrite: false,
  }));
  const tendrilMat = animateTendrils(new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0x4fd8f0, emissiveIntensity: 1.3,
    roughness: 0.4, transparent: true, opacity: 0.66, side: THREE.DoubleSide,
    depthWrite: false,
  }));

  const meshes = [];
  for (const [geo, mat] of [[bellGeo(), bellMat], [tendrilGeo(), tendrilMat]]) {
    const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
    for (let i = 0; i < transforms.length; i++) {
      mesh.setMatrixAt(i, transforms[i]);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'medusae';
    scene.add(mesh);
    meshes.push(mesh);
  }
  console.log('[deadfall] medusae', transforms.length);
  return { count: transforms.length, meshes };
}

export function tickMedusae(t) {
  for (const m of mats) {
    if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
  }
}

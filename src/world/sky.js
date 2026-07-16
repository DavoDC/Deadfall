// Sky dome, fog and lighting - the AMAZONIAN FEVER-DREAM (locked art
// direction, round 2). Vibrant, saturated, multicoloured: the fog is still
// the dread, but it is bright fog - colour swallowing the distance, never
// grey murk. Shadow floors are lifted so nothing crushes to black (the
// round-1 "too dark to see enemies" fix lives here).

import * as THREE from 'three';
import { updateDappleSun } from './dapple.js';

// Per-run atmosphere moods - same jungle, different fever. Picked at run
// start; the violet mood also brings glittering drizzle.
export const MOODS = {
  bloom: {
    label: 'MORNING BLOOM',
    fogColor: 0xa2d8b8,      // bright mint haze
    fogDensity: 0.016,
    sunColor: 0xfff2c8,
    sunIntensity: 2.9,
    sunPos: [-140, 180, 90],
    hemiSky: 0xc2ecd4,
    hemiGround: 0x5d7c48,    // lifted shadow floor - foliage never black
    hemiIntensity: 1.35,
    skyTop: 0x6cc4e8,        // turquoise zenith
    drizzle: false,
  },
  gold: {
    label: 'GOLDEN HOUR',
    fogColor: 0xe8bc86,      // amber light in the air itself
    fogDensity: 0.017,
    sunColor: 0xffae54,
    sunIntensity: 3.1,
    sunPos: [-220, 85, 40],  // low western sun, long warm shadows
    hemiSky: 0xf0cf9e,
    hemiGround: 0x6c5a80,    // violet shadow tint, not mud
    hemiIntensity: 1.25,
    skyTop: 0xf09a5e,
    drizzle: false,
  },
  violet: {
    label: 'VIOLET FEVER',
    fogColor: 0xc7a4de,      // bright orchid haze
    fogDensity: 0.02,
    sunColor: 0xf2dcff,
    sunIntensity: 2.3,
    sunPos: [-80, 220, 40],
    hemiSky: 0xdcc0ec,
    hemiGround: 0x4c7060,    // emerald bounce
    hemiIntensity: 1.4,
    skyTop: 0x8f6ed8,
    drizzle: true,
  },
};

export const ATMOS = { ...MOODS.bloom };

export function buildSky(scene, renderer) {
  scene.fog = new THREE.FogExp2(ATMOS.fogColor, ATMOS.fogDensity);
  scene.background = new THREE.Color(ATMOS.fogColor);

  const hemi = new THREE.HemisphereLight(ATMOS.hemiSky, ATMOS.hemiGround, ATMOS.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(ATMOS.sunColor, ATMOS.sunIntensity);
  sun.position.set(...ATMOS.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 420;
  // shadow frustum follows the player (retargeted each frame from main.js)
  const s = 70;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.5;
  scene.add(sun);
  scene.add(sun.target);

  // gradient dome: hazy bright horizon -> saturated fever zenith
  const skyGeo = new THREE.SphereGeometry(1600, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(ATMOS.skyTop) },
      horizonColor: { value: new THREE.Color(ATMOS.fogColor) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vDir;
      void main() {
        float t = smoothstep(0.0, 0.5, vDir.y);
        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'sky';
  scene.add(sky);

  updateDappleSun(ATMOS.sunPos, sun.color, ATMOS.sunIntensity);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  function applyMood(mood) {
    Object.assign(ATMOS, mood);
    scene.fog.color.set(mood.fogColor);
    scene.fog.density = mood.fogDensity;
    scene.background.set(mood.fogColor);
    hemi.color.set(mood.hemiSky);
    hemi.groundColor.set(mood.hemiGround);
    hemi.intensity = mood.hemiIntensity;
    sun.color.set(mood.sunColor);
    sun.intensity = mood.sunIntensity;
    skyMat.uniforms.topColor.value.set(mood.skyTop);
    skyMat.uniforms.horizonColor.value.set(mood.fogColor);
    // keep the canopy dapple in step with the mood's sun (must not depend
    // on the rAF loop - the screenshot rig applies moods with rAF paused)
    updateDappleSun(mood.sunPos, sun.color, mood.sunIntensity);
  }

  return { sun, hemi, sky, applyMood };
}

// Keep the shadow camera centred on the player so near-field shadows stay sharp.
export function trackShadow(sun, target) {
  sun.position.set(
    target.x + ATMOS.sunPos[0],
    ATMOS.sunPos[1],
    target.z + ATMOS.sunPos[2]
  );
  sun.target.position.set(target.x, 0, target.z);
  sun.target.updateMatrixWorld();
}

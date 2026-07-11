// Sky dome, fog and lighting. Late-afternoon jungle: warm low sun, green
// murk swallowing the distance. The fog IS the dread - sightlines end in it.

import * as THREE from 'three';

// Per-run atmosphere moods - same jungle, different day. Picked at run
// start; the mist mood also brings drizzle.
export const MOODS = {
  afternoon: {
    label: 'LATE AFTERNOON',
    fogColor: 0x93ac7e,
    fogDensity: 0.019,
    sunColor: 0xffe0b0,
    sunIntensity: 2.6,
    sunPos: [-140, 180, 90],
    hemiSky: 0xc2d8aa,
    hemiGround: 0x46523a,
    hemiIntensity: 1.05,
    skyTop: 0xa8c4b2,
    drizzle: false,
  },
  dusk: {
    label: 'DUSK',
    fogColor: 0x97846b,
    fogDensity: 0.021,
    sunColor: 0xffb070,
    sunIntensity: 2.0,
    sunPos: [-220, 70, 40], // low western sun, long shadows
    hemiSky: 0xa89882,
    hemiGround: 0x42423a,
    hemiIntensity: 0.95,
    skyTop: 0x93a0b0,
    drizzle: false,
  },
  mist: {
    label: 'GREY MIST',
    fogColor: 0x9aa79a,
    fogDensity: 0.03,
    sunColor: 0xd8dcd0,
    sunIntensity: 1.5,
    sunPos: [-80, 220, 40],
    hemiSky: 0xb8c2b4,
    hemiGround: 0x3f463a,
    hemiIntensity: 1.15,
    skyTop: 0xaab4aa,
    drizzle: true,
  },
};

export const ATMOS = { ...MOODS.afternoon };

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

  // gradient dome: hazy warm horizon -> pale green-blue zenith
  const skyGeo = new THREE.SphereGeometry(1600, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0xa8c4b2) },
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

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

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

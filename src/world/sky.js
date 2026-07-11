// Sky dome, fog and lighting. Late-afternoon jungle: warm low sun, green
// murk swallowing the distance. The fog IS the dread - sightlines end in it.

import * as THREE from 'three';

export const ATMOS = {
  fogColor: 0x9db98a,
  fogDensity: 0.0165,
  sunColor: 0xffe0b0,
  sunIntensity: 2.6,
  hemiSky: 0xbcd6a0,
  hemiGround: 0x2c3a20,
  hemiIntensity: 0.75,
};

export function buildSky(scene, renderer) {
  scene.fog = new THREE.FogExp2(ATMOS.fogColor, ATMOS.fogDensity);
  scene.background = new THREE.Color(ATMOS.fogColor);

  const hemi = new THREE.HemisphereLight(ATMOS.hemiSky, ATMOS.hemiGround, ATMOS.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(ATMOS.sunColor, ATMOS.sunIntensity);
  sun.position.set(-140, 180, 90);
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
      topColor: { value: new THREE.Color(0x8fb8c9) },
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

  return { sun, hemi, sky };
}

// Keep the shadow camera centred on the player so near-field shadows stay sharp.
export function trackShadow(sun, target) {
  sun.position.set(target.x - 140, 180, target.z + 90);
  sun.target.position.set(target.x, 0, target.z);
  sun.target.updateMatrixWorld();
}

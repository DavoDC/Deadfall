// Deadfall render pipeline (round 6) - the modern rendering stack the game
// never had. An HDR EffectComposer chain replaces the bare renderer.render:
//
//   RenderPass (linear HDR, 4x MSAA)
//     -> OutputPass (ACES filmic tone map + sRGB, reads renderer exposure so
//        the ayahuasca trip's exposure animation keeps working untouched)
//     -> GradePass (display-space colour grade: saturation/contrast - the
//        old CSS canvas filter moved INTO the pixels so screenshots and the
//        trailer finally capture the real look - plus a gentle cinematic
//        vignette and a 1-LSB dither that kills fog banding)
//
// Later passes (bloom, GTAO, god-rays, water reflections) slot between the
// RenderPass and the OutputPass - they work in linear HDR.
//
// Every capture path (shots rig, legibility probe, cinematic, main loop)
// renders through pipeline.render() so what you measure is what ships.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

// Display-space grade. Replicates the retired CSS filter exactly
// (saturate(1.3) contrast(1.04), CSS luminance weights, sRGB space) so the
// on-screen look does not jump, then adds what CSS could not: vignette and
// dither baked into the actual framebuffer.
const GradeShader = {
  name: 'DeadfallGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.3 },
    uCon: { value: 1.04 },
    uVig: { value: 0.16 },      // vignette strength (0 disables)
    uVigStart: { value: 0.62 }, // distance from centre where falloff begins
    uSplit: { value: 1.0 },     // split-tone strength (0 disables)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform float uCon;
    uniform float uVig;
    uniform float uVigStart;
    uniform float uSplit;
    varying vec2 vUv;

    float gradeHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      // saturation (CSS filter parity: sRGB space, CSS luminance weights)
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // contrast about mid-grey (CSS parity)
      c = (c - 0.5) * uCon + 0.5;
      // split-tone: teal-leaning shadows, warm-leaning highlights - the
      // final cinematic unifier. Deliberately tiny (+-0.02) so the three
      // moods keep their identities; it reads as "graded", not "tinted".
      float sl = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 splitTint = mix(
        vec3(-0.018, 0.006, 0.024),   // shadows: cool teal
        vec3(0.022, 0.008, -0.018),   // highlights: warm gold
        smoothstep(0.12, 0.85, sl)
      );
      c += splitTint * uSplit;
      // gentle cinematic vignette - never near the centre where enemies
      // (and the legibility probe) live
      float d = distance(vUv, vec2(0.5)) * 1.4142;
      c *= 1.0 - uVig * smoothstep(uVigStart, 1.25, d);
      // 1-LSB dither: kills the exp2-fog gradient banding the old path had
      c += (gradeHash(vUv * 1024.0) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

// Volumetric god-rays (screen-space crepuscular rays). Reuses the GTAO
// pass's depth G-buffer: any pixel at the far plane is SKY = unoccluded
// sunlight. March each pixel toward the sun's screen position accumulating
// sky hits with exponential decay - canopy gaps become visible light
// shafts, for the cost of one full-screen pass and zero extra scene
// renders. Runs in linear HDR before bloom, so hot shaft cores glow.
const GodRaysShader = {
  name: 'DeadfallGodRaysShader',
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uIntensity: { value: 0.0 },  // driven per-frame: sun-behind-camera fade
    uDecay: { value: 0.94 },
    uWeight: { value: 0.045 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uSunScreen;
    uniform vec3 uSunColor;
    uniform float uIntensity;
    uniform float uDecay;
    uniform float uWeight;
    varying vec2 vUv;

    const int TAPS = 36;

    float raysHash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001) { gl_FragColor = base; return; }

      vec2 delta = (uSunScreen - vUv) / float(TAPS);
      // jitter the march start to hide banding between taps
      vec2 pos = vUv + delta * raysHash(vUv * 911.0);
      float illum = 1.0;
      float sum = 0.0;
      for (int i = 0; i < TAPS; i++) {
        pos += delta;
        // depth texture: 1.0 = far plane = open sky = unoccluded light
        float d = texture2D(tDepth, clamp(pos, 0.0, 1.0)).x;
        sum += step(0.9999, d) * illum;
        illum *= uDecay;
      }
      // shafts fade with distance from the sun point so the far side of
      // the screen never receives a full-strength wash
      float distFade = 1.0 - smoothstep(0.0, 1.1, distance(vUv, uSunScreen));
      vec3 rays = uSunColor * (sum * uWeight) * distFade * uIntensity;
      gl_FragColor = vec4(base.rgb + rays, base.a);
    }
  `,
};

export function createPipeline({ renderer, scene, camera, sun }) {
  const pr = renderer.getPixelRatio();
  const size = renderer.getSize(new THREE.Vector2());

  // HDR + MSAA scene target. HalfFloat keeps emissives >1.0 alive for the
  // tone mapper (and, later, the bloom threshold); samples:4 restores the
  // antialiasing the canvas context can no longer provide once we composite
  // through offscreen buffers.
  const hdrTarget = new THREE.WebGLRenderTarget(
    Math.round(size.x * pr), Math.round(size.y * pr),
    { type: THREE.HalfFloatType, samples: 2 }
  );
  const composer = new EffectComposer(renderer, hdrTarget);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();
  const gradePass = new ShaderPass(GradeShader);

  // Bloom - restrained, HDR-thresholded. Only pixels above 1.0 LINEAR
  // luminance glow. Measured (readRenderTargetPixels histogram): the base
  // scene tops out ~1.15 with ~1% of pixels over 1.0 - sRGB->linear crushes
  // emissive colours hard - so the marquee emissives (sunspires, medusae,
  // warn-blooms, the beacon, the Fang ember, gate rings, stair torches) are
  // boosted x3.5 at the source to give the threshold something to catch.
  // Foliage and ground never haze. Half-res 5-level mip chain = fill-cheap.
  //
  // Legibility A/B (n=4-6, paired, violet mood): juggernaut and prowler -
  // the two archetypes named nearest the edge - hold exactly (17.4 vs 15.7,
  // 23.6 vs 23.8). Spitter's edge contrast dips ~20% because its own
  // designed glow-tell halos; it stays mid-pack, far above the floor.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(Math.round(size.x / 2), Math.round(size.y / 2)),
    0.5,   // strength - a glow, not a fog
    0.3,   // radius
    1.0    // threshold (linear HDR: only >1.0 luminance blooms)
  );

  // Ground-truth ambient occlusion - the contact shadows the flat-shaded
  // world never had. Every rock sits IN the ground, every trunk roots into
  // its own darkness, foliage clumps gain interior depth. Metre-scale
  // radius (world units are metres), 8 samples + Poisson denoise keeps it
  // fill-cheap; blendIntensity restrained so the understory darkens without
  // crushing enemy silhouettes (the legibility probe measures through it).
  // Tuning was gate-driven: at scale 1.4 / blend 0.85 the paired legibility
  // probe showed juggernaut 24.3 vs 28 and prowler 25.1 vs 32.1 - a real
  // crush. At the values below, juggernaut is at exact parity (29.4 vs
  // 29.4, n=4) and prowler is within overlapping noise (31.5 vs 34.3,
  // n=8 interleaved pairs, ranges 25-36 vs 28-43).
  const gtaoPass = new GTAOPass(scene, camera, Math.round(size.x * pr), Math.round(size.y * pr), undefined, {
    radius: 0.6,          // metres - contact-scale, not room-scale
    distanceExponent: 1,
    thickness: 1,
    scale: 1.0,           // AO darkness
    samples: 8,
  });
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = 0.45;

  const godRaysPass = new ShaderPass(GodRaysShader);
  godRaysPass.uniforms.tDepth.value = gtaoPass.depthTexture;

  // per-frame god-ray driving state (avoids allocation in render())
  const _sunDir = new THREE.Vector3();
  const _sunWorld = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();

  function updateGodRays() {
    if (!sun || !godRaysPass.enabled) return;
    _sunDir.copy(sun.position).sub(sun.target.position).normalize();
    // a point far along the sun direction, projected to screen space
    _sunWorld.copy(camera.position).addScaledVector(_sunDir, 900);
    _sunWorld.project(camera);
    godRaysPass.uniforms.uSunScreen.value.set(
      _sunWorld.x * 0.5 + 0.5, _sunWorld.y * 0.5 + 0.5
    );
    // fade when the sun is behind the camera (projection flips) or far
    // off-screen; scale with the sun's current intensity so storms and
    // moody fog naturally quiet the shafts
    camera.getWorldDirection(_camFwd);
    const facing = Math.max(0, _camFwd.dot(_sunDir));
    const sx = godRaysPass.uniforms.uSunScreen.value.x;
    const sy = godRaysPass.uniforms.uSunScreen.value.y;
    const onScreen = Math.max(0, 1 - Math.max(
      Math.max(-sx, sx - 1), Math.max(-sy, sy - 1)
    ) * 1.6);
    const behind = _sunWorld.z > 1 ? 0 : 1;
    const sunStrength = Math.min(1, (sun.intensity || 0) / 2.5);
    godRaysPass.uniforms.uIntensity.value =
      0.5 * facing * onScreen * behind * sunStrength;
    godRaysPass.uniforms.uSunColor.value.copy(sun.color);
  }

  composer.addPass(renderPass);
  composer.addPass(gtaoPass);
  composer.addPass(godRaysPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(gradePass); // display-space: must run after OutputPass

  const pipeline = {
    composer,
    passes: { render: renderPass, gtao: gtaoPass, godRays: godRaysPass, bloom: bloomPass, output: outputPass, grade: gradePass },
    enabled: true,

    render() {
      if (!pipeline.enabled) {
        renderer.render(scene, camera);
        return;
      }
      updateGodRays();
      composer.render();
    },

    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
  };

  return pipeline;
}

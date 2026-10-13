// Terrain mesh built from the analytic heightmap, coloured per-vertex by
// height / moisture / slope so the three routes read at a glance:
// dark boggy swamp, olive riverbed, khaki-rock ridge, deep green jungle floor.
// Textures are blended with vertex colours to preserve the vibrant palette.
// Triplanar mapping prevents stretching on slopes.

import * as THREE from 'three';
import {
  WORLD, terrainHeight, moisture, terrainNormal, razorfinHazard,
  floodMask, gorgeZ, FLOOD,
} from './heightmap.js';
import { clamp, lerp, smoothstep, valueNoise, fbm } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
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
  // Round 7 "living world": 448 segs (1.7m/vert, was 2.4m) + micro-relief
  // noise so terrain silhouettes stop reading as smooth polygon curves.
  // The relief is VISUAL only (small vs the 1.66m eye height) - gameplay
  // still samples the analytic terrainHeight, colliders unchanged.
  const segs = 448;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const moistAttr = new Float32Array(pos.count);
  const slopeAttr = new Float32Array(pos.count);
  const c = new THREE.Color();
  const n = { x: 0, y: 1, z: 0 };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let h = terrainHeight(x, z);

    terrainNormal(x, z, n);
    const m = moisture(x, z);
    const slope = 1 - n.y;

    // Micro-relief: lumpy soil on flats (8cm), rubble on rock slopes (up
    // to 28cm). Suppressed near the waterline so shore bands stay clean,
    // and where the plane sits underwater (z-fight safety with the river).
    const nearWater = smoothstep(WORLD.waterLevel + 1.4, WORLD.waterLevel + 0.2, h);
    const reliefAmp = (0.08 + slope * 0.6 + (h > 17 ? 0.1 : 0)) * (1 - nearWater);
    if (reliefAmp > 0.001) {
      const r1 = fbm(x * 0.55, z * 0.55, 733, 2) - 0.5;
      const r2 = valueNoise(x * 1.7, z * 1.7, 977) - 0.5;
      h += (r1 * 0.75 + r2 * 0.45) * reliefAmp * 2;
    }
    pos.setY(i, h);
    moistAttr[i] = m;
    slopeAttr[i] = slope;

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
  geo.setAttribute('aMoist', new THREE.BufferAttribute(moistAttr, 1));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slopeAttr, 1));
  geo.computeVertexNormals();

  // Round 7 ground rewrite: the old single tiled mud texture (whose
  // per-vertex "UV bombing" offsets interpolated across triangles and
  // SMEARED the map into directional streaks) is gone. The ground is now
  // shaded fully procedurally in-fragment: four layers (grass clumps,
  // bare soil, rock, wet mud) blended by the same moisture/slope fields
  // that drive vegetation scatter, plus noise-gradient detail normals so
  // the surface has real small-scale relief response to light.
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    mat.userData.terrShader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMoist;
        attribute float aSlope;
        varying vec3 vTerrWP;
        varying float vMoist;
        varying float vSlope;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vTerrWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vMoist = aMoist;
        vSlope = aSlope;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTerrWP;
        varying float vMoist;
        varying float vSlope;
        float terrHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float terrNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(terrHash(i), terrHash(i + vec2(1.0, 0.0)), u.x),
            mix(terrHash(i + vec2(0.0, 1.0)), terrHash(i + vec2(1.0, 1.0)), u.x),
            u.y);
        }
        float terrFbm(vec2 p) {
          return terrNoise(p) * 0.55 + terrNoise(p * 2.13 + 17.0) * 0.28
               + terrNoise(p * 4.31 + 47.0) * 0.17;
        }
        // detail height field shared by albedo + normal perturbation:
        // soil granules + grass-clump lumps
        float terrDetail(vec2 p) {
          return terrNoise(p * 5.2) * 0.55 + terrFbm(p * 1.15) * 0.45;
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          // noise-gradient detail normal - the ground stops being an
          // optically flat sheet; granules and clumps catch the sun
          vec2 wp = vTerrWP.xz;
          float e = 0.14;
          float d0 = terrDetail(wp);
          float dx = terrDetail(wp + vec2(e, 0.0));
          float dz = terrDetail(wp + vec2(0.0, e));
          // strongest on soft ground, weaker on rock faces (they have
          // real mesh relief) and underwater
          float k = 1.5 * (1.0 - vSlope * 0.6);
          vec3 pert = vec3(-(dx - d0) * k / e, 1.0, -(dz - d0) * k / e);
          vec3 pertView = normalize((viewMatrix * vec4(normalize(pert), 0.0)).xyz);
          // blend detail into the interpolated surface normal
          normal = normalize(mix(normal, normalize(normal + pertView * 1.4), 0.8));
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 wp = vTerrWP.xz;
          // granules: sharp-edged 20cm soil crumbs. Domain-warped so the
          // cell pattern never tiles into a regular cobble read, and mixed
          // with plain noise so it stays crumbly rather than scaly.
          vec2 warp = vec2(terrNoise(wp * 0.7), terrNoise(wp * 0.7 + 31.0)) * 1.6;
          float ridge = 1.0 - abs(terrNoise(wp * 5.2 + warp) * 2.0 - 1.0);
          float grain = mix(terrNoise(wp * 6.1), ridge * ridge, 0.45);
          float micro = terrNoise(wp * 17.0);         // ~6cm speckle
          float fine = terrNoise(wp * 43.0);          // ~2cm dust sparkle
          float clump = terrFbm(wp * 0.85);           // ~1.2m grass clumps
          float mottle = terrFbm(wp * 0.33);          // ~3m mottling, all layers
          float worn = terrFbm(wp * 0.11);            // ~10m worn patches

          // layer masks from the same fields that drive plant scatter
          float grassM = smoothstep(0.32, 0.55, vMoist)
                       * (1.0 - smoothstep(0.18, 0.42, vSlope));
          // worn-through patches: grass gives way to bare soil in blotches
          grassM *= smoothstep(0.24, 0.6, worn * 0.65 + clump * 0.35);
          float rockM = smoothstep(0.3, 0.55, vSlope);
          float wetM = smoothstep(0.75, 0.95, vMoist);

          // grass layer: clumpy, saturated where clumps peak, root-shadow
          // dark in the gaps - reads as growth, not paint
          vec3 grassCol = diffuseColor.rgb
            * mix(vec3(0.64, 0.72, 0.5), vec3(1.2, 1.26, 0.94), clump)
            * (0.9 + micro * 0.2);
          // soil layer: crumbly granules, warmer and browner than grass
          vec3 soilCol = diffuseColor.rgb * vec3(1.1, 0.88, 0.66)
            * (0.68 + grain * 0.36 + micro * 0.18 + fine * 0.1);
          // scattered pale stones half-buried in the soil (bare ground
          // only - turf swallows them), kept low-contrast so they read as
          // embedded pebbles, not scattered marshmallows
          float stone = smoothstep(0.8, 0.88, terrNoise(wp * 3.1));
          soilCol = mix(soilCol, vec3(0.52, 0.49, 0.44) * (0.75 + micro * 0.4), stone * 0.55);
          // rock layer: banded strata + speckle
          float band = terrNoise(vec2(vTerrWP.y * 1.7 + terrFbm(wp * 0.4) * 2.2, wp.x * 0.05));
          vec3 rockCol = diffuseColor.rgb * (0.74 + band * 0.4 + micro * 0.18);
          // wet mud: darker, bluer, smooth
          vec3 mudCol = diffuseColor.rgb * vec3(0.68, 0.68, 0.78)
            * (0.8 + grain * 0.24 + micro * 0.08);

          vec3 ground = mix(soilCol, grassCol, grassM);
          ground = mix(ground, mudCol, wetM * (1.0 - rockM));
          ground = mix(ground, rockCol, rockM);
          // large-scale mottling breaks the "one texture" vista read
          ground *= 0.86 + mottle * 0.3;
          diffuseColor.rgb = ground;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          // wet lowland mud takes a sheen; everything else stays matte
          float wetR = smoothstep(0.75, 0.98, vMoist);
          roughnessFactor = mix(roughnessFactor, 0.55, wetR * 0.8);
        }`);
  };
  dapplify(mat);
  mat.customProgramCacheKey = () => 'terrain-r7|dapple';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  return mesh;
}

export function buildWater(scene) {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 128, 128);
  geo.rotateX(-Math.PI / 2);

  // ROUND 9 WATER LAW: water is a VOLUME filling basins to a level, not a
  // sheet draped over terrain. The mesh stays FLAT at the effective water
  // level everywhere (flood rise included); a baked ground-height texture
  // lets the fragment shader compute true depth per PIXEL and discard where
  // the level meets rising ground. The shoreline is therefore the exact
  // terrain contour line - no more 6m-grid straight edges, and no more
  // "water mound" sheets riding up slopes (playtest 2026-07-19, 23,143 and
  // 14,-85). The old sunk-vertex "dry film" hack is gone entirely.
  //
  // per-vertex colour: living teal water, blooming BLOOD RED over the
  // razorfin gorge AND the Sunken Maw (the boss's moat) - hazards
  // telegraph themselves from a distance.
  const pos = geo.attributes.position;
  const wCol = new Float32Array(pos.count * 3);
  const amp = new Float32Array(pos.count);
  const cSafe = new THREE.Color(0x25b89a);
  const cBlood = new THREE.Color(0xa01a2e);
  const cw = new THREE.Color();
  // per-vertex caches for the FLOOD (round 5): ground height, the flood-
  // zone mask, the resting blood tint and the distance to the gorge line -
  // everything setFlood needs to re-pose the SAME surface at any rise
  // without re-sampling the heightfield
  const hCache = new Float32Array(pos.count);
  const maskCache = new Float32Array(pos.count);
  const blood0 = new Float32Array(pos.count);
  const dGorge = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const hC = terrainHeight(x, z);
    hCache[i] = hC;
    maskCache[i] = floodMask(x, z);
    dGorge[i] = Math.abs(z - gorgeZ(x));
    const depth = WORLD.waterLevel - hC;
    // the plane is FLAT at the level; only the swell amplitude varies.
    // Calm at the shoreline so the waterline holds still against the bank.
    pos.setY(i, 0);
    amp[i] = depth < 0.3 ? 0 : clamp(depth / 1.2, 0, 1);
    const dMaw = Math.hypot(x - WORLD.maw.x, z - WORLD.maw.z);
    const blood = Math.max(
      razorfinHazard(x, z),
      smoothstep(WORLD.maw.r + 6, WORLD.maw.r - 12, dMaw) * 0.85
    );
    blood0[i] = blood;
    cw.copy(cSafe).lerp(cBlood, blood);
    wCol[i * 3] = cw.r;
    wCol[i * 3 + 1] = cw.g;
    wCol[i * 3 + 2] = cw.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));

  // Baked ground-height texture: FloatType, nearest-filtered (manual
  // bilinear in the shader - full float precision, core WebGL2, no
  // extension roulette). 1 texel per 1.5m; the shader's bilinear read
  // turns that into a smooth, curved shoreline contour.
  const HTEX = 512;
  const hData = new Float32Array(HTEX * HTEX);
  {
    const step = WORLD.size / (HTEX - 1);
    const half = WORLD.size / 2;
    for (let j = 0; j < HTEX; j++) {
      const z = -half + j * step;
      for (let i = 0; i < HTEX; i++) {
        hData[j * HTEX + i] = terrainHeight(-half + i * step, z);
      }
    }
  }
  const groundTex = new THREE.DataTexture(
    hData, HTEX, HTEX, THREE.RedFormat, THREE.FloatType
  );
  groundTex.magFilter = THREE.NearestFilter;
  groundTex.minFilter = THREE.NearestFilter;
  groundTex.wrapS = THREE.ClampToEdgeWrapping;
  groundTex.wrapT = THREE.ClampToEdgeWrapping;
  groundTex.needsUpdate = true;

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
    shader.uniforms.uGround = { value: groundTex };
    shader.uniforms.uWorldSize = { value: WORLD.size };
    shader.uniforms.uHTex = { value: HTEX };
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWaterWP;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWaterWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWTime;
        uniform sampler2D uGround;
        uniform float uWorldSize;
        uniform float uHTex;
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
        // three scrolling octaves - broad swell + fine chop + a stretched
        // CURRENT streak riding downstream (round 7: the river flows,
        // it does not just wobble in place)
        float rippleHeight(vec2 p) {
          return waterNoise(p * 0.35 + uWTime * vec2(0.16, 0.06)) * 0.5
               + waterNoise(p * 1.30 - uWTime * vec2(0.11, 0.18)) * 0.32
               + waterNoise(vec2(p.x * 0.22 - uWTime * 0.55, p.y * 1.7)) * 0.18;
        }
        // ground height under world (x,z): manual bilinear over the baked
        // float texture (nearest-filtered taps, full precision everywhere)
        float groundHeight(vec2 wxz) {
          vec2 g = (wxz / uWorldSize + 0.5) * (uHTex - 1.0);
          vec2 g0 = floor(g);
          vec2 f = g - g0;
          vec2 inv = vec2(1.0) / uHTex;
          vec2 uv00 = (g0 + 0.5) * inv;
          float h00 = texture2D(uGround, uv00).r;
          float h10 = texture2D(uGround, uv00 + vec2(inv.x, 0.0)).r;
          float h01 = texture2D(uGround, uv00 + vec2(0.0, inv.y)).r;
          float h11 = texture2D(uGround, uv00 + inv).r;
          return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec2 wp = vWaterWP.xz;
          // TRUE per-pixel depth: water surface height minus the ground
          // under this fragment. Where the level meets rising ground the
          // water ENDS - exactly on the terrain contour line.
          float ground = groundHeight(wp);
          float wDepth = vWaterWP.y - ground;
          if (wDepth < 0.02) discard;
          float depthN = clamp(wDepth / 2.5, 0.0, 1.0);
          // finite-difference gradient of the ripple field -> world normal
          float e = 0.35;
          float h0 = rippleHeight(wp);
          float hx = rippleHeight(wp + vec2(e, 0.0));
          float hz = rippleHeight(wp + vec2(0.0, e));
          // calm shallow edges, lively deep channel
          float k = 2.0 * mix(0.35, 1.0, depthN);
          vec3 nW = normalize(vec3(-(hx - h0) * k / e, 1.0, -(hz - h0) * k / e));
          nW.y *= gl_FrontFacing ? 1.0 : -1.0; // seen from underwater
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          // depth-based colour + alpha: thin bright edges, deep dark water
          // (lives here, not color_fragment, because 'normal' only exists
          // from normal_fragment_begin onward - chunk order matters)
          diffuseColor.rgb *= mix(0.95, 0.52, depthN);
          float wAlpha = mix(0.34, 0.84, depthN);
          vec3 wViewDir = normalize(vViewPosition);
          float wFres = pow(1.0 - saturate(dot(wViewDir, normal)), 3.0);
          // shoreline lapping band: a thin, ripple-animated bright fringe
          // where the water thins onto the bank - reads as a wet waterline,
          // and its noise wobble kills any residual contour banding
          float lap = 1.0 - smoothstep(0.02, 0.3 + rippleHeight(wp * 2.1) * 0.35, wDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.97, 0.94), lap * 0.55);
          diffuseColor.a = clamp(wAlpha + wFres * 0.28 + lap * 0.18, 0.0, 0.9);
        }`)
      // FLOOD/RAZORFIN READABILITY FIX (playtest bug, 2026-07-18): the
      // blood-red hazard telegraph is supposed to read "from a distance"
      // (see buildWater's opening comment) but standard scene fog was
      // washing it down to an indistinct pale grey-green past ~50-60m -
      // confirmed by comparing close vs far in-engine captures. Self-
      // contained replacement of the stock fog_fragment chunk (can't just
      // prepend - fogFactor is declared INSIDE that chunk): cuts the fog
      // mix locally wherever the water is actually running red, scaled by
      // how red the vertex colour is; calm teal water keeps normal
      // atmospheric fog untouched.
      .replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
          #else
            float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
          #endif
          float bloodAmt = clamp((vColor.r - vColor.g) * 2.2, 0.0, 1.0);
          fogFactor *= mix(1.0, 0.12, bloodAmt);
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
        #endif`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.waterLevel;
  mesh.name = 'water';
  scene.add(mesh);

  // Round-6 water reflections: a small cube capture of the CURRENT sky,
  // fog and canopy silhouettes feeds the standard material's environment
  // reflection. At 128px the capture is naturally soft = a glossy river,
  // and the round-4 fresnel already strengthens it exactly at grazing
  // angles where real water mirrors. Cost: six 128px scene renders ONLY
  // when the mood/weather changes (call sites in main.js), zero per frame.
  {
    const cubeRT = new THREE.WebGLCubeRenderTarget(128, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.5, 1200, cubeRT);
    mesh.userData.updateEnvMap = (renderer, sceneRef, nearPos) => {
      // capture from just above the water surface near the viewer so the
      // reflected canopy line sits where the eye expects it
      cubeCam.position.set(
        nearPos ? nearPos.x : 2, WORLD.waterLevel + 1.2, nearPos ? nearPos.z : -14
      );
      mesh.visible = false;
      cubeCam.update(renderer, sceneRef);
      mesh.visible = true;
      if (!mat.envMap) {
        mat.envMap = cubeRT.texture;
        mat.envMapIntensity = 1.1;
        mat.needsUpdate = true;
      }
    };
  }

  // gentle swell so the river reads as liquid even without textures;
  // depth-scaled so puddle edges hold still instead of pulsing
  const base = geo.attributes.position.array.slice();

  // THE FLOOD (round 5): re-pose THIS surface - same mesh, same material,
  // same ripple shader - at the current rise, and sweep the razorfin-red
  // telegraph out from the gorge. Writes the RESTING positions (base) so
  // the swell tick composes on top; cheap arithmetic over cached ground
  // heights, no heightfield resampling.
  let floodWas = false;
  mesh.userData.setFlood = (rise, tintFront, tintIntensity) => {
    const active = rise > 0.01 || tintIntensity > 0.01;
    if (!active && !floodWas) return;
    floodWas = active;
    const arr = geo.attributes.position.array;
    const front = tintFront * (FLOOD.HALF + FLOOD.FEATHER + 24);
    for (let i = 0; i < hCache.length; i++) {
      const m = maskCache[i];
      const level = WORLD.waterLevel + (m > 0 ? rise * m : 0);
      const depth = level - hCache[i];
      // the surface stays a LEVEL (flood mask varies it smoothly); the
      // fragment shader clips it against the ground per pixel
      const y = level - WORLD.waterLevel;
      amp[i] = depth < 0.3 ? 0 : clamp(depth / 1.2, 0, 1);
      base[i * 3 + 1] = y;
      arr[i * 3 + 1] = y;
      // the telegraph: blood sweeps outward from the rift, saturating
      // with the event - the exact language the gorge already taught
      let blood = blood0[i];
      if (m > 0 && tintIntensity > 0) {
        const sweep = smoothstep(front + 14, front - 6, dGorge[i]);
        blood = Math.max(blood, tintIntensity * m * sweep);
      }
      cw.copy(cSafe).lerp(cBlood, blood);
      wCol[i * 3] = cw.r;
      wCol[i * 3 + 1] = cw.g;
      wCol[i * 3 + 2] = cw.b;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };

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

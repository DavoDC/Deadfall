// Procedural foliage silhouette atlas - round 7 "de-rectangle the jungle".
// Grass tufts, fern fronds, broadleaves and thicket leaves were flat
// geometry planes with dead-straight edges; at any distance they read as
// RECTANGLES, the loudest "web game" tell David named. This module draws
// organic alpha-cutout silhouettes into ONE shared canvas at runtime
// (zero binary assets - the identity is locked) and the vegetation
// geometry maps its cards into the atlas tiles. alphaTest keeps depth
// writes + shadow cutouts working with no transparency sorting.
//
// Atlas layout (1024x1024, four 512px tiles):
//   (0,0) grass tuft     (1,0) fern frond
//   (0,1) broad leaf     (1,1) thicket leaf
// RGB is a white-based shading map (multiplied by instance colours, so the
// vibrant per-instance palette survives), alpha is the silhouette.

import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

export const TILES = {
  grass: 0,
  fern: 1,
  broadleaf: 2,
  thicket: 3,
};

// Remap a geometry's 0..1 UVs into one atlas tile (with a small inset so
// bilinear filtering never bleeds a neighbouring tile across the edge).
export function uvToTile(geo, tile) {
  const inset = 0.01;
  const ox = (tile % 2) * 0.5;
  const oy = tile < 2 ? 0.5 : 0; // canvas y=0 is TOP; three uv y=0 is BOTTOM
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(
      i,
      ox + inset + uv.getX(i) * (0.5 - inset * 2),
      oy + inset + uv.getY(i) * (0.5 - inset * 2)
    );
  }
  return geo;
}

// A single tapered curved blade: quadratic bezier spine, width tapering to
// a point. Used by both the grass tuft and the thicket leaf edges.
function blade(ctx, x0, y0, tipX, tipY, ctrlX, ctrlY, w, shade) {
  const steps = 8;
  ctx.beginPath();
  // left edge base->tip, right edge tip->base
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i <= steps; i++) {
      const t = side === 0 ? i / steps : 1 - i / steps;
      const mt = 1 - t;
      const px = mt * mt * x0 + 2 * mt * t * ctrlX + t * t * tipX;
      const py = mt * mt * y0 + 2 * mt * t * ctrlY + t * t * tipY;
      // tangent for the width offset
      const tx = 2 * mt * (ctrlX - x0) + 2 * t * (tipX - ctrlX);
      const ty = 2 * mt * (ctrlY - y0) + 2 * t * (tipY - ctrlY);
      const len = Math.hypot(tx, ty) || 1;
      const half = w * (1 - t * 0.92) * (side === 0 ? 0.5 : -0.5);
      const px2 = px + (-ty / len) * half;
      const py2 = py + (tx / len) * half;
      if (side === 0 && i === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
  }
  ctx.closePath();
  ctx.fillStyle = shade;
  ctx.fill();
}

function drawGrassTuft(ctx, ox, oy, T, rng) {
  const baseX = ox + T * 0.5;
  const baseY = oy + T * 0.98;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const lean = (f - 0.5) * 2; // -1..1 across the fan
    const h = T * (0.5 + rng.next() * 0.45) * (1 - Math.abs(lean) * 0.35);
    const tipX = baseX + lean * T * 0.44 + (rng.next() - 0.5) * T * 0.1;
    const tipY = baseY - h;
    const ctrlX = baseX + lean * T * 0.13;
    const ctrlY = baseY - h * 0.6;
    const lum = 150 + Math.round(rng.next() * 105);
    blade(ctx, baseX + lean * T * 0.05, baseY, tipX, tipY, ctrlX, ctrlY,
      T * (0.028 + rng.next() * 0.03), `rgb(${lum},${lum},${Math.round(lum * 0.82)})`);
  }
  // a couple of arching seed-head stems give the tuft a wild silhouette
  for (let i = 0; i < 3; i++) {
    const lean = (rng.next() - 0.5) * 1.6;
    const tipX = baseX + lean * T * 0.5;
    const tipY = oy + T * (0.04 + rng.next() * 0.1);
    blade(ctx, baseX, baseY, tipX, tipY, baseX + lean * T * 0.05, oy + T * 0.45,
      T * 0.024, 'rgb(210,205,150)');
    ctx.beginPath();
    ctx.ellipse(tipX, tipY, T * 0.02, T * 0.045, lean * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgb(228,214,150)';
    ctx.fill();
  }
}

function drawFernFrond(ctx, ox, oy, T, rng) {
  // vertical rachis with paired drooping pinnae, classic pinnate frond
  const baseX = ox + T * 0.5;
  const baseY = oy + T * 0.98;
  const tipY = oy + T * 0.05;
  blade(ctx, baseX, baseY, baseX + T * 0.05, tipY, baseX - T * 0.04, oy + T * 0.5,
    T * 0.022, 'rgb(170,185,120)');
  const pairs = 11;
  for (let i = 0; i < pairs; i++) {
    const f = i / (pairs - 1);            // 0 base -> 1 tip
    const y = baseY - f * (baseY - tipY) * 0.94;
    const stemX = baseX + (f * f) * T * 0.04;
    const len = T * 0.30 * Math.sin(Math.PI * (0.24 + f * 0.66)); // short-long-short
    for (const side of [-1, 1]) {
      const droop = T * (0.05 + f * 0.05);
      const tipX = stemX + side * len;
      const lum = 165 + Math.round((1 - f) * 60 + rng.next() * 30);
      blade(ctx, stemX, y, tipX, y + droop, stemX + side * len * 0.5, y - droop * 0.4,
        T * (0.055 - f * 0.02), `rgb(${Math.round(lum * 0.9)},${lum},${Math.round(lum * 0.72)})`);
    }
  }
}

function drawBroadleaf(ctx, ox, oy, T, rng) {
  // pointed paddle leaf: two mirrored beziers, midrib + veins, edge bites
  const cx = ox + T * 0.5;
  const top = oy + T * 0.04;
  const bot = oy + T * 0.98;
  ctx.beginPath();
  ctx.moveTo(cx, bot);
  ctx.bezierCurveTo(ox + T * 0.06, bot - T * 0.28, ox + T * 0.02, top + T * 0.34, cx - T * 0.02, top);
  ctx.bezierCurveTo(ox + T * 0.96, top + T * 0.36, ox + T * 0.94, bot - T * 0.3, cx, bot);
  ctx.closePath();
  ctx.fillStyle = 'rgb(200,215,175)';
  ctx.fill();
  // midrib + veins darker so the surface reads as a living leaf
  ctx.strokeStyle = 'rgba(95,120,70,0.85)';
  ctx.lineWidth = T * 0.02;
  ctx.beginPath();
  ctx.moveTo(cx, bot);
  ctx.quadraticCurveTo(cx - T * 0.02, oy + T * 0.5, cx - T * 0.01, top + T * 0.03);
  ctx.stroke();
  ctx.lineWidth = T * 0.008;
  for (let i = 0; i < 7; i++) {
    const f = 0.12 + i * 0.12;
    const y = bot - f * (bot - top);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(cx + side * T * 0.2, y - T * 0.07, cx + side * T * (0.42 - Math.abs(f - 0.55) * 0.35), y - T * 0.13);
      ctx.stroke();
    }
  }
  // ragged bites nicked out of the EDGE (tracked along the outline - a
  // fixed-radius ring punched swiss-cheese holes mid-leaf)
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const f = 0.15 + rng.next() * 0.7;      // height fraction along the leaf
    const half = T * 0.46 * Math.sqrt(Math.max(0, 1 - (2 * f - 1) * (2 * f - 1)));
    const side = rng.next() < 0.5 ? -1 : 1;
    const ex = cx + side * half;
    const ey = bot - f * (bot - top);
    ctx.beginPath();
    ctx.arc(ex, ey, T * (0.02 + rng.next() * 0.035), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawThicketLeaf(ctx, ox, oy, T, rng) {
  // long ragged strap leaf - the impassable-wall species
  const cx = ox + T * 0.5;
  const bot = oy + T * 0.98;
  const top = oy + T * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx, bot);
  const teeth = 9;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= teeth; i++) {
      const f = side === -1 ? i / teeth : 1 - i / teeth;
      const y = bot - f * (bot - top);
      const w = T * 0.3 * Math.sin(Math.PI * Math.min(1, f * 1.12)) *
        (0.75 + 0.25 * Math.sin(f * 31 + side));
      ctx.lineTo(cx + side * w, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = 'rgb(175,190,160)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,100,65,0.9)';
  ctx.lineWidth = T * 0.016;
  ctx.beginPath();
  ctx.moveTo(cx, bot);
  ctx.lineTo(cx, top + T * 0.05);
  ctx.stroke();
  // vertical shading: darker toward the base = depth inside the bush
  const g = ctx.createLinearGradient(0, bot, 0, top);
  g.addColorStop(0, 'rgba(30,40,25,0.5)');
  g.addColorStop(0.5, 'rgba(30,40,25,0.0)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, T, T);
  ctx.globalCompositeOperation = 'source-over';
}

let cached = null;

export function makeFoliageAtlas() {
  if (cached) return cached;
  const S = 1024;
  const T = S / 2;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  const rng = makeRng(20260718);
  drawGrassTuft(ctx, 0, 0, T, rng);       // uv-space tile 0 = canvas top-left
  drawFernFrond(ctx, T, 0, T, rng);
  drawBroadleaf(ctx, 0, T, T, rng);
  drawThicketLeaf(ctx, T, T, T, rng);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  cached = tex;
  return tex;
}

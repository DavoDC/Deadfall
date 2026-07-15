import { describe, it, expect } from 'vitest';
import { maskFromDiff, dilateRing, meanRGBForMask, contrastScore } from '../src/game/legibility.js';

// Build a flat RGBA Uint8 buffer of a single solid colour, width x height pixels.
function solidBuffer(r, g, b, width, height, a = 255) {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = a;
  }
  return buf;
}

// Paint an axis-aligned rectangular block [x0,x1) x [y0,y1) with a colour,
// mutating a buffer produced by solidBuffer.
function paintBlock(buf, width, x0, y0, x1, y1, r, g, b) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
    }
  }
}

describe('legibility: maskFromDiff', () => {
  it('identical frames produce an empty mask', () => {
    const bg = solidBuffer(20, 40, 15, 8, 8);
    const enemy = solidBuffer(20, 40, 15, 8, 8);
    const mask = maskFromDiff(bg, enemy, 8, 8);
    expect(mask.length).toBe(64);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it('a block of changed pixels is captured exactly by the mask', () => {
    const width = 8, height = 8;
    const bg = solidBuffer(20, 40, 15, width, height); // dark understory green
    const enemy = solidBuffer(20, 40, 15, width, height);
    paintBlock(enemy, width, 2, 2, 5, 5, 220, 120, 40); // 3x3 orange block

    const mask = maskFromDiff(bg, enemy, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const inBlock = x >= 2 && x < 5 && y >= 2 && y < 5;
        expect(mask[idx]).toBe(inBlock ? 1 : 0);
      }
    }
  });

  it('small colour drift below the threshold does not trigger the mask', () => {
    const bg = solidBuffer(20, 40, 15, 4, 4);
    const enemy = solidBuffer(22, 41, 16, 4, 4); // sum abs diff = 4, well under default 24
    const mask = maskFromDiff(bg, enemy, 4, 4);
    expect(mask.every((v) => v === 0)).toBe(true);
  });
});

describe('legibility: dilateRing', () => {
  it('rings the mask without including the mask itself', () => {
    const width = 5, height = 5;
    const mask = new Uint8Array(width * height);
    mask[2 * width + 2] = 1; // single centre pixel masked

    const ring = dilateRing(mask, width, height, 1);
    // centre itself must not be in the ring
    expect(ring[2 * width + 2]).toBe(0);
    // its 8 immediate neighbours must be in the ring
    const neighbours = [
      [1, 1], [2, 1], [3, 1],
      [1, 2],         [3, 2],
      [1, 3], [2, 3], [3, 3],
    ];
    for (const [x, y] of neighbours) {
      expect(ring[y * width + x]).toBe(1);
    }
    // a far corner must not be in the ring
    expect(ring[0 * width + 0]).toBe(0);
  });
});

describe('legibility: meanRGBForMask', () => {
  it('averages only the masked pixels', () => {
    const width = 2, height = 2;
    const buf = new Uint8ClampedArray(width * height * 4);
    const set = (i, r, g, b) => { const o = i * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255; };
    set(0, 200, 0, 0);
    set(1, 0, 200, 0); // masked
    set(2, 0, 0, 200); // masked
    set(3, 100, 100, 100);

    const mask = new Uint8Array([0, 1, 1, 0]);
    const mean = meanRGBForMask(buf, width, height, mask);
    expect(mean.count).toBe(2);
    expect(mean.r).toBe(0);
    expect(mean.g).toBe(100);
    expect(mean.b).toBe(100);
  });

  it('returns a zero-count result for an empty mask', () => {
    const buf = solidBuffer(50, 50, 50, 4, 4);
    const mask = new Uint8Array(16); // all zero
    const mean = meanRGBForMask(buf, 4, 4, mask);
    expect(mean.count).toBe(0);
    expect(mean.r).toBe(0);
    expect(mean.g).toBe(0);
    expect(mean.b).toBe(0);
  });
});

describe('legibility: contrastScore', () => {
  it('is zero for identical enemy/background colours', () => {
    const score = contrastScore({ r: 30, g: 60, b: 20 }, { r: 30, g: 60, b: 20 });
    expect(score).toBe(0);
  });

  it('matches the known luminance+colour-distance blend for a known colour pair', () => {
    // Pure white enemy against pure black background - the maximal case.
    const score = contrastScore({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    const lumDiff = 255; // full luminance range, weights sum to 1
    const colourDist = Math.hypot(255, 255, 255);
    const expected = Number((lumDiff * 0.6 + colourDist * 0.4).toFixed(2));
    expect(score).toBe(expected);
  });

  it('end-to-end: a known colour block against a known background scores the expected contrast', () => {
    const width = 8, height = 8;
    const bg = solidBuffer(20, 40, 15, width, height);
    const enemy = solidBuffer(20, 40, 15, width, height);
    paintBlock(enemy, width, 2, 2, 5, 5, 220, 120, 40);

    const mask = maskFromDiff(bg, enemy, width, height);
    const ring = dilateRing(mask, width, height, 2);
    const enemyMean = meanRGBForMask(enemy, width, height, mask);
    const bgMean = meanRGBForMask(bg, width, height, ring);

    // The block is solid, so its mean is exactly the painted colour.
    expect(enemyMean).toMatchObject({ r: 220, g: 120, b: 40, count: 9 });
    // The ring samples untouched background, so its mean is exactly the bg colour.
    expect(bgMean).toMatchObject({ r: 20, g: 40, b: 15 });

    const score = contrastScore(enemyMean, bgMean);
    const expected = contrastScore({ r: 220, g: 120, b: 40 }, { r: 20, g: 40, b: 15 });
    expect(score).toBe(expected);
    expect(score).toBeGreaterThan(0);
  });
});

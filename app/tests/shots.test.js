import { describe, it, expect } from 'vitest';
import { computeStats, slugify, contactSheetFilename, shotFilename } from '../src/game/shots.js';

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

describe('shots: computeStats (objective colour-grading metrics)', () => {
  it('a vivid red buffer reads as fully vivid, not sky, not muddy, not dark', () => {
    const buf = solidBuffer(200, 40, 40, 4, 4);
    const stats = computeStats(buf, 4, 4);
    expect(stats.meanR).toBe(200);
    expect(stats.meanG).toBe(40);
    expect(stats.meanB).toBe(40);
    expect(stats.pctVivid).toBe(100);
    expect(stats.pctSky).toBe(0);
    expect(stats.pctMuddy).toBe(0);
    expect(stats.pctDark).toBe(0);
  });

  it('a near-black buffer reads as fully dark', () => {
    const buf = solidBuffer(20, 20, 20, 4, 4);
    const stats = computeStats(buf, 4, 4);
    expect(stats.pctDark).toBe(100);
    expect(stats.pctVivid).toBe(0);
    expect(stats.pctSky).toBe(0);
  });

  it('a mid-grey buffer reads as fully muddy (low sat, mid val, not sky)', () => {
    const buf = solidBuffer(120, 120, 120, 4, 4);
    const stats = computeStats(buf, 4, 4);
    expect(stats.pctMuddy).toBe(100);
    expect(stats.pctVivid).toBe(0);
    expect(stats.pctDark).toBe(0);
    expect(stats.meanSat).toBe(0);
  });

  it('a pale sky-blue buffer reads as fully sky (and not vivid or muddy)', () => {
    const buf = solidBuffer(180, 200, 230, 4, 4);
    const stats = computeStats(buf, 4, 4);
    expect(stats.pctSky).toBe(100);
    expect(stats.pctVivid).toBe(0);
    expect(stats.pctMuddy).toBe(0);
    expect(stats.pctDark).toBe(0);
  });

  it('mixed pixels split proportionally across categories', () => {
    // 2x2: one vivid red pixel, one dark pixel, one muddy grey pixel, one sky pixel
    const buf = new Uint8ClampedArray(2 * 2 * 4);
    const set = (i, r, g, b) => {
      const o = i * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
    };
    set(0, 200, 40, 40);   // vivid
    set(1, 20, 20, 20);    // dark
    set(2, 120, 120, 120); // muddy
    set(3, 180, 200, 230); // sky
    const stats = computeStats(buf, 2, 2);
    expect(stats.pctVivid).toBe(25);
    expect(stats.pctDark).toBe(25);
    expect(stats.pctMuddy).toBe(25);
    expect(stats.pctSky).toBe(25);
  });

  it('meanSat and meanVal are within [0,1]', () => {
    const buf = solidBuffer(200, 40, 40, 4, 4);
    const stats = computeStats(buf, 4, 4);
    expect(stats.meanSat).toBeGreaterThanOrEqual(0);
    expect(stats.meanSat).toBeLessThanOrEqual(1);
    expect(stats.meanVal).toBeGreaterThanOrEqual(0);
    expect(stats.meanVal).toBeLessThanOrEqual(1);
  });
});

// downloadShots() used to trigger individual browser Downloads-folder
// saves for every PNG; it now saves under captures/telemetry/shots/ via
// src/capture/save.js. slugify/contactSheetFilename/shotFilename are the
// pure naming pieces of that path - unit-testable without a canvas/DOM.
describe('shots: slugify (filename-safe vantage names)', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('RIVER CROSSING')).toBe('river-crossing');
  });

  it('strips punctuation that is not a word character or hyphen', () => {
    expect(slugify('RIVER CROSSING (The Rapids)')).toBe('river-crossing-the-rapids');
  });

  it('collapses multiple spaces into a single hyphen', () => {
    expect(slugify('THE  SUNKEN   MAW')).toBe('the-sunken-maw');
  });
});

describe('shots: contactSheetFilename / shotFilename (capture-sink naming)', () => {
  it('contactSheetFilename builds a .png name from a timestamp', () => {
    expect(contactSheetFilename('2026-08-20T21-00-00')).toBe('contact-sheet-2026-08-20T21-00-00.png');
  });

  it('shotFilename combines mood, slugified vantage name, and timestamp', () => {
    expect(shotFilename('bloom', 'INSERTION BEACH', '2026-08-20T21-00-00')).toBe(
      'bloom-insertion-beach-2026-08-20T21-00-00.png'
    );
  });

  it('shotFilename keeps different moods for the same vantage distinct', () => {
    const a = shotFilename('bloom', 'RIDGE VISTA (Eastern spine)', 't');
    const b = shotFilename('violet', 'RIDGE VISTA (Eastern spine)', 't');
    expect(a).not.toBe(b);
  });
});

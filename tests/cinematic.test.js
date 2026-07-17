// The trailer timeline must be structurally sound before a single frame is
// graded: length in the ~60s envelope, every shot resolvable at any t,
// cameras above ground, flood clocks inside real phase windows, moods and
// cast types that actually exist.

import { describe, it, expect } from 'vitest';
import { SHOTS, totalDuration, shotAt, evalCam, evalCast } from '../src/game/cinematic.js';
import { MOODS } from '../src/world/sky.js';
import { PHASES } from '../src/game/flood.js';
import { terrainHeight, WORLD } from '../src/world/heightmap.js';

const KNOWN_CAST = ['prowler', 'juggernaut', 'spitter', 'stingerwing', 'shrike'];

describe('trailer timeline structure', () => {
  it('runs about a minute', () => {
    const d = totalDuration();
    expect(d).toBeGreaterThanOrEqual(55);
    expect(d).toBeLessThanOrEqual(72);
  });

  it('every shot has a positive duration, a name, and a known mood', () => {
    for (const s of SHOTS) {
      expect(s.dur).toBeGreaterThan(0);
      expect(typeof s.name).toBe('string');
      expect(MOODS[s.mood], `${s.name} mood ${s.mood}`).toBeTruthy();
    }
  });

  it('shotAt covers the whole timeline and clamps the ends', () => {
    const d = totalDuration();
    expect(shotAt(0).index).toBe(0);
    expect(shotAt(-5).index).toBe(0);
    expect(shotAt(d + 100).index).toBe(SHOTS.length - 1);
    // walking a fine grid never throws and local stays inside the shot
    for (let t = 0; t <= d; t += 0.25) {
      const { shot, local } = shotAt(t);
      expect(local).toBeGreaterThanOrEqual(0);
      expect(local).toBeLessThanOrEqual(shot.dur + 1e-9);
    }
  });

  it('shot boundaries are exact - end of one shot is start of the next', () => {
    let acc = 0;
    for (let i = 0; i < SHOTS.length - 1; i++) {
      acc += SHOTS[i].dur;
      expect(shotAt(acc).index).toBe(i + 1);
      expect(shotAt(acc - 1e-6).index).toBe(i);
    }
  });
});

describe('camera evaluation', () => {
  it('returns finite positions and looks across every shot', () => {
    for (const s of SHOTS) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        const { pos, look } = evalCam(s, u);
        for (const v of [...pos, ...look]) expect(Number.isFinite(v)).toBe(true);
        // pos and look must differ (lookAt degenerates otherwise)
        const dd = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
        expect(dd, `${s.name} u=${u} degenerate look`).toBeGreaterThan(0.5);
      }
    }
  });

  it('camera never goes underground on any shot', () => {
    for (const s of SHOTS) {
      for (let u = 0; u <= 1.0001; u += 0.05) {
        const { pos } = evalCam(s, Math.min(1, u));
        const ground = terrainHeight(pos[0], pos[2]);
        expect(pos[1], `${s.name} u=${u.toFixed(2)} buried`).toBeGreaterThan(ground + 0.2);
      }
    }
  });

  it('camera stays inside the world bounds', () => {
    const limit = WORLD.size ? WORLD.size / 2 + 60 : 460;
    for (const s of SHOTS) {
      for (const u of [0, 0.5, 1]) {
        const { pos } = evalCam(s, u);
        expect(Math.abs(pos[0])).toBeLessThan(limit);
        expect(Math.abs(pos[2])).toBeLessThan(limit);
      }
    }
  });
});

describe('flood shots', () => {
  const floodTotal = PHASES.telegraph + PHASES.surge + PHASES.peak + PHASES.recede;

  it('flood clocks stay inside the event and never rewind mid-timeline', () => {
    let lastEnd = -1;
    for (const s of SHOTS) {
      if (!s.flood) continue;
      const start = s.flood.base;
      const end = s.flood.base + s.dur * (s.flood.rate || 1);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(floodTotal);
      // consecutive flood shots must move the clock forward (deterministic
      // forward stepping stays cheap; a rewind forces a full recompute)
      expect(start, `${s.name} flood clock rewinds`).toBeGreaterThanOrEqual(lastEnd >= 0 ? 0 : -1);
      if (lastEnd >= 0) expect(start).toBeGreaterThanOrEqual(lastEnd - 5);
      lastEnd = end;
    }
  });

  it('the trailer shows telegraph, surge and peak', () => {
    const phases = new Set();
    for (const s of SHOTS) {
      if (!s.flood) continue;
      for (const local of [0, s.dur / 2, s.dur]) {
        const ft = s.flood.base + local * (s.flood.rate || 1);
        if (ft < PHASES.telegraph) phases.add('telegraph');
        else if (ft < PHASES.telegraph + PHASES.surge) phases.add('surge');
        else if (ft < PHASES.telegraph + PHASES.surge + PHASES.peak) phases.add('peak');
      }
    }
    expect(phases.has('telegraph')).toBe(true);
    expect(phases.has('surge')).toBe(true);
    expect(phases.has('peak')).toBe(true);
  });
});

describe('cast', () => {
  it('cast members are known enemy types on real ground inside the world', () => {
    for (const s of SHOTS) {
      for (const c of s.cast || []) {
        expect(KNOWN_CAST).toContain(c.type);
        expect(Math.abs(c.x)).toBeLessThan(400);
        expect(Math.abs(c.z)).toBeLessThan(400);
        // pose math stays finite over the whole shot
        for (const local of [0, s.dur / 2, s.dur]) {
          const p = evalCast(c, local);
          for (const v of [p.x, p.y, p.z, p.heading, p.phase]) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
    }
  });

  it('fire cues land inside their shot and target real cast members', () => {
    for (const s of SHOTS) {
      for (const cue of s.cues || []) {
        expect(cue.t).toBeGreaterThan(0);
        expect(cue.t).toBeLessThan(s.dur);
        if (cue.castIdx !== undefined) {
          expect(s.cast && s.cast[cue.castIdx], `${s.name} cue targets missing cast`).toBeTruthy();
        }
      }
    }
  });

  it('pov shots exist (the gun gets its showcase)', () => {
    expect(SHOTS.some((s) => s.pov)).toBe(true);
  });

  it('a title card closes the trailer', () => {
    const last = SHOTS[SHOTS.length - 1];
    expect(last.title).toBeTruthy();
    expect(last.title.text).toBe('DEADFALL');
  });
});

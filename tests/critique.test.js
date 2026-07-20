import { describe, it, expect } from 'vitest';
import {
  SEVERITY, findUnfairDeaths, timeBucketHazard, findDifficultySpikes,
  findPacingDeadZones, findSoftLocks, findLegibilityDefects, critique,
} from '../src/game/critique.js';

// --- fixture builders -------------------------------------------------
// critique.js consumes plain "run records" (autotest.js report + the
// critiqueRig.js fields merged in). These builders synthesise records
// without touching the sim at all, per the brief's "TDD with synthetic
// run fixtures - unit-tested independently of the sim."

function dmgEvent(overrides = {}) {
  return {
    t: 10, amount: 10, source: 'prowler',
    srcPos: { x: 0, z: -5 }, playerPos: { x: 0, z: 0 }, playerHp: 90,
    dist: 5, angleDeg: 0, inViewCone: true, losClear: true, inView: true,
    withinReactionDist: true,
    ...overrides,
  };
}

function tick(overrides = {}) {
  return { t: 0, hp: 100, stamina: 1, x: 0, z: 0, threat: 0.3, enemiesNear: { count: 0, types: {} }, ...overrides };
}

function run(overrides = {}) {
  return {
    route: 'river', difficulty: 'normal', result: 'WIN', timeSec: 300,
    kills: 10, dmgTaken: 20, endHp: 80, stuck: false, stuckAt: null,
    damageEvents: [], deathRecord: null, ticks: [],
    ...overrides,
  };
}

// --- findUnfairDeaths ---------------------------------------------------

describe('critique: findUnfairDeaths', () => {
  it('flags a death spiked from behind/offscreen with no prior warning', () => {
    const deathEvent = dmgEvent({
      t: 100, amount: 55, source: 'juggernaut',
      inViewCone: false, losClear: false, inView: false, withinReactionDist: false,
    });
    const r = run({
      result: 'DEAD', difficulty: 'normal',
      damageEvents: [deathEvent],
      deathRecord: deathEvent,
      ticks: [tick({ t: 90, hp: 100 }), tick({ t: 95, hp: 98 })],
    });
    const findings = findUnfairDeaths([r]);
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe('UNFAIR_DEATH');
    expect(findings[0].severity).toBe(SEVERITY.UNFAIR);
    expect(findings[0].confidence).toBe('high'); // multiple corroborating reasons
    expect(findings[0].evidence.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT flag an earned death - sustained visible pressure, gradual hp loss', () => {
    const events = [
      dmgEvent({ t: 80, amount: 15, playerHp: 85, inView: true, withinReactionDist: true }),
      dmgEvent({ t: 85, amount: 15, playerHp: 70, inView: true, withinReactionDist: true }),
      dmgEvent({ t: 90, amount: 20, playerHp: 55, inView: true, withinReactionDist: true }),
      dmgEvent({ t: 95, amount: 55, playerHp: 35, inView: true, withinReactionDist: true }),
    ];
    const r = run({
      result: 'DEAD',
      damageEvents: events,
      deathRecord: events[events.length - 1],
      ticks: [tick({ t: 70, hp: 100 }), tick({ t: 75, hp: 88 }), tick({ t: 80, hp: 70 })],
    });
    const findings = findUnfairDeaths([r]);
    expect(findings.length).toBe(0);
  });

  it('lowers the spike bar on RECRUIT (easy) difficulty', () => {
    // 32% of max hp in the window - below the normal 40% bar, above the
    // recruit 30% bar, and the killer was never in view.
    const deathEvent = dmgEvent({ t: 50, amount: 32, inViewCone: false, inView: false });
    const rNormal = run({
      difficulty: 'normal', result: 'DEAD',
      damageEvents: [deathEvent], deathRecord: deathEvent,
    });
    const rEasy = run({
      difficulty: 'easy', result: 'DEAD',
      damageEvents: [deathEvent], deathRecord: deathEvent,
    });
    expect(findUnfairDeaths([rNormal]).length).toBe(0);
    const easyFindings = findUnfairDeaths([rEasy]);
    expect(easyFindings.length).toBe(1);
    expect(easyFindings[0].evidence.reasons.some((r2) => r2.includes('RECRUIT'))).toBe(true);
  });

  it('ignores WIN/STUCK/TIMEOUT runs entirely', () => {
    const rWin = run({ result: 'WIN' });
    const rStuck = run({ result: 'STUCK', stuckAt: { x: 1, z: 1, wp: 2 } });
    expect(findUnfairDeaths([rWin, rStuck])).toEqual([]);
  });

  it('handles a death with no matching damage event (unknown cause) without throwing', () => {
    const r = run({ result: 'DEAD', deathRecord: { unknown: true }, damageEvents: [] });
    expect(() => findUnfairDeaths([r])).not.toThrow();
    expect(findUnfairDeaths([r])).toEqual([]);
  });

  it('judges the FINISHING blow, not every hit in the window - a mixed-visibility burst still flags if the killer itself was unseen', () => {
    // Real pattern found in headless sweep data: a jugg-charge death with 3
    // hits in the fatal window (84 dmg total, well above the spike bar),
    // two unseen and a final ALSO-unseen one. windowEvents.every(!inView)
    // would also catch this; the regression this guards is the opposite
    // case below.
    const events = [
      dmgEvent({ t: 99.0, amount: 30, inView: false, withinReactionDist: true }),
      dmgEvent({ t: 99.5, amount: 24, inView: false, withinReactionDist: true }),
      dmgEvent({ t: 100.0, amount: 30, inView: false, withinReactionDist: false }),
    ];
    const r = run({ result: 'DEAD', damageEvents: events, deathRecord: events[2] });
    const findings = findUnfairDeaths([r]);
    expect(findings.length).toBe(1);
  });

  it('flags a burst where earlier hits were visible but the FINISHING blow was not - the death itself is what matters', () => {
    // The inverse of "sustained visible pressure": total window damage
    // clears the spike bar, and the hit that actually ended the run was
    // never in view - even though an earlier hit in the same window was.
    // windowEvents.every(!inView) would silently miss this (one visible
    // event disqualifies the whole window); classifying on dr (the death
    // record) alone catches it, which is what this test locks in.
    const events = [
      dmgEvent({ t: 99.2, amount: 20, inView: true, withinReactionDist: true }),
      dmgEvent({ t: 100.0, amount: 45, inView: false, withinReactionDist: false }),
    ];
    const r = run({ result: 'DEAD', damageEvents: events, deathRecord: events[1] });
    const findings = findUnfairDeaths([r]);
    expect(findings.length).toBe(1);
    expect(findings[0].evidence.reasons.some((r2) => r2.includes('view'))).toBe(true);
  });

  it('does NOT flag a burst where the finishing blow itself was visible, even if an earlier hit in the window was not', () => {
    // Mirror case: the window contains an unseen chip hit followed by a
    // clearly visible finishing blow that alone clears the spike bar -
    // the player saw what killed them, even though an earlier hit did not.
    const events = [
      dmgEvent({ t: 99.2, amount: 25, inView: false, withinReactionDist: false }),
      dmgEvent({ t: 100.0, amount: 30, inView: true, withinReactionDist: true }),
    ];
    const r = run({ result: 'DEAD', damageEvents: events, deathRecord: events[1] });
    expect(findUnfairDeaths([r])).toEqual([]);
  });

  it('does not flag a small, visible hit even if it happens to be the killing blow (low prior hp is expected, not unfair)', () => {
    // player already at 20 hp from earlier sustained combat, final 10-dmg
    // visible hit finishes them - textbook earned death, not a spike.
    const deathEvent = dmgEvent({ t: 60, amount: 10, playerHp: 20, inView: true, withinReactionDist: true });
    const r = run({
      result: 'DEAD',
      damageEvents: [
        dmgEvent({ t: 40, amount: 30, playerHp: 60, inView: true }),
        dmgEvent({ t: 50, amount: 40, playerHp: 30, inView: true }),
        deathEvent,
      ],
      deathRecord: deathEvent,
      ticks: [tick({ t: 30, hp: 60 }), tick({ t: 40, hp: 30 })],
    });
    expect(findUnfairDeaths([r])).toEqual([]);
  });
});

// --- timeBucketHazard ----------------------------------------------------

describe('critique: timeBucketHazard', () => {
  it('computes mortality as died/entering per bucket, not deaths/totalDeaths', () => {
    // 3 runs of the same nominal length; only the run that dies inside a
    // bucket is entering-then-dying, others simply survive past.
    const events = [];
    const runs = [
      run({ result: 'WIN', timeSec: 90, damageEvents: events }),
      run({ result: 'WIN', timeSec: 90, damageEvents: events }),
      run({
        result: 'DEAD', timeSec: 45,
        deathRecord: dmgEvent({ t: 40 }),
        damageEvents: [dmgEvent({ t: 40 })],
      }),
    ];
    const buckets = timeBucketHazard(runs, 30);
    // bucket 0 (0-30s): all 3 runs entering, 0 died there
    expect(buckets[0].entering).toBe(3);
    expect(buckets[0].died).toBe(0);
    // bucket 1 (30-60s): all 3 still entering (all lasted past t=30), 1 died there
    expect(buckets[1].entering).toBe(3);
    expect(buckets[1].died).toBe(1);
    expect(buckets[1].mortality).toBeCloseTo(1 / 3);
  });

  it('a run that ended before a bucket starts does not count as entering it', () => {
    const runs = [
      run({ result: 'DEAD', timeSec: 10, deathRecord: dmgEvent({ t: 9 }), damageEvents: [dmgEvent({ t: 9 })] }),
      run({ result: 'WIN', timeSec: 90 }),
    ];
    const buckets = timeBucketHazard(runs, 30);
    // bucket 1 (30-60s): only the WIN run is still going
    expect(buckets[1].entering).toBe(1);
  });
});

describe('critique: findDifficultySpikes', () => {
  it('flags a bucket where mortality craters relative to the group', () => {
    const runs = [];
    // 4 runs die right at ~t=100 (a shared bucket), 4 runs win cleanly at t=200
    for (let i = 0; i < 4; i++) {
      const de = dmgEvent({ t: 95 + i, amount: 60, inViewCone: false, inView: false });
      runs.push(run({ route: 'river', result: 'DEAD', timeSec: 100 + i, deathRecord: de, damageEvents: [de] }));
    }
    for (let i = 0; i < 4; i++) {
      runs.push(run({ route: 'river', result: 'WIN', timeSec: 200 }));
    }
    const findings = findDifficultySpikes(runs, { minEntering: 2 });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].kind).toBe('DIFFICULTY_SPIKE');
    expect(findings[0].severity).toBe(SEVERITY.UNFAIR);
  });

  it('does not flag anything when deaths are spread evenly across the run', () => {
    // Deliberately uses the DEFAULT minEntering: as the run count shrinks
    // toward the tail of an attrition curve, a tiny denominator (e.g. the
    // last 2 of 5 runs, one of which dies) reads as 50% mortality despite
    // being an artifact of sample size, not a design spike - this is
    // exactly the false positive timeBucketHazard's minEntering floor
    // exists to filter out.
    const runs = [];
    const times = [30, 90, 150, 210, 270];
    for (const t of times) {
      const de = dmgEvent({ t: t - 1, amount: 40 });
      runs.push(run({ route: 'ridge', result: 'DEAD', timeSec: t, deathRecord: de, damageEvents: [de] }));
    }
    const findings = findDifficultySpikes(runs);
    expect(findings).toEqual([]);
  });

  it('groups findings by route independently', () => {
    const riverRuns = [
      run({ route: 'river', result: 'WIN', timeSec: 60 }),
      run({ route: 'river', result: 'WIN', timeSec: 60 }),
    ];
    const findings = findDifficultySpikes(riverRuns);
    expect(findings.every((f) => f.evidence.route === 'river')).toBe(true);
  });
});

// --- findPacingDeadZones -------------------------------------------------

describe('critique: findPacingDeadZones', () => {
  it('flags a long zero-threat stretch recurring across runs at the same place', () => {
    const buildTicks = () => {
      const ticks = [];
      for (let t = 0; t <= 200; t += 5) {
        ticks.push(tick({ t, x: 10, z: -t, enemiesNear: { count: t >= 60 && t <= 120 ? 0 : 2, types: {} } }));
      }
      return ticks;
    };
    const runs = [
      run({ route: 'ridge', ticks: buildTicks() }),
      run({ route: 'ridge', ticks: buildTicks() }),
    ];
    const findings = findPacingDeadZones(runs, { minGapS: 45 });
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe('PACING_DEAD_ZONE');
    expect(findings[0].severity).toBe(SEVERITY.DULL);
    expect(findings[0].confidence).toBe('high'); // seen in 2 runs
  });

  it('ignores short quiet stretches below the minimum duration', () => {
    const ticks = [];
    for (let t = 0; t <= 100; t += 5) {
      ticks.push(tick({ t, enemiesNear: { count: t >= 60 && t <= 70 ? 0 : 1, types: {} } })); // only 10s quiet
    }
    const findings = findPacingDeadZones([run({ ticks })], { minGapS: 45 });
    expect(findings).toEqual([]);
  });

  it('ignores the intentional opening grace window', () => {
    const ticks = [];
    for (let t = 0; t <= 60; t += 5) ticks.push(tick({ t, enemiesNear: { count: 0, types: {} } }));
    const findings = findPacingDeadZones([run({ ticks })], { minGapS: 45, skipStartS: 20 });
    expect(findings).toEqual([]);
  });

  it('a single-run occurrence is reported at low confidence, not dropped', () => {
    const ticks = [];
    for (let t = 0; t <= 200; t += 5) {
      ticks.push(tick({ t, x: 5, z: -5, enemiesNear: { count: t >= 60 && t <= 120 ? 0 : 2, types: {} } }));
    }
    const findings = findPacingDeadZones([run({ route: 'swamp', ticks })], { minGapS: 45 });
    expect(findings.length).toBe(1);
    expect(findings[0].confidence).toBe('low');
  });
});

// --- findSoftLocks --------------------------------------------------------

describe('critique: findSoftLocks', () => {
  it('clusters recurring stuck positions into a high-confidence finding', () => {
    const runs = [
      run({ route: 'swamp', result: 'STUCK', stuckAt: { x: 100, z: -50, wp: 4 } }),
      run({ route: 'swamp', result: 'STUCK', stuckAt: { x: 104, z: -47, wp: 4 } }),
    ];
    const findings = findSoftLocks(runs);
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe('SOFT_LOCK');
    expect(findings[0].severity).toBe(SEVERITY.BLOCKS_FUN);
    expect(findings[0].confidence).toBe('high');
    expect(findings[0].evidence.occurrences).toBe(2);
  });

  it('reports a single stuck occurrence at low confidence', () => {
    const runs = [run({ route: 'ridge', result: 'STUCK', stuckAt: { x: 0, z: 0, wp: 1 } })];
    const findings = findSoftLocks(runs);
    expect(findings.length).toBe(1);
    expect(findings[0].confidence).toBe('low');
  });

  it('keeps distant stuck points as separate clusters', () => {
    const runs = [
      run({ route: 'ridge', result: 'STUCK', stuckAt: { x: 0, z: 0, wp: 1 } }),
      run({ route: 'ridge', result: 'STUCK', stuckAt: { x: 500, z: 500, wp: 5 } }),
    ];
    const findings = findSoftLocks(runs);
    expect(findings.length).toBe(2);
  });

  it('ignores non-STUCK runs', () => {
    expect(findSoftLocks([run({ result: 'WIN' }), run({ result: 'DEAD' })])).toEqual([]);
  });
});

// --- findLegibilityDefects ------------------------------------------------

describe('critique: findLegibilityDefects', () => {
  it('returns nothing when no legibility result is supplied', () => {
    expect(findLegibilityDefects(null)).toEqual([]);
    expect(findLegibilityDefects(undefined)).toEqual([]);
  });

  it('flags a min-contrast gate regression', () => {
    const result = {
      minContrast: 12.0, meanContrast: 50.0, worstArchetype: 'prowler',
      perArchetype: [{ type: 'prowler', contrast: 12.0, maskPixels: 400 }, { type: 'spitter', contrast: 60, maskPixels: 500 }],
    };
    const findings = findLegibilityDefects(result);
    expect(findings.some((f) => f.kind === 'LEGIBILITY_DEFECT' && f.title.includes('min contrast'))).toBe(true);
    expect(findings.every((f) => f.severity === SEVERITY.COSMETIC)).toBe(true);
  });

  it('does not flag anything when contrast is above every gate', () => {
    const result = {
      minContrast: 20.0, meanContrast: 55.0, worstArchetype: 'juggernaut',
      perArchetype: [{ type: 'juggernaut', contrast: 20.0, maskPixels: 400 }],
    };
    expect(findLegibilityDefects(result)).toEqual([]);
  });
});

// --- critique() top-level orchestration -----------------------------------

describe('critique: top-level orchestration', () => {
  it('ranks findings by severity: blocks-fun before unfair before dull before cosmetic', () => {
    const deathEvent = dmgEvent({ t: 10, amount: 60, inViewCone: false, inView: false });
    const quietTicks = [];
    for (let t = 0; t <= 200; t += 5) quietTicks.push(tick({ t, enemiesNear: { count: t >= 60 && t <= 130 ? 0 : 2, types: {} } }));
    const runs = [
      run({ route: 'river', result: 'STUCK', stuckAt: { x: 0, z: 0, wp: 1 } }),
      run({ route: 'river', result: 'DEAD', damageEvents: [deathEvent], deathRecord: deathEvent }),
      run({ route: 'river', ticks: quietTicks }),
    ];
    const legibilityResult = {
      minContrast: 10, meanContrast: 40, worstArchetype: 'spitter',
      perArchetype: [{ type: 'spitter', contrast: 10, maskPixels: 200 }],
    };
    const { findings, summary } = critique(runs, { legibilityResult });
    expect(findings.length).toBeGreaterThan(0);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i].severity).toBeGreaterThanOrEqual(findings[i - 1].severity);
    }
    expect(findings[0].severity).toBe(SEVERITY.BLOCKS_FUN);
    expect(summary.totalRuns).toBe(3);
    expect(summary.stuck).toBe(1);
    expect(summary.deaths).toBe(1);
    // every finding gets a stable, unique id
    const ids = findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns an empty findings list (not a crash) for an all-clean run set', () => {
    const runs = [run({ result: 'WIN' }), run({ result: 'WIN' })];
    const { findings, summary } = critique(runs);
    expect(findings).toEqual([]);
    expect(summary.wins).toBe(2);
  });
});

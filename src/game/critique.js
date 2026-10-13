// THE CRITIQUE ENGINE (the design notes, increment 2).
//
// Pure functions over an array of "run records" - autotest.js's report
// merged with critiqueRig.js's damageEvents/deathRecord/ticks. No sim, no
// THREE, no DOM: every function here takes plain objects and returns plain
// objects, so it is unit-tested with synthetic fixtures (tests/critique.
// test.js) independently of the game ever running. src/tools/critic.mjs is
// the only caller that feeds it real data.
//
// THE HARD PART - encoding taste as heuristics, argued here because a
// number with no argument is not a critique:
//
// UNFAIR DEATH - "killed by damage the player had no window to answer."
// A death is judged unfair, not merely fatal, when the FATAL WINDOW (the
// last ~1.2s before death - long enough to catch a burst, short enough
// that it is not "the whole fight") carries a damage spike AND at least
// one of these holds for that window:
//   - the killer was never in the player's view cone or LOS (offscreen
//     or literally behind a wall) - the player could not have aimed back
//   - the killer was never within reaction distance even when visible -
//     "you saw it, but there was no time"
//   - hp gave no telegraph: sampled hp in the ~8s BEFORE the window never
//     dropped below a "you're fine" floor - nothing warned the player a
//     fight was even happening
//   - RECRUIT (difficulty 'easy') promises forgiveness in its own blurb
//     ("it bites, but it lets you breathe" - difficulty.js) - so the spike
//     bar for calling it unfair is deliberately lower there than on HUNTER
//     or DEADFALL, where sustained pressure is the intended experience.
// Contrast, NOT flagged: sustained visible pressure (hp declines across
// multiple prior hits, the killer or its predecessors were in view) - that
// is earned, even if the final blow is large, because the player had the
// window and used it or didn't.
//
// DIFFICULTY SPIKE - not "a lot of people died around here" (with enough
// attrition EVERY late bucket looks that way as the surviving sample
// shrinks - a classic survival-analysis trap). Instead: a HAZARD RATE per
// time bucket, died-in-bucket / still-going-at-bucket-start, so a bucket
// only reads as a crater when a real fraction of the runs that REACHED it
// died there, not when it merely contains the last few survivors of a
// long attrition curve. See timeBucketHazard().
//
// PACING DEAD ZONE - a contiguous stretch with zero enemiesNear, long
// enough that it cannot be a lull between beats (minGapS), and not the
// deliberate opening grace window (skipStartS) every difficulty grants
// (difficulty.js's `grace` field). Recurring at the same place across
// multiple runs promotes it from "maybe unlucky" to "the map is empty
// there" - see clusterByPosition.
//
// SOFT-LOCK / GEOMETRY TRAP - STUCK results, clustered by position. One
// occurrence is still real evidence (low confidence); two or more at the
// same spot is a real snag a human would also hit (high confidence).
//
// LEGIBILITY DEFECT - a pass-through of checkLegibility()'s own gates
// (the design notes: minContrast >= 17.5, meanContrast >=
// 47.0) into the same ranked-finding shape as everything else, so a
// visual regression shows up next to a design regression, ranked by how
// much it actually costs the player (cosmetic, not blocks-fun).

export const SEVERITY = { BLOCKS_FUN: 0, UNFAIR: 1, DULL: 2, COSMETIC: 3 };
export const SEVERITY_LABEL = { 0: 'blocks-fun', 1: 'unfair', 2: 'dull', 3: 'cosmetic' };

const DEFAULT_MAX_HP = 100;
const UNFAIR_WINDOW_S = 1.2;
const UNFAIR_SPIKE_FRAC = 0.4;
// RECRUIT explicitly promises forgiveness (difficulty.js's own blurb) - a
// spike that would be "earned" on HUNTER/DEADFALL breaks that promise at a
// lower bar here.
const UNFAIR_SPIKE_FRAC_RECRUIT = 0.3;
const NO_TELEGRAPH_HP_FLOOR = 65;
const NO_TELEGRAPH_LOOKBACK_S = 8;

const DEFAULT_BUCKET_SECONDS = 30;
const DEFAULT_MIN_ENTERING = 4;
const DEFAULT_MORTALITY_THRESHOLD = 0.5;
const DEFAULT_DMG_SPIKE_RATIO = 2.0;

const DEFAULT_MIN_GAP_S = 45;
const DEFAULT_SKIP_START_S = 20;
const DEFAULT_CLUSTER_RADIUS = 50;
const DEFAULT_STUCK_CLUSTER_RADIUS = 15;

const DEFAULT_MIN_CONTRAST_GATE = 17.5;
const DEFAULT_MEAN_CONTRAST_GATE = 47.0;

// ---------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------

function groupBy(arr, keyFn) {
  const m = {};
  for (const x of arr) {
    const k = keyFn(x);
    (m[k] = m[k] || []).push(x);
  }
  return m;
}

function average(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// Greedy single-link clustering: an item joins the first existing cluster
// whose running centroid is within `radius`, else starts a new one. Good
// enough for "does this recur at roughly the same place" - not claiming
// optimal clustering, just consistent grouping for evidence.
function clusterByPosition(items, radius) {
  const clusters = [];
  for (const item of items) {
    let target = null;
    for (const c of clusters) {
      const cx = average(c.map((i) => i.startPos.x));
      const cz = average(c.map((i) => i.startPos.z));
      if (Math.hypot(item.startPos.x - cx, item.startPos.z - cz) <= radius) {
        target = c;
        break;
      }
    }
    if (target) target.push(item); else clusters.push([item]);
  }
  return clusters;
}

function fixHypothesisForDeath(source, reasons) {
  const reasonText = reasons.join('; ');
  return `${source}'s hit that killed here had no fair counterplay (${reasonText}). `
    + `Add or widen a telegraph (audio cue, windup animation, wider engage-range warning) `
    + `before ${source} can land this much damage, or cap its burst against a player who has not seen it yet.`;
}

// ---------------------------------------------------------------------
// UNFAIR DEATH
// ---------------------------------------------------------------------

export function findUnfairDeaths(runs, opts = {}) {
  const maxHp = opts.maxHp ?? DEFAULT_MAX_HP;
  const findings = [];

  for (const run of runs) {
    if (run.result !== 'DEAD') continue;
    const dr = run.deathRecord;
    if (!dr || dr.unknown) continue;

    const deathT = dr.t;
    const windowStart = deathT - UNFAIR_WINDOW_S;
    const windowEvents = (run.damageEvents || []).filter((e) => e.t >= windowStart && e.t <= deathT);
    if (windowEvents.length === 0) continue;

    const spikeAmount = windowEvents.reduce((s, e) => s + e.amount, 0);
    const isRecruit = run.difficulty === 'easy';
    const spikeFrac = isRecruit ? UNFAIR_SPIKE_FRAC_RECRUIT : UNFAIR_SPIKE_FRAC;
    const isSpike = spikeAmount >= maxHp * spikeFrac;
    if (!isSpike) continue;

    // "the killing enemy" (brief's own phrasing) means the FINISHING blow,
    // not every hit in the window - real data caught this: a jugg-charge
    // death windowed 3 hits (84 dmg total), 2 unseen then a final visible
    // one. Requiring ALL window events hidden (windowEvents.every(...))
    // never fires on a mixed burst like that and would make this heuristic
    // useless on real combat, which is rarely a single clean hit. Judge the
    // hit that actually ended the run - dr IS the last window event.
    const neverInView = !dr.inView;
    const neverInReach = !dr.withinReactionDist;

    const lookbackStart = windowStart - NO_TELEGRAPH_LOOKBACK_S;
    const priorTicks = (run.ticks || []).filter((t) => t.t >= lookbackStart && t.t < windowStart);
    const noTelegraph = priorTicks.length > 0 && priorTicks.every((t) => t.hp >= NO_TELEGRAPH_HP_FLOOR);

    const reasons = [];
    if (neverInView) reasons.push('killer never in the player\'s view cone or LOS during the fatal window');
    if (neverInReach) reasons.push('killer stayed beyond reaction distance the whole fatal window');
    if (noTelegraph) reasons.push('hp gave no telegraph - the player was healthy right up until the fatal window');
    if (isRecruit) {
      reasons.push('RECRUIT difficulty promises "it bites, but it lets you breathe" - a spike this size breaks that promise');
    }
    if (reasons.length === 0) continue;

    findings.push({
      kind: 'UNFAIR_DEATH',
      severity: SEVERITY.UNFAIR,
      title: `Unfair death: ${run.route}/${run.difficulty} killed by ${dr.source} at t=${deathT}s`,
      confidence: reasons.length >= 2 ? 'high' : 'medium',
      evidence: {
        route: run.route,
        difficulty: run.difficulty,
        deathT,
        source: dr.source,
        spikeAmount: Number(spikeAmount.toFixed(1)),
        windowEvents,
        deathRecord: dr,
        reasons,
      },
      fixHypothesis: fixHypothesisForDeath(dr.source, reasons),
    });
  }

  return findings;
}

// ---------------------------------------------------------------------
// DIFFICULTY SPIKE (hazard-rate time buckets)
// ---------------------------------------------------------------------

// died/entering per fixed-width time bucket from run start. "entering" =
// the run's own timeline lasted at least to this bucket's start (it was
// still going, whether it eventually won, died later, or timed out) -
// this is what keeps a late bucket from reading as 100% lethal just
// because only two long runs are still alive to measure.
export function timeBucketHazard(runs, bucketSeconds = DEFAULT_BUCKET_SECONDS) {
  const maxT = Math.max(0, ...runs.map((r) => r.timeSec || 0));
  const numBuckets = Math.max(1, Math.ceil(maxT / bucketSeconds));
  const buckets = Array.from({ length: numBuckets }, (_, i) => ({
    bucket: i,
    startT: i * bucketSeconds,
    endT: (i + 1) * bucketSeconds,
    entering: 0,
    died: 0,
    dmg: 0,
  }));

  for (const run of runs) {
    const dur = run.timeSec || 0;
    const diedAt = (run.result === 'DEAD' && run.deathRecord && !run.deathRecord.unknown)
      ? run.deathRecord.t
      : null;
    for (let b = 0; b < numBuckets; b++) {
      const bs = buckets[b].startT;
      if (dur <= bs) continue; // run's own timeline never reached this bucket
      buckets[b].entering++;
      if (diedAt !== null && diedAt >= bs && diedAt < buckets[b].endT) buckets[b].died++;
    }
    for (const ev of run.damageEvents || []) {
      const b = Math.min(numBuckets - 1, Math.max(0, Math.floor(ev.t / bucketSeconds)));
      buckets[b].dmg += ev.amount;
    }
  }

  return buckets.map((b) => ({
    ...b,
    mortality: b.entering > 0 ? Number((b.died / b.entering).toFixed(2)) : 0,
    dmgPerMin: b.entering > 0 ? Number((b.dmg / b.entering / (bucketSeconds / 60)).toFixed(1)) : 0,
  }));
}

export function findDifficultySpikes(runs, opts = {}) {
  const bucketSeconds = opts.bucketSeconds ?? DEFAULT_BUCKET_SECONDS;
  const minEntering = opts.minEntering ?? DEFAULT_MIN_ENTERING;
  const mortalityThreshold = opts.mortalityThreshold ?? DEFAULT_MORTALITY_THRESHOLD;
  const dmgSpikeRatio = opts.dmgSpikeRatio ?? DEFAULT_DMG_SPIKE_RATIO;

  const findings = [];
  const byRoute = groupBy(runs, (r) => r.route);

  for (const [route, routeRuns] of Object.entries(byRoute)) {
    const buckets = timeBucketHazard(routeRuns, bucketSeconds);
    const eligible = buckets.filter((b) => b.entering >= minEntering);
    const meanDmgPerMin = average(eligible.filter((b) => b.dmgPerMin > 0).map((b) => b.dmgPerMin));

    for (const b of eligible) {
      const reasons = [];
      if (b.mortality >= mortalityThreshold) {
        reasons.push(`${b.died}/${b.entering} runs that reached this window (${Math.round(b.mortality * 100)}%) died in it`);
      }
      if (meanDmgPerMin > 0 && b.dmgPerMin >= meanDmgPerMin * dmgSpikeRatio) {
        reasons.push(`damage/min ${b.dmgPerMin} is ${(b.dmgPerMin / meanDmgPerMin).toFixed(1)}x the route's mean (${meanDmgPerMin.toFixed(1)})`);
      }
      if (reasons.length === 0) continue;

      findings.push({
        kind: 'DIFFICULTY_SPIKE',
        severity: SEVERITY.UNFAIR,
        title: `Difficulty spike: ${route} at t=${b.startT}-${b.endT}s`,
        confidence: reasons.length >= 2 ? 'high' : 'medium',
        evidence: { route, bucket: b, meanDmgPerMin: Number(meanDmgPerMin.toFixed(1)), reasons },
        fixHypothesis: `Check what lands on ${route} in the t=${b.startT}-${b.endT}s window (director budget/heat ramp, `
          + `a chokepoint garrison, or the extraction hold if this is near the end) and soften the ramp into it.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------
// PACING DEAD ZONE
// ---------------------------------------------------------------------

export function findDeadZonesInRun(run, opts = {}) {
  const minGapS = opts.minGapS ?? DEFAULT_MIN_GAP_S;
  const skipStartS = opts.skipStartS ?? DEFAULT_SKIP_START_S;
  const ticks = run.ticks || [];
  const zones = [];
  let zoneTicks = [];

  const closeZone = () => {
    if (zoneTicks.length === 0) return;
    const startT = zoneTicks[0].t;
    const endT = zoneTicks[zoneTicks.length - 1].t;
    const duration = endT - startT;
    if (duration >= minGapS && startT >= skipStartS) {
      zones.push({
        startT, endT, duration: Number(duration.toFixed(1)),
        startPos: { x: zoneTicks[0].x, z: zoneTicks[0].z },
        endPos: { x: zoneTicks[zoneTicks.length - 1].x, z: zoneTicks[zoneTicks.length - 1].z },
      });
    }
    zoneTicks = [];
  };

  for (const t of ticks) {
    const quiet = t.enemiesNear && t.enemiesNear.count === 0;
    if (quiet) zoneTicks.push(t);
    else closeZone();
  }
  closeZone();

  return zones;
}

export function findPacingDeadZones(runs, opts = {}) {
  const clusterRadius = opts.clusterRadius ?? DEFAULT_CLUSTER_RADIUS;
  const findings = [];
  const byRoute = groupBy(runs, (r) => r.route);

  for (const [route, routeRuns] of Object.entries(byRoute)) {
    const allZones = [];
    for (const run of routeRuns) {
      for (const z of findDeadZonesInRun(run, opts)) allZones.push({ ...z, run });
    }
    if (allZones.length === 0) continue;

    const clusters = clusterByPosition(allZones, clusterRadius);
    for (const cluster of clusters) {
      const runsInCluster = new Set(cluster.map((z) => z.run));
      const confidence = runsInCluster.size >= 2 ? 'high' : 'low';
      const maxDur = Math.max(...cluster.map((z) => z.duration));
      const cx = Math.round(average(cluster.map((z) => z.startPos.x)));
      const cz = Math.round(average(cluster.map((z) => z.startPos.z)));

      findings.push({
        kind: 'PACING_DEAD_ZONE',
        severity: SEVERITY.DULL,
        title: `Pacing dead zone: ${route} near (${cx},${cz}) - up to ${maxDur}s with zero threat nearby`,
        confidence,
        evidence: {
          route,
          occurrences: cluster.length,
          runsInvolved: runsInCluster.size,
          zones: cluster.map(({ run, ...z }) => z),
        },
        fixHypothesis: `Add an ambient beat around (${cx},${cz}) on ${route} - a roaming enemy, a noise cue, a loot `
          + `pickup - nothing currently happens here for up to ${maxDur}s.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------
// SOFT-LOCK / GEOMETRY TRAP
// ---------------------------------------------------------------------

export function findSoftLocks(runs, opts = {}) {
  const clusterRadius = opts.clusterRadius ?? DEFAULT_STUCK_CLUSTER_RADIUS;
  const stuckItems = runs
    .filter((r) => r.result === 'STUCK' && r.stuckAt)
    .map((r) => ({ startPos: { x: r.stuckAt.x, z: r.stuckAt.z }, run: r }));
  if (stuckItems.length === 0) return [];

  const clusters = clusterByPosition(stuckItems, clusterRadius);
  return clusters.map((cluster) => {
    const cx = Math.round(average(cluster.map((c) => c.startPos.x)));
    const cz = Math.round(average(cluster.map((c) => c.startPos.z)));
    const route = cluster[0].run.route;
    return {
      kind: 'SOFT_LOCK',
      severity: SEVERITY.BLOCKS_FUN,
      title: `Soft-lock: ${route} bot stuck near (${cx},${cz})`,
      confidence: cluster.length >= 2 ? 'high' : 'low',
      evidence: {
        route,
        occurrences: cluster.length,
        stuckAt: cluster.map((c) => c.run.stuckAt),
      },
      fixHypothesis: `Check collider geometry near (${cx},${cz}) on ${route} (waypoint `
        + `${cluster[0].run.stuckAt.wp ?? '?'}) for a wedge or trap a human could also snag on.`,
    };
  });
}

// ---------------------------------------------------------------------
// LEGIBILITY DEFECT (pass-through of checkLegibility()'s own gates)
// ---------------------------------------------------------------------

export function findLegibilityDefects(legibilityResult, opts = {}) {
  if (!legibilityResult || !legibilityResult.perArchetype || legibilityResult.perArchetype.length === 0) return [];
  const minContrastGate = opts.minContrastGate ?? DEFAULT_MIN_CONTRAST_GATE;
  const meanContrastGate = opts.meanContrastGate ?? DEFAULT_MEAN_CONTRAST_GATE;
  const findings = [];

  if (legibilityResult.minContrast !== null && legibilityResult.minContrast < minContrastGate) {
    findings.push({
      kind: 'LEGIBILITY_DEFECT',
      severity: SEVERITY.COSMETIC,
      title: `Legibility gate regression: min contrast ${legibilityResult.minContrast} below the ${minContrastGate} floor (worst: ${legibilityResult.worstArchetype})`,
      confidence: 'high',
      evidence: { ...legibilityResult },
      fixHypothesis: `${legibilityResult.worstArchetype} is under the legibility floor - brighten its rim/emissive `
        + `or reduce the vegetation density it is tested against (the design notes).`,
    });
  }
  if (legibilityResult.meanContrast !== null && legibilityResult.meanContrast < meanContrastGate) {
    findings.push({
      kind: 'LEGIBILITY_DEFECT',
      severity: SEVERITY.COSMETIC,
      title: `Legibility gate regression: mean contrast ${legibilityResult.meanContrast} below the ${meanContrastGate} floor`,
      confidence: 'high',
      evidence: { ...legibilityResult },
      fixHypothesis: 'Overall archetype legibility has drifted down - re-run checkLegibility() per archetype to find which one moved.',
    });
  }
  for (const a of legibilityResult.perArchetype) {
    if (a.contrast < minContrastGate) {
      findings.push({
        kind: 'LEGIBILITY_DEFECT',
        severity: SEVERITY.COSMETIC,
        title: `${a.type} contrast ${a.contrast} is below the ${minContrastGate} floor`,
        confidence: 'medium',
        evidence: { archetype: a.type, contrast: a.contrast, maskPixels: a.maskPixels },
        fixHypothesis: `${a.type} needs more contrast against dense vegetation - see checkLegibility() and the design notes.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------
// TOP-LEVEL ORCHESTRATION
// ---------------------------------------------------------------------

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

export function critique(runs, opts = {}) {
  const findings = [
    ...findSoftLocks(runs, opts.softLock),
    ...findUnfairDeaths(runs, opts.unfairDeath),
    ...findDifficultySpikes(runs, opts.difficultySpike),
    ...findPacingDeadZones(runs, opts.pacing),
    ...findLegibilityDefects(opts.legibilityResult, opts.legibility),
  ];

  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    return (CONFIDENCE_RANK[a.confidence] ?? 1) - (CONFIDENCE_RANK[b.confidence] ?? 1);
  });
  findings.forEach((f, i) => { f.id = `F${i + 1}`; });

  const byResult = groupBy(runs, (r) => r.result);
  const summary = {
    totalRuns: runs.length,
    wins: (byResult.WIN || []).length,
    deaths: (byResult.DEAD || []).length,
    stuck: (byResult.STUCK || []).length,
    timeout: (byResult.TIMEOUT || []).length,
    findingCount: findings.length,
    findingsBySeverity: {
      'blocks-fun': findings.filter((f) => f.severity === SEVERITY.BLOCKS_FUN).length,
      unfair: findings.filter((f) => f.severity === SEVERITY.UNFAIR).length,
      dull: findings.filter((f) => f.severity === SEVERITY.DULL).length,
      cosmetic: findings.filter((f) => f.severity === SEVERITY.COSMETIC).length,
    },
  };

  return { findings, summary };
}

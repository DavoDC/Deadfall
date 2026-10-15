// Pure view-model for the end-of-run result panel (EXTRACTED / K.I.A.), kept
// out of main.js so the text and the state rules are unit-testable without a
// browser. main.js turns this into DOM; index.html holds the markup.
// Points, grade and rank title come from scoring.js.

import { scoreRun } from './scoring.js';
import { causeLabel } from './causeOfDeath.js';

export function formatRunTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function signed(n) {
  return (n >= 0 ? '+' : '-') + Math.abs(n);
}

// run: { extracted, difficulty, difficultyLabel, time, kills, shots, hits, damage, isRecord, cause }
export function resultView(run) {
  const sc = scoreRun(run);
  return {
    title: run.extracted ? 'EXTRACTED' : 'K.I.A.',
    titleClass: run.extracted ? 'extracted' : 'died',
    difficultyLabel: run.difficultyLabel,
    killedBy: run.extracted ? '' : causeLabel(run.cause),
    score: sc,
    grade: sc.grade,
    rank: sc.title,
    tag: sc.tag,
    total: String(sc.total),
    breakdown: sc.lines.map((l) => [l.label, signed(l.points)]),
    multiplierLabel: `x${sc.multiplier.toFixed(2)} ${run.difficultyLabel}`,
    // every row of the score box in order: line items, the difficulty multiplier, TOTAL last
    rows: [
      ...sc.lines.map((l) => [l.label, signed(l.points)]),
      ['DIFFICULTY', `x${sc.multiplier.toFixed(2)} ${run.difficultyLabel}`],
      ['TOTAL', String(sc.total)],
    ],
    copyText: sc.copyText,
    stats: [
      ['TIME', formatRunTime(run.time)],
      ['KILLS', String(run.kills)],
      ['SHOTS', String(run.shots)],
      ['DAMAGE TAKEN', String(Math.round(run.damage))],
    ],
    record: !!run.isRecord,
    flavor: run.extracted ? '' : 'The jungle keeps what it kills.',
  };
}

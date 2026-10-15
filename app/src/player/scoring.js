// Pure scoring for the result screen: points from the run stats, a letter
// grade, a rank title and one style tag. No DOM, deterministic, unit-tested.
// Tuning lives in SCORE so balance changes are one-line edits.

export const SCORE = {
  perKill: 100,
  accuracyMax: 800,       // 100% accuracy; scaled by hits / shots
  parTime: 600,           // seconds; faster extractions earn speed points
  speedPerSec: 2,
  speedMax: 1000,
  extraction: 2000,
  damagePenalty: 4,       // points lost per hp of damage taken
  multipliers: { easy: 0.75, normal: 1, hard: 1.3 },
  // total score (after the difficulty multiplier) needed for each grade; K.I.A. is always F
  grades: { S: 6500, A: 5000, B: 3500, C: 2200 },
};

const TITLES = {
  S: 'JUNGLE LEGEND',
  A: 'APEX HUNTER',
  B: 'SEASONED SCOUT',
  C: 'LUCKY SURVIVOR',
  D: 'LIMPING HOME',
};

export function gradeFor(total, extracted) {
  if (!extracted) return 'F';
  const g = SCORE.grades;
  if (total >= g.S) return 'S';
  if (total >= g.A) return 'A';
  if (total >= g.B) return 'B';
  if (total >= g.C) return 'C';
  return 'D';
}

function titleFor(grade, kills) {
  if (grade !== 'F') return TITLES[grade];
  if (kills <= 0) return 'FOOD FOR THE JUNGLE';
  return kills < 8 ? 'FALLEN SCOUT' : 'FALLEN PREDATOR';
}

function tagFor({ damage, accuracy, kills, time, extracted }) {
  if (extracted && damage < 1) return 'UNTOUCHED';
  if (accuracy >= 0.6 && kills >= 3) return 'DEAD EYE';
  if (extracted && time < SCORE.parTime * 0.5) return 'SWIFT AS A STORM';
  if (kills >= 30) return 'TROPHY HUNTER';
  if (extracted && damage >= 150) return 'IRON HIDE';
  return '';
}

// run: { extracted, difficulty, time, kills, shots, hits, damage }
export function scoreRun(run) {
  const extracted = !!run.extracted;
  const time = Math.max(0, Number(run.time) || 0);
  const kills = Math.max(0, Math.floor(Number(run.kills) || 0));
  const shots = Math.max(0, Number(run.shots) || 0);
  const hits = Math.max(0, Number(run.hits) || 0);
  const damage = Math.max(0, Number(run.damage) || 0);
  const accuracy = shots > 0 ? Math.min(1, hits / shots) : 0;

  const lines = [
    { key: 'kills', label: 'KILLS', points: kills * SCORE.perKill },
    { key: 'accuracy', label: 'ACCURACY', points: Math.round(accuracy * SCORE.accuracyMax) },
  ];
  if (extracted) {
    const speed = Math.min(SCORE.speedMax, Math.max(0, Math.round((SCORE.parTime - time) * SCORE.speedPerSec)));
    lines.push({ key: 'speed', label: 'SPEED', points: speed });
    lines.push({ key: 'extraction', label: 'EXTRACTION', points: SCORE.extraction });
  }
  lines.push({ key: 'damage', label: 'DAMAGE TAKEN', points: -Math.round(damage * SCORE.damagePenalty) });

  const multiplier = SCORE.multipliers[run.difficulty] ?? SCORE.multipliers.normal;
  const subtotal = lines.reduce((a, l) => a + l.points, 0);
  const total = Math.max(0, Math.round(subtotal * multiplier));
  const grade = gradeFor(total, extracted);
  const title = titleFor(grade, kills);
  const tag = tagFor({ damage, accuracy, kills, time, extracted });
  const mm = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
  const copyText = `DEADFALL ${extracted ? 'EXTRACTED' : 'K.I.A.'} | ${grade} ${title} | ${total} pts | ${mm}, ${kills} kills, ${Math.round(accuracy * 100)}% acc, ${Math.round(damage)} dmg | ${String(run.difficulty || 'normal').toUpperCase()}`;
  return { lines, subtotal, multiplier, total, grade, title, tag, copyText };
}

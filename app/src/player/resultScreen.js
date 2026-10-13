// Pure view-model for the end-of-run result panel (EXTRACTED / K.I.A.), kept
// out of main.js so the text and the state rules are unit-testable without a
// browser. main.js turns this into DOM; index.html holds the markup.

export function formatRunTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// run: { extracted, difficultyLabel, time, kills, shots, damage, isRecord }
export function resultView(run) {
  return {
    title: run.extracted ? 'EXTRACTED' : 'K.I.A.',
    titleClass: run.extracted ? 'extracted' : 'died',
    difficultyLabel: run.difficultyLabel,
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

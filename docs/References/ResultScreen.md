# Result screen

The screen shown after every run (EXTRACTED or K.I.A.). It is a single centred panel in `#endscreen` (`app/index.html`), filled by the end-of-run code in `app/src/main.js`; the title menu is hidden behind it and the backdrop is almost opaque so nothing from the game shows through.

## Aim

The result screen is the moment a run turns into something worth talking about. It should:

- Tell the player at a glance how the run went (outcome, time, kills, shots, damage taken, NEW RECORD).
- Make them want to go again (RUN IT AGAIN is the primary button) and to compare with friends.
- Be easy to screenshot and share: one clean, self-contained panel with everything a friend needs to see how well the run went.
- Stay quick to read: stats first, flavour second, no clutter.

## What it shows today

Title (EXTRACTED or K.I.A.), difficulty, a stats row (time, kills, shots, damage taken), NEW RECORD when the best time is beaten, a flavour line, RUN IT AGAIN, a compact difficulty selector and a small QUIT button.

## Not built yet

- A score with a points breakdown (time, kills, accuracy, damage avoided, difficulty multiplier, extraction bonus).
- A letter grade and a short title for the run (quantitative and qualitative), for example S to D, with descriptive words for the style of play.
- Per-category breakdown lines (what earned and what cost points).
- A shareable summary (copyable text or image) so friends can compare scores.
- Personal bests per difficulty beyond the time record.

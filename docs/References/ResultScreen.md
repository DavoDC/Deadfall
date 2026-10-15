# Result screen

The screen shown after every run (EXTRACTED or K.I.A.). It is a single centred panel in `#endscreen` (`app/index.html`), filled by the end-of-run code in `app/src/main.js`; the title menu is hidden behind it and the backdrop is almost opaque so nothing from the game shows through.

## Aim

The result screen is the moment a run turns into something worth talking about. It should:

- Tell the player at a glance how the run went (outcome, time, kills, shots, damage taken, NEW RECORD).
- Make them want to go again (RUN IT AGAIN is the primary button) and to compare with friends.
- Be easy to screenshot and share: one clean, self-contained panel with everything a friend needs to see how well the run went.
- Stay quick to read: stats first, flavour second, no clutter.

## What it shows today

Title (EXTRACTED or K.I.A.), difficulty, a big letter grade with the score and a rank title (plus one style tag when earned), a stats row (time, kills, shots, damage taken), a compact breakdown of what earned and cost points, NEW RECORD when the best time is beaten, a flavour line, RUN IT AGAIN, COPY RESULT, a compact difficulty selector and a small QUIT button.

## Scoring

The maths is a small pure module, `app/src/player/scoring.js` (`scoreRun`, `gradeFor`, tuning in `SCORE`), unit-tested in `app/tests/scoring.test.js`. `resultView` in `app/src/player/resultScreen.js` feeds it and `renderResult` in `app/src/main.js` draws it.

- Earns: kills (100 each), accuracy (up to 800, scaled by hits over shots), and on EXTRACTED only a speed bonus (2 points per second under a 600 second par, up to 1000) and the extraction bonus (2000).
- Costs: damage taken (4 points per hp).
- The subtotal is multiplied by the difficulty (RECRUIT x0.75, HUNTER x1.00, DEADFALL x1.30) and floored at 0.
- Grade (extracted only): S from 6500, A from 5000, B from 3500, C from 2200, otherwise D. K.I.A. is always F and earns no speed or extraction lines.
- Rank titles: S JUNGLE LEGEND, A APEX HUNTER, B SEASONED SCOUT, C LUCKY SURVIVOR, D LIMPING HOME; for F, FOOD FOR THE JUNGLE (no kills), FALLEN SCOUT (under 8) or FALLEN PREDATOR.
- Style tags (first that applies): UNTOUCHED, DEAD EYE, SWIFT AS A STORM, TROPHY HUNTER, IRON HIDE.
- COPY RESULT puts a one-line summary on the clipboard (`copyText`) for pasting to friends.
- The score, grade, title and tag are written to the telemetry session as `result` ([Telemetry.md](Telemetry.md)), so `analyzeSession.mjs` prints them.

Balance is a first pass: treat the numbers as tuning knobs and adjust from real playtest sessions.

## Not built yet

- A shareable image (the copyable text exists; an image is not built).
- Personal bests per difficulty beyond the time record.

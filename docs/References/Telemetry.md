# Telemetry - the playtest flight recorder

What the game records during a human playtest, how it reaches disk, and how to read it. Everything here is built and running. The point: a playtest is fully observable straight from files, with no browser automation and no interruption of the player.

## Transport

The page posts fire-and-forget (never blocks a frame, failures are silent) to the local server. The same endpoints exist in both launcher modes (the Vite dev server and the `vite preview` server used in player mode), defined in `app/config/vite.config.js`; the write logic is `app/src/server/telemetryStore.js`.

- `POST /telemetry`: the session, as a delta (see Flush behaviour). The server holds the session in memory, merges each delta, stamps `lastSavedAt`, and writes `app/captures/telemetry/session-<startedAt>.json` plus the mirror `latest.json` atomically (temp file, then rename), so a crash can never leave a half-written file. The answer is `{lens}`, the array lengths the server now holds; HTTP 409 means the server lacks data the client believes it sent, and the client resends from the lengths in the answer. A full legacy snapshot (an older client) is still accepted and stored whole.
- `POST /telemetry/frame`: `{startedAt, t, dataURL}`. A JPEG about 640 px wide (quality 0.6) written to `app/captures/telemetry/frames/<startedAt>/<t>.jpg`. Sent every 0.5 s of play while recording (`FRAME_INTERVAL_S` in `app/src/game/frameCadence.js`), plus on a damage spike, death, run end and the flood surge. At most 3000 frames are written per session (`FRAME_CAP_PER_SESSION`): past that the server answers 409, writes nothing, deletes nothing and logs once; the browser also stops sending. The server does not rate-limit frames. Frame size is unchanged (already about 640 px wide at quality 0.6).
- `POST /telemetry/capture`: `{subdir, filename, dataURL}`. Named captures from the recorder and screenshot rig, written to `app/captures/telemetry/<subdir>/<filename>`.

Telemetry text (session JSON) stays under `app/captures/telemetry/` next to its frames; script and server logs live in `app/logs/`. Both folders are gitignored.

## Flush behaviour

The session is saved, never held until the end:

- On a 3 s timer while a run is recording.
- Immediately on every notable moment: run start, waypoint, death, extraction, pause and resume, tab hidden or visible, run end. Kills and damage taken are throttled to one save per 0.5 s with a trailing save, so a firefight cannot flood the server.
- On `visibilitychange` (hidden), `pagehide` and `beforeunload`, with `navigator.sendBeacon`. Closing the tab ends the session as `outcome: "abandoned"`, `endReason: "tab-closed"`.
- QUIT from the pause menu records `endReason: "quit"` and waits for the save before stopping the server.

Each save sends only what the server does not hold yet: every scalar field in full (small), and for each array the entries from the last length the server confirmed (`{delta, startedAt, seq, scalars, arrays: {name: {from, items}}}`, built by `app/src/game/telemetryDelta.js`). Writing entries at fixed indices makes a repeated or reordered request harmless, and scalars from an older `seq` are ignored, so a late stale request cannot undo the final state. Only one request is in flight; it has a timeout, so a hung request cannot stall later saves. The body stays far below the 64 KiB limit browsers put on keepalive and beacon requests; the earlier design posted the whole pretty-printed session with keepalive, the first snapshot over 64 KiB was rejected silently, and a real playtest froze on disk at its first 78 s. Entries that change after being sent (the encounter log) are resent from their first changed index.

Every file on disk is valid and complete so far. While a run is going, `outcome` is `"in-progress"` and `endedAt` is null; `lastSavedAt` (server clock, ms) moves on every write. A file that stays `in-progress` with an old `lastSavedAt` means the game or browser died: the run was abandoned or crashed. Files from before this change have `outcome: null`, no `endReason` and no `lastSavedAt`, and read the same way.

## Session JSON fields

- Run metadata: `startedAt`, `endedAt`, `lastSavedAt`, `outcome` (`in-progress`, `extracted`, `died`, `abandoned`), `endReason` (`extracted`, `death`, `quit`, `tab-closed`, `unknown`), difficulty, seed, `gameVersion`.
- `deaths` and `damageTaken` entries carry `hp` (the player's health after the hit; 0 on the lethal one). Every time in the session (`state`, `deaths.time`, `damageTaken.time`, `damageDealt.time`) is wall-clock seconds since the run started, the same clock as `startedAt` and `endedAt`, so a death after a pause lands where it really happened.
- `deaths`, `damageTaken`, `damageTakenBySource`, `damageDealt`, `damageDealtByTarget`, `shots` (fired, hits), `waypoints` (first arrival), `events`, `fps` (sampled every 2 s).
- `path`: the route, one point per second `{time, x, z, y, yaw}`. About 60 bytes a point, so a 5 minute run adds roughly 18 KB.
- `inputEdges`: `{t, action, on}` at full fidelity for key and button presses (jump, reload, weapon 1/2/3, swap, grenade throw, fire and aim start and stop).
- `inputAggregates`: once per second `{t, distance, pctSprint, aimSeconds, lookSpeedMeanDegPerSec, lookSpeedPeakDegPerSec, shots}`.
- `state`: once per second `{t, pos, yaw, hp, stamina, ammo, weapon, speedMps, slopeDeg, verticalVel, grounded, enemiesNear, threat, fps, frameMs}`.
- `bursts`: on a death or a hit of 15 hp or more, 10 Hz state samples from the 5 s before to the 2 s after, so an unfair death can be explained.

Raw per-frame input is never logged. A died or partial run still leaves a complete file because the session is flushed continuously.

## HUD coordinates

The HUD shows world `x,z` and the nearest landmark so a player can say "it happened at 120,-40" and the moment can be found in the log.

## Reading it

`node src/tools/analyse-telemetry.mjs` (run from `app/`) prints a digest of `captures/telemetry`; `node src/tools/analyzeSession.mjs <file or folder>` prints a one-page report of one session (guide: [PlaytestAnalysis.md](PlaytestAnalysis.md)). `scripts\save-logs.bat` bundles scrubbed logs and the newest sessions for playtesters to send back.

## Not built yet

- Opt-in video recording of a session (`/telemetry/video`). Video export exists only as the separate recorder tool.

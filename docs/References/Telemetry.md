# Telemetry - the playtest flight recorder

What the game records during a human playtest, how it reaches disk, and how to read it. Everything here is built and running. The point: a playtest is fully observable straight from files, with no browser automation and no interruption of the player.

## Transport

The page posts fire-and-forget (never blocks a frame, failures are silent) to the local server. The same endpoints exist in both launcher modes (the Vite dev server and the `vite preview` server used in player mode), defined in `app/config/vite.config.js`; the write logic is `app/src/server/telemetryStore.js`.

- `POST /telemetry`: JSON session. Written to `app/captures/telemetry/session-<startedAt>.json` and mirrored to `latest.json`, overwritten as the session updates. Posted about every second, after notable events and at run end, through a coalescing sender so a stale snapshot never overwrites the final state. A last-gasp `sendBeacon` runs on tab close.
- `POST /telemetry/frame`: `{startedAt, t, dataURL}`. A JPEG about 640 px wide (quality 0.6) written to `app/captures/telemetry/frames/<startedAt>/<t>.jpg`. Sent every 10 s while recording, plus on a damage spike, death, run end and the flood surge.
- `POST /telemetry/capture`: `{subdir, filename, dataURL}`. Named captures from the recorder and screenshot rig, written to `app/captures/telemetry/<subdir>/<filename>`.

Telemetry text (session JSON) stays under `app/captures/telemetry/` next to its frames; script and server logs live in `app/logs/`. Both folders are gitignored.

## Session JSON fields

- Run metadata, `startedAt`, `endedAt`, `outcome`, difficulty, seed.
- `deaths`, `damageTaken`, `damageTakenBySource`, `damageDealt`, `damageDealtByTarget`, `shots` (fired, hits), `waypoints` (first arrival), `events`, `fps` and `path` (sampled every 2 s).
- `inputEdges`: `{t, action, on}` at full fidelity for key and button presses (jump, reload, weapon 1/2/3, swap, grenade throw, fire and aim start and stop).
- `inputAggregates`: once per second `{t, distance, pctSprint, aimSeconds, lookSpeedMeanDegPerSec, lookSpeedPeakDegPerSec, shots}`.
- `state`: once per second `{t, pos, yaw, hp, stamina, ammo, weapon, speedMps, slopeDeg, verticalVel, grounded, enemiesNear, threat, fps, frameMs}`.
- `bursts`: on a death or a hit of 15 hp or more, 10 Hz state samples from the 5 s before to the 2 s after, so an unfair death can be explained.

Raw per-frame input is never logged. A died or partial run still leaves a complete file because the session is flushed continuously.

## HUD coordinates

The HUD shows world `x,z` and the nearest landmark so a player can say "it happened at 120,-40" and the moment can be found in the log.

## Reading it

`node src/tools/analyse-telemetry.mjs` (run from `app/`) prints a digest of `captures/telemetry`. `scripts\save-logs.bat` bundles scrubbed logs and the newest sessions for playtesters to send back.

## Not built yet

- Opt-in video recording of a session (`/telemetry/video`). Video export exists only as the separate recorder tool.

# Telemetry v2 - the playtest flight recorder (spec, 2026-07-18)

Deep-dive output. Goal (David): every human playtest is FULLY observable to Claude
straight from disk - "u shouldnt need to query or use MCP just read log files". Rich:
human input, game state, visual. Built BEFORE the next playtest is requested.

## The core problem with v1
Telemetry v1 lives in the browser tab's memory. Claude can only read it by driving that
exact tab over MCP - fragile, and it interrupts the player. Both 2026-07-18 runs died and
their rich data was LOST. Everything below follows from fixing that.

## Architecture: POST to the dev server, which writes files

Add a vite `configureServer` middleware in `app/config/vite.config.js`:
- `POST /telemetry` - JSON body -> write `app/captures/telemetry/session-<startedAt>.json`
  (overwrite the same file as the session updates; also mirror to `latest.json`).
- `POST /telemetry/frame` - JPEG dataURL/blob + timestamp -> write
  `app/captures/telemetry/frames/<startedAt>/<t>.jpg`.
- `POST /telemetry/video` (opt-in) -> write `app/captures/telemetry/session-<startedAt>.webm`.
`app/captures/` is gitignored. Claude then just reads files. No MCP, no browser, no interruption.

Client posts fire-and-forget (never block a frame, ignore failures, no game impact).

## Channel 1 - HUMAN INPUT (highest value/cost ratio)
Seam: wrap `input.sample()` in `src/main.js` (same pattern telemetry already uses on
`weaponHooks`). `sample()` already returns the full intent: moveX/moveZ, lookDX/lookDY,
sprint, jump, reload, weapon1/2/3, swap, interact, melee, grenadeHold/grenadeThrow, aim,
firing, fireDown.
- **Edges at full fidelity** (sparse, and where the meaning is): key/button down+up, weapon
  swap, jump, reload, fire start/stop, aim start/stop, grenade throw - each `{t, action, on}`.
- **1s aggregates** for continuous axes: distance moved, % time sprinting, mean/peak look
  speed (deg/s), shots fired, time aiming. Never log raw 60fps intents.

## Channel 2 - GAME STATE (1s baseline + 10Hz burst around incidents)
Per 1s sample: `{t, pos:{x,y,z}, yaw, hp, stamina, ammo, weapon, speedMps, slopeDeg,
verticalVel, grounded, enemiesNear:{count,types}, threat, fps, frameMs}`.
- **Burst mode:** on death, or damage >= a threshold, retain/emit 10Hz samples for the 5s
  BEFORE and 2s AFTER (ring buffer). That is what explains an unfair death.
- These fields are chosen to diagnose David's reported bugs directly: `stamina` (never
  depletes), `speedMps` + `slopeDeg` (uphill same speed as flat), `verticalVel` + `grounded`
  (jumpy walking uphill), `enemiesNear` + damage source (tiny deadly flyers, extract swarm).
- Keep existing v1 fields (deaths, damageBySource, damageDealt, shots, kills, waypoints,
  events, outcome, difficulty, seed).

## Channel 3 - VISUAL
- **Screenshots (default ON):** `renderer.domElement.toDataURL('image/jpeg', 0.6)` downscaled
  to ~640px wide. Every ~10s, PLUS event-triggered: on death, on damage spike, on flood/boss/
  extraction start. POST to `/telemetry/frame` with the telemetry timestamp so images key to
  the timeline. Use async `toBlob` where possible; skip a capture if the frame budget is tight.
- **Video (opt-in flag, e.g. `?video=1`):** MediaRecorder + `canvas.captureStream()` DOES work
  in a real foregrounded window (the earlier "cannot record" finding applies only to the
  throttled automation tab). Chunked POST to `/telemetry/video`. Off by default - screenshots
  plus state answer most questions at a fraction of the size.

## Channel 4 - HUD COORDINATE READOUT
Show world `x,z` (and maybe the nearest landmark) on the HUD so David can say "it happened
at 120,-40" and Claude can find that exact moment in the log.

## Never stop recording
Log continuously across the whole play session, not one run: partial runs, deaths, restarts,
menu time. A died run must leave a complete file on disk (both 2026-07-18 runs lost theirs).

## Guardrails (the real risk is flooding, not feasibility)
- No raw per-frame logging. Edges + 1s aggregates + incident bursts only.
- Fire-and-forget POSTs, coalesced; never block the render loop; failures are silent.
- Keep a session JSON readable by a human and by Claude without blowing context - target
  well under a megabyte for a 6-minute run; frames live as separate files.
- Never write to Downloads (workspace rule); everything goes to gitignored `app/captures/`.

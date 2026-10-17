# Playtest analysis - turning a friend's logs into fixes

How to collect a playtest, read every field, and decide what to change. Field definitions live in [Telemetry.md](Telemetry.md); this page is the workflow.

## 1. Collect

1. The friend runs `scripts\save-logs.bat` after playing. It writes a ZIP (logs, system info, telemetry, screenshots) with their user name and paths scrubbed. Nothing is uploaded.
2. They send you the ZIP. Extract it into its own empty folder.
3. Run the one-page report:

```
cd app
node src/tools/analyzeSession.mjs <extracted folder or a session-*.json>
```

A folder is searched (and its `telemetry` subfolder) for the newest `session-*.json`. For your own runs use `app/captures/telemetry`. The older digest across all sessions is `node src/tools/analyse-telemetry.mjs`.

## 2. Where things are

| In the ZIP | What it is |
|---|---|
| `VERSION.txt` | Build (commit id and date). Check it matches the build you meant to test. |
| `system.txt` | Windows, CPU, RAM, graphics card, screen, browser, Node. First stop for "it ran badly". |
| `logs\server.log` | What the game server saw; errors on save show here. |
| `logs\launch-*.log`, `update-*.log` | Start-up and update problems. |
| `telemetry\session-*.json` | One file per play session, saved continuously. |
| `telemetry\latest.json` | A copy of the newest session. |
| `telemetry\frames\` | Screenshots taken during play. |

## 3. Was the file complete

`outcome` tells you. `extracted` and `died` are clean ends. `in-progress` with a stale `lastSavedAt` and `abandoned` mean the run stopped without an end: the player closed the tab (`endReason: tab-closed`), quit, or the machine or browser crashed (`endReason` null, `unknown`). Everything before the last save is valid. Files from before the incremental save have no `outcome`; if `endedAt` is null they were cut off.

## 4. Reading the fields

- Header: `startedAt`, `difficulty`, `seed`, `gameVersion`, `outcome`, `endReason`, `lastSavedAt`, `env` (GPU, screen, pixel ratio, quality).
- `path`: where the player went, one point a second (x, z, y, yaw). Plot it, or read stalls and time per segment from the report.
- `state`: once a second, health, stamina, ammo, weapon, speed, enemies near, threat, extraction progress, fps.
- `fps`: every 2 seconds. `bursts`: 10 Hz detail around deaths and hits of 15 hp or more.
- `encounters`: every enemy spawn, when first seen and from how far, how it ended, damage it did. `spawned` counts by type.
- `damageTakenBySource`, `damageDealtByTarget`, `shots`, `kills`, `waypoints`, `events` (pause, tab hidden, extraction, start).
- `inputEdges` and `inputAggregates`: presses and per-second input summaries (sprint share, look speed, aim time).
- `errors`: uncaught errors, first 20.
- Pauses: the report prints `Length 5:48 (play 4:48, paused 0:59)`. Paused time comes from the `paused` and `resumed` events and is left out of stalls and frame times, so a stall is only standing still while the game was running. Older files without `playSeconds` still work because the report derives it from the events.

`node src/tools/analyzeSession.mjs` prints `Score: N G TITLE (tag)`, `HP over time` (state samples plus the hp on each damage entry), `Input:` (counts per action, sprint and aim seconds, edges kept and dropped) and a WARNING when HP stays flat although damage was taken (the HP bug the log once had). Files from before these fields print `Input: none recorded` and no score.

## 5. Standard questions

| Question | Where to look | Good | Bad |
|---|---|---|---|
| Did it run well? | report Performance, `env.gpu` | median fps at the display rate, p95 frame time under 20 ms | 5th percentile under 30 fps, or integrated GPU with high pixel ratio |
| Where did they get stuck? | Stalls, `path`, `events` | none, or short stops at fights | 4 s or more standing at one spot (lost, confused, blocked terrain) |
| Was the route sensible? | `path` against waypoints | steady progress to each waypoint | long loops, backtracking, time between waypoints much larger than the others |
| Did they see enemies in time? | `encounters` first seen distance | seen well before they reach you | many `neverSeen`, or seen under 15 m (ambush too hard to read) |
| Was it too hard? | damage by source, `bursts`, min health, deaths | health dips and recovers | death within seconds of first sight, one source dominating |
| Was it too easy? | kills by weapon, damage taken, enemies spawned versus killed | some tension, uses all weapons | near zero damage, one weapon does everything |
| Did the weapons feel right? | `shots` hit rate, `inputAggregates` aim time | hit rate rising over the run | very low hits with a lot of aiming |
| Did anything break? | `errors`, `logs\server.log` | none | any error; fix before tuning anything |
| Did the save work? | outcome, `lastSavedAt` | clean end | stale in-progress without a cause |

## 6. Improvements checklist (copy per playtest)

```
Playtest: <friend>, <date>, build <sha>, <difficulty>
File complete: yes / no (why)
Performance: <median fps, p5, GPU> -> action
Stalls: <times and places> -> action
Route: <waypoint times> -> action
Enemies: <never seen / seen late / damage hot spots> -> action
Difficulty: <deaths, lowest health> -> action
Errors: <list> -> action
Missing data: <what I wished the log had>
Top 3 changes: 1. ... 2. ... 3. ...
```

## 7. What the log records and what it skips

Added with the incremental save: encounter log, spawn counts by type, weapon per kill, extraction progress, environment header, uncaught errors, 1 s route. Pause and tab-hidden periods are events. Skipped on purpose: a free-text notes field, raw per-frame input (size), per-shot ballistics, network timing (single player).

A 5 minute run is roughly 100 KB of JSON, the route is 12 to 18 KB of that; each 3 s flush sends about 2 KB and costs well under 1 ms to build.

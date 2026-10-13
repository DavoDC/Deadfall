// Telemetry v2 disk persistence - the Node-side half of the flight
// recorder. Kept separate from vite.config.js's HTTP glue so the actual
// write/decode logic is unit-testable without spinning up a dev server.
// See docs/References/TelemetryV2Spec.md for the full design.
//
// David plays -> the browser POSTs here (via vite.config.js's
// configureServer middleware) -> files land in captures/telemetry/ ->
// Claude reads them straight off disk. No MCP, no browser, no interrupting
// the player.

import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Decode a `data:image/jpeg;base64,...` string (or bare base64) to a
// Buffer. Pure - no fs - so it is trivially unit-testable.
export function decodeDataURL(dataURL) {
  const comma = dataURL.indexOf(',');
  const base64 = comma >= 0 ? dataURL.slice(comma + 1) : dataURL;
  return Buffer.from(base64, 'base64');
}

// Write a session JSON payload to session-<startedAt>.json AND mirror it to
// latest.json - both overwritten in place as the run progresses, so a
// partial or died run always leaves a complete, current file on disk (the
// bug this whole system exists to fix: two 2026-07-18 playtests lost their
// data because telemetry lived only in tab memory).
export function writeSession(telemetryDir, payload) {
  const startedAt = payload.startedAt || Date.now();
  ensureDir(telemetryDir);
  const json = JSON.stringify(payload);
  const sessionPath = path.join(telemetryDir, `session-${startedAt}.json`);
  const latestPath = path.join(telemetryDir, 'latest.json');
  fs.writeFileSync(sessionPath, json);
  fs.writeFileSync(latestPath, json);
  return { sessionPath, latestPath };
}

// Write one screenshot frame, keyed by the session's startedAt and the
// telemetry timestamp t, so frames line up with the session's own timeline.
export function writeFrame(telemetryDir, startedAt, t, dataURL) {
  const runDir = path.join(telemetryDir, 'frames', String(startedAt));
  ensureDir(runDir);
  const framePath = path.join(runDir, `${t}.jpg`);
  fs.writeFileSync(framePath, decodeDataURL(dataURL));
  return framePath;
}

// Write an arbitrary named capture (a video recording, a named screenshot,
// a contact sheet) to captures/telemetry/<subdir>/<filename>. Generalises
// writeFrame's decode-and-persist pattern for capture tooling that isn't a
// numbered per-session frame - see src/capture/recorder.js and
// src/game/shots.js, both of which used to trigger an OS Downloads-folder
// save instead of writing into the repo's gitignored captures/ folder.
export function writeCapture(telemetryDir, subdir, filename, dataURL) {
  const dir = path.join(telemetryDir, subdir);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, decodeDataURL(dataURL));
  return filePath;
}

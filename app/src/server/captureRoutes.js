// Developer-only capture sink (DF-144). Telemetry frame JPEGs, screenshots,
// contact sheets and recordings are written under gitignored captures/ ONLY
// while config/launcher.json says developerMode true. The file is read on each
// request, so flipping it takes effect without restarting the dev server.
// Players (developerMode false, the default) write no captures at all.
// launcher.json is created from launcher.example.json when missing (launcherConfig.js).

import fs from 'node:fs';
import { writeFrame, writeCapture } from './telemetryStore.js';
import { ensureLauncherConfig } from './launcherConfig.js';

export function readDeveloperMode(configPath) {
  ensureLauncherConfig(configPath);
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return !!cfg && cfg.developerMode === true;
  } catch {
    return false; // missing or unreadable config: developer mode stays off
  }
}

// Handles a POSTed capture. Returns the HTTP status to answer with (204 written,
// 403 refused), or null when the URL is not a capture route. Throws on a bad body.
export function handleCaptureRoute(url, body, { telemetryDir, configPath }) {
  if (url !== '/telemetry/frame' && url !== '/telemetry/capture') return null;
  if (!readDeveloperMode(configPath)) return 403;
  const payload = JSON.parse(body);
  if (url === '/telemetry/frame') writeFrame(telemetryDir, payload.startedAt, payload.t, payload.dataURL);
  else writeCapture(telemetryDir, payload.subdir, payload.filename, payload.dataURL);
  return 204;
}

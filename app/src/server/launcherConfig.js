// config/launcher.json is per machine and gitignored; config/launcher.example.json
// is the tracked template. A missing launcher.json is created from the template
// (COPYFILE_EXCL, so an existing file is never overwritten). Without a template the
// file stays missing and readers fall back to developerMode false.

import fs from 'node:fs';
import path from 'node:path';

export function ensureLauncherConfig(configPath) {
  if (fs.existsSync(configPath)) return;
  const examplePath = path.join(path.dirname(configPath), 'launcher.example.json');
  try {
    fs.copyFileSync(examplePath, configPath, fs.constants.COPYFILE_EXCL);
  } catch {
    // no template, or no write access: the reader's fallback applies
  }
}

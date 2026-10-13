// Telemetry v2 disk persistence - the Node-side half of the flight
// recorder. Kept separate from config/vite.config.js's HTTP glue so the actual
// write/decode logic is unit-testable without spinning up a dev server.
// See docs/References/Telemetry.md for what is recorded.
//
// David plays -> the browser POSTs here (via config/vite.config.js's
// configureServer middleware) -> files land in captures/telemetry/ ->
// Claude reads them straight off disk. No MCP, no browser, no interrupting
// the player.

import fs from 'node:fs';
import path from 'node:path';
import { isDelta, applyDelta, lengthsOf } from '../game/telemetryDelta.js';

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

// Write text to filePath so a crash or power cut can never leave a half
// written file: write a temp file next to it, then rename over the target
// (rename is atomic on the same volume). Windows can refuse a rename while a
// reader (antivirus, an editor) holds the target open, so retry briefly.
const RENAME_RETRIES = 6;

export function atomicWriteFileSync(filePath, text) {
  const tmp = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (err) {
      if (i >= RENAME_RETRIES || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
        throw err;
      }
    }
  }
}

export async function atomicWriteFile(filePath, text) {
  const tmp = filePath + '.' + process.pid + '.tmp';
  await fs.promises.writeFile(tmp, text);
  for (let i = 0; ; i++) {
    try {
      await fs.promises.rename(tmp, filePath);
      return;
    } catch (err) {
      if (i >= RENAME_RETRIES || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        await fs.promises.unlink(tmp).catch(() => {});
        throw err;
      }
      await new Promise((r) => setTimeout(r, 10 * (i + 1)));
    }
  }
}

// Write a full session JSON payload to session-<startedAt>.json AND mirror it
// to latest.json. Atomic (temp file then rename). Used for legacy full
// snapshots; the live game sends deltas through createSessionStore().
export function writeSession(telemetryDir, payload) {
  const startedAt = payload.startedAt || Date.now();
  ensureDir(telemetryDir);
  const json = JSON.stringify(payload);
  const sessionPath = path.join(telemetryDir, `session-${startedAt}.json`);
  const latestPath = path.join(telemetryDir, 'latest.json');
  atomicWriteFileSync(sessionPath, json);
  atomicWriteFileSync(latestPath, json);
  return { sessionPath, latestPath };
}

// The server-side half of incremental persistence. Holds each live session in
// memory, applies deltas from the client (see src/game/telemetryDelta.js),
// stamps lastSavedAt, and persists the whole session atomically after every
// accepted request. A session unknown to memory is loaded from its file, so a
// server restart mid-run loses nothing. Writes for one session are serialised
// and coalesced: if requests arrive faster than the disk, the newest memory
// state is written once. apply() resolves when the data is durable.
export function createSessionStore(telemetryDir, { now = Date.now } = {}) {
  const sessions = new Map(); // startedAt -> { session, state: {lastSeq}, writing, dirty, waiters }

  function load(startedAt) {
    let entry = sessions.get(startedAt);
    if (entry) return entry;
    let session = { startedAt };
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(telemetryDir, `session-${startedAt}.json`), 'utf8'));
      if (parsed && typeof parsed === 'object') session = parsed;
    } catch { /* new session, or an unreadable file: start fresh */ }
    entry = { session, state: { lastSeq: 0 }, writing: false, dirty: false, waiters: [] };
    sessions.set(startedAt, entry);
    return entry;
  }

  function persist(entry) {
    return new Promise((resolve, reject) => {
      entry.waiters.push({ resolve, reject });
      entry.dirty = true;
      if (!entry.writing) pump(entry);
    });
  }

  async function pump(entry) {
    entry.writing = true;
    while (entry.dirty) {
      entry.dirty = false;
      const waiters = entry.waiters;
      entry.waiters = [];
      try {
        entry.session.lastSavedAt = now();
        const json = JSON.stringify(entry.session);
        ensureDir(telemetryDir);
        const file = path.join(telemetryDir, `session-${entry.session.startedAt}.json`);
        await atomicWriteFile(file, json);
        await atomicWriteFile(path.join(telemetryDir, 'latest.json'), json);
        for (const w of waiters) w.resolve();
      } catch (err) {
        for (const w of waiters) w.reject(err);
      }
    }
    entry.writing = false;
  }

  // payload: a delta, or a legacy full snapshot. Resolves to
  // { ok: true, lens } or { ok: false, gap: true, lens }.
  async function apply(payload) {
    const startedAt = payload && payload.startedAt;
    if (!startedAt) throw new Error('telemetry payload has no startedAt');
    const entry = load(startedAt);
    if (isDelta(payload)) {
      const res = applyDelta(entry.session, payload, entry.state);
      if (!res.ok) return { ok: false, gap: true, lens: lengthsOf(entry.session) };
    } else {
      entry.session = { ...payload };
    }
    await persist(entry);
    return { ok: true, lens: lengthsOf(entry.session) };
  }

  return { apply, sessions };
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

// Telemetry delta protocol (docs/References/Telemetry.md, "Flush behaviour").
//
// The client used to POST the WHOLE pretty-printed session every second with
// fetch keepalive:true. Browsers cap the body of a keepalive request (and of
// sendBeacon) at 64 KiB, so the first snapshot past that size was rejected,
// the error was swallowed, and the file on disk froze there for the rest of
// the run. A real playtest lost everything after its first 78 seconds that
// way. Now the client sends only what the server does not have yet, and the
// server appends it to the session it holds. Pure functions, shared by the
// browser (build) and the Node server (apply).
//
// Wire shape:
//   { delta: 1, startedAt, seq,
//     scalars: { every non-array field, sent whole each time (small) },
//     arrays:  { name: { from: <index>, items: [...] } } }
// An array entry means "write items at indices from, from+1, ...". It never
// truncates, and writing the same indices twice is harmless, so a duplicated
// or reordered request cannot corrupt the session. Scalars carry seq and are
// ignored when older than what the server already applied.

export const DELTA_VERSION = 1;

// Index of the first array element the server still needs: the acked length,
// or earlier if an element before it was changed after the last ack (arrays
// whose entries are updated in place, see telemetry.touch()).
function startIndex(name, ackLen, mods, ackMod) {
  const m = mods && mods[name];
  if (!m) return ackLen;
  for (let i = 0; i < ackLen && i < m.length; i++) {
    if (m[i] > ackMod) return i;
  }
  return ackLen;
}

// ack: { lens: {name: n}, mod: number } - what the server confirmed.
// mods: { name: number[] } - per-element change counters (may be undefined).
export function buildDelta(log, ack, mods, seq) {
  const scalars = {};
  const arrays = {};
  const lens = {};
  for (const [key, value] of Object.entries(log)) {
    if (Array.isArray(value)) {
      const ackLen = Math.min(ack.lens[key] ?? 0, value.length);
      const from = startIndex(key, ackLen, mods, ack.mod);
      arrays[key] = { from, items: value.slice(from) };
      lens[key] = value.length;
    } else {
      scalars[key] = value;
    }
  }
  return { delta: DELTA_VERSION, startedAt: log.startedAt, seq, scalars, arrays, lens };
}

export function isDelta(payload) {
  return !!(payload && payload.delta === DELTA_VERSION && payload.arrays && payload.scalars);
}

export function lengthsOf(session) {
  const lens = {};
  for (const [key, value] of Object.entries(session)) {
    if (Array.isArray(value)) lens[key] = value.length;
  }
  return lens;
}

// Merges a delta into session (mutating it). state.lastSeq tracks the newest
// delta whose scalars were applied. Returns { ok: true } or
// { ok: false, gap: true } when the delta starts beyond what the session holds
// (the server lost data the client thinks it has); nothing is changed then.
export function applyDelta(session, delta, state) {
  for (const [name, part] of Object.entries(delta.arrays)) {
    const have = Array.isArray(session[name]) ? session[name].length : 0;
    if (part.from > have) return { ok: false, gap: true };
  }
  for (const [name, part] of Object.entries(delta.arrays)) {
    if (!Array.isArray(session[name])) session[name] = [];
    const arr = session[name];
    for (let i = 0; i < part.items.length; i++) arr[part.from + i] = part.items[i];
  }
  if (delta.seq >= state.lastSeq) {
    state.lastSeq = delta.seq;
    Object.assign(session, delta.scalars);
  }
  return { ok: true };
}

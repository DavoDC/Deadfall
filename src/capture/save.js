// Shared "save a capture to disk" helper for capture tooling (video
// recordings, screenshot rigs). Same pattern game/viewer.js already uses
// for portrait captures (POST a dataURL as JSON to a dev-server endpoint,
// which decodes and writes it under gitignored captures/) - generalised
// here to named files under captures/telemetry/<subdir>/ so callers other
// than the numbered-frame viewer rig (a whole video, a set of named
// screenshots) can use the same disk path instead of a browser download.
// Repo rule: generated artifacts NEVER go to the OS Downloads folder.

// Pure path-construction, split out so it's unit-testable without a
// fetch/browser environment - mirrors what the server actually writes
// (src/server/telemetryStore.js's writeCapture, same subdir/filename join).
export function capturePath(subdir, filename) {
  return `captures/telemetry/${subdir}/${filename}`;
}

// POSTs a dataURL to the dev-server capture endpoint, which writes it to
// disk under captures/telemetry/<subdir>/<filename>. Returns the path the
// server wrote to (for logging), matching viewer.js's save() convention.
export async function saveCapture(subdir, filename, dataURL) {
  await fetch('/telemetry/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subdir, filename, dataURL }),
  });
  return capturePath(subdir, filename);
}

// Converts a Blob (e.g. the webm produced by MediaRecorder) to a base64
// data: URL, so it can travel through saveCapture()'s JSON POST the same
// way a canvas.toDataURL() screenshot does. FileReader is async - wrapped
// in a Promise so callers can await it like the canvas path.
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

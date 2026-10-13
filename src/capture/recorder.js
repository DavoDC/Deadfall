// Drift-proof in-engine video capture (ported from SoundScape round 4's
// MediaRecorder / canvas.captureStream() export).
//
// This is plumbing only, wired onto window.__deadfall.recorder - no camera
// choreography. A later session drives the camera and calls start()/stop()
// around it to produce a trailer.
//
// Unlike SoundScape's export mode (which drives the animation clock off
// recorded audio position to avoid drift against a fixed-length track),
// Deadfall has no audio track to sync against here, so capture simply rides
// the canvas's native captureStream() at the requested frame rate - the
// browser paces frame delivery, there is no wall-clock/audio desync to
// correct for.
//
// stop() used to trigger a browser Downloads-folder save via downloadBlob()
// - the repo rule is generated artifacts never go to Downloads, so it now
// routes the finished webm through src/capture/save.js's saveCapture(),
// the same POST-a-dataURL-to-disk pattern game/viewer.js uses for portrait
// captures. downloadBlob() itself is kept and still exported: game/
// telemetry.js imports it separately for the human-triggered "save this
// session's JSON" action, which is a deliberate download, not this rule.

import { saveCapture, blobToDataURL } from './save.js';

// Preferred codec order: vp9 first (best quality/size), vp8 fallback, then
// bare webm container for browsers that support neither codec string.
export const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

// Picks the first supported mime type given an isTypeSupported-capable
// checker function. Pure and unit-testable without a real MediaRecorder.
export function pickMimeType(isTypeSupported, candidates = MIME_CANDIDATES) {
  for (let i = 0; i < candidates.length; i++) {
    if (isTypeSupported(candidates[i])) return candidates[i];
  }
  return '';
}

// Triggers a browser download of a blob under the given filename. Still
// used by game/telemetry.js for the explicit human-triggered "save this
// session's JSON" action - not used by this module's own stop() any more,
// see the note at the top of the file.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Filename for a finished recording, given the timestamp it stopped at.
// Pure - no Date.now() call inside - so it's unit-testable without mocking
// the clock; callers pass Date.now() themselves.
export function recordingFilename(timestamp) {
  return `deadfall-capture-${timestamp}.webm`;
}

// getCanvas: () => HTMLCanvasElement, e.g. () => renderer.domElement.
// Kept as a callback rather than a direct reference so the recorder can be
// constructed before the renderer's canvas exists, and always captures the
// live canvas even if it's ever replaced.
export function createRecorderAPI({ getCanvas, saveCapture: saveCaptureFn = saveCapture }) {
  let recorder = null;
  let chunks = [];
  let stream = null;
  let recording = false;

  function start({ fps = 60, bitrate = 8000000 } = {}) {
    if (recording) {
      console.warn('[capture] start() called while already recording - ignoring');
      return false;
    }
    const canvas = getCanvas();
    if (!canvas || typeof canvas.captureStream !== 'function') {
      console.error('[capture] canvas.captureStream is not available in this browser');
      return false;
    }
    if (typeof window === 'undefined' || !window.MediaRecorder) {
      console.error('[capture] MediaRecorder is not available in this browser');
      return false;
    }
    const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      console.error('[capture] no supported webm codec (vp9/vp8) - cannot record');
      return false;
    }

    stream = canvas.captureStream(fps);
    chunks = [];
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bitrate,
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.start(1000); // gather chunks once a second, same cadence as SoundScape
    recording = true;
    console.log('[capture] recording started - mime=' + mime + ' fps=' + fps + ' bitrate=' + bitrate);
    return true;
  }

  function stop() {
    if (!recording || !recorder) {
      console.warn('[capture] stop() called while not recording - ignoring');
      return Promise.resolve(null);
    }
    const activeRecorder = recorder;
    const activeStream = stream;
    return new Promise((resolve) => {
      activeRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: activeRecorder.mimeType || 'video/webm' });
        chunks = [];
        recording = false;
        recorder = null;
        stream = null;
        activeStream.getTracks().forEach((t) => t.stop());
        const filename = recordingFilename(Date.now());
        blobToDataURL(blob)
          .then((dataURL) => saveCaptureFn('recordings', filename, dataURL))
          .then((path) => console.log('[capture] recording saved - ' + path))
          .catch((err) => console.error('[capture] failed to save recording:', err.message));
        console.log('[capture] recording stopped - blob size=' + blob.size + ' bytes, type=' + blob.type);
        resolve(blob);
      };
      activeRecorder.stop();
    });
  }

  return {
    start,
    stop,
    get isRecording() { return recording; },
  };
}

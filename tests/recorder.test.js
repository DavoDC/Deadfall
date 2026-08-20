import { describe, it, expect } from 'vitest';
import { pickMimeType, MIME_CANDIDATES, recordingFilename } from '../src/capture/recorder.js';

describe('recorder: pickMimeType (codec fallback selection)', () => {
  it('picks vp9 when the checker supports everything', () => {
    const mime = pickMimeType(() => true);
    expect(mime).toBe('video/webm;codecs=vp9');
  });

  it('falls back to vp8 when vp9 is unsupported', () => {
    const mime = pickMimeType((t) => t === 'video/webm;codecs=vp8');
    expect(mime).toBe('video/webm;codecs=vp8');
  });

  it('falls back to bare webm when only the container is supported', () => {
    const mime = pickMimeType((t) => t === 'video/webm');
    expect(mime).toBe('video/webm');
  });

  it('returns empty string when nothing is supported', () => {
    const mime = pickMimeType(() => false);
    expect(mime).toBe('');
  });

  it('respects candidate order (first supported wins)', () => {
    expect(MIME_CANDIDATES[0]).toBe('video/webm;codecs=vp9');
    expect(MIME_CANDIDATES[MIME_CANDIDATES.length - 1]).toBe('video/webm');
  });
});

// stop() used to trigger a browser Downloads-folder save; it now saves the
// recording under captures/telemetry/recordings/ via src/capture/save.js.
// recordingFilename is the pure naming piece of that path - unit-testable
// without a real MediaRecorder/Blob/fetch.
describe('recorder: recordingFilename (never-Downloads capture naming)', () => {
  it('builds a .webm filename from a timestamp', () => {
    expect(recordingFilename(1700000000000)).toBe('deadfall-capture-1700000000000.webm');
  });

  it('produces distinct filenames for distinct timestamps (no collisions across stops)', () => {
    expect(recordingFilename(1)).not.toBe(recordingFilename(2));
  });
});

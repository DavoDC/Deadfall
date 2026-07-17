import { describe, it, expect } from 'vitest';
import { pickMimeType, MIME_CANDIDATES } from '../src/capture/recorder.js';

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

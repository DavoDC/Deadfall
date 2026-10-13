import { describe, it, expect } from 'vitest';
import { capturePath } from '../src/capture/save.js';

describe('capture/save: capturePath (path construction for the capture sink)', () => {
  it('joins subdir and filename under captures/telemetry/', () => {
    expect(capturePath('recordings', 'deadfall-capture-123.webm')).toBe(
      'captures/telemetry/recordings/deadfall-capture-123.webm'
    );
  });

  it('matches the directory the server actually writes to (telemetryStore.writeCapture)', () => {
    // src/server/telemetryStore.js's writeCapture does
    // path.join(telemetryDir, subdir, filename) where telemetryDir is
    // captures/telemetry - this mirrors that shape so callers can trust
    // the returned path for logging.
    expect(capturePath('shots', 'bloom-insertion-beach-2026-08-20.png')).toBe(
      'captures/telemetry/shots/bloom-insertion-beach-2026-08-20.png'
    );
  });

  it('does not collapse or alter subdirs with multiple path-like segments', () => {
    expect(capturePath('frames/nested', 'x.jpg')).toBe('captures/telemetry/frames/nested/x.jpg');
  });
});

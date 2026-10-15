// Developer-only telemetry frame cadence (docs/References/Telemetry.md). Shared by
// the browser (main.js sends frames) and the Node server (telemetryStore.js caps
// what is written), so it has no DOM or Node dependencies.

// one frame every half second of play, plus the burst frames (damage spike,
// death, run end, flood surge) which are sent on top of the interval
export const FRAME_INTERVAL_S = 0.5;

// at most this many frames are written per session (about 25 minutes at the
// interval above). The oldest frames are never deleted; past the cap, writing stops.
export const FRAME_CAP_PER_SESSION = 3000;

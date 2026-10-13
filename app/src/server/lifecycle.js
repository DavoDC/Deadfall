// Pure server-lifecycle helpers for the hidden game server (no Vite, no fs,
// so they unit test without a browser). The Vite plugin in config/ is the
// glue: it wires these to /api/ping, /api/quit and process.exit.

export const DEFAULT_IDLE_MINUTES = 10;

// DEADFALL_IDLE_MINUTES override; anything missing, non-numeric or <= 0 falls
// back to the default so a typo can never disable or instantly trigger the exit.
export function idleMinutesFromEnv(env) {
  const raw = env && env.DEADFALL_IDLE_MINUTES;
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n) || n <= 0) return DEFAULT_IDLE_MINUTES;
  return n;
}

// Idle watch: ping() marks the page as alive, expired(now) says whether the
// server has gone unpinged for longer than idleMs. The clock starts at
// creation, so a server nobody ever opened also ends up exiting.
export function createIdleWatch(idleMs, now = Date.now) {
  let last = now();
  return {
    ping() {
      last = now();
    },
    expired() {
      return now() - last > idleMs;
    },
  };
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Only the local machine's own game page may stop the server: the socket must
// be loopback, the Host header must be localhost, and a browser Origin (sent on
// cross-site POSTs) must also be localhost, which blocks a random website from
// posting to the quit endpoint.
export function isLocalRequest({ remoteAddress, host, origin }) {
  if (!LOOPBACK_ADDR.has(remoteAddress)) return false;
  if (!host || !LOCAL_HOST.test(host)) return false;
  if (origin) {
    let h;
    try {
      h = new URL(origin).host;
    } catch {
      return false;
    }
    if (!LOCAL_HOST.test(h)) return false;
  }
  return true;
}

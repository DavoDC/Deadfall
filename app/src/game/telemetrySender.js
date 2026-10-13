// A single-in-flight, coalescing async sender.
//
// Browsers do NOT guarantee two overlapping fetch() calls complete in the
// order they were sent. Telemetry v2's transport posts the CURRENT session
// state on a 1s interval AND after every event AND at run end - naively
// firing each of those as an independent fetch() means an OLDER snapshot
// can finish LAST and overwrite a NEWER one already on disk. This was
// caught during end-to-end verification: a real death's final state
// (outcome/endedAt/burst) got clobbered by a stale periodic tick that
// happened to resolve after it.
//
// Fix: never more than one request in flight. Anything that wants to send
// again while one is outstanding just marks "send again"; the eventual
// re-send always calls sendFn() fresh, so it picks up whatever is CURRENT
// at that moment - never a stale intermediate state. This also naturally
// coalesces bursts of near-simultaneous triggers (e.g. a hit that kills -
// onHurt and onDeath firing back to back) into fewer actual requests.
export function createCoalescedSender(sendFn) {
  let inFlight = false;
  let queued = false;

  function trigger() {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    Promise.resolve()
      .then(sendFn)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        if (queued) {
          queued = false;
          trigger();
        }
      });
  }

  return {
    trigger,
    get inFlight() { return inFlight; },
  };
}

// ---------------------------------------------------------------------------
// The session flusher: owns the "what does the server already have" ack,
// builds deltas (telemetryDelta.js) and sends them one at a time.
//
//   post(body, { keepalive }) -> Promise<{ ok, status, json }>   (injected)
//   flush()        - send the newest delta now (coalesced, async, never throws)
//   soft(reason)   - like flush() but at most one per softGapMs (kill/damage
//                    bursts); a trailing flush is scheduled so nothing is lost
//   beacon(send)   - last-gasp send for pagehide: send(body) is
//                    navigator.sendBeacon bound to the URL
//
// A request that never settles would otherwise wedge the single in-flight
// slot forever, so every send is raced against a timeout.
export const KEEPALIVE_LIMIT = 60000; // browsers cap keepalive/beacon bodies at 64 KiB
export const SEND_TIMEOUT_MS = 8000;

export function createSessionFlusher({
  telemetry, post, now = () => Date.now(),
  softGapMs = 500, timeoutMs = SEND_TIMEOUT_MS,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let ack = { lens: {}, mod: -1 };
  let ackFor = null; // startedAt the ack belongs to
  let seq = 0;
  let lastSoftAt = -Infinity;
  let softTimer = null;
  const stats = { sent: 0, failed: 0, lastBytes: 0, maxBytes: 0, totalBytes: 0, lastMs: 0, maxMs: 0, lastError: null };

  function build() {
    const log = telemetry.log;
    if (!log) return null;
    if (ackFor !== log.startedAt) {
      ack = { lens: {}, mod: -1 };
      ackFor = log.startedAt;
      seq = 0;
    }
    const built = telemetry.delta(ack, ++seq);
    return built;
  }

  async function sendOnce() {
    const built = build();
    if (!built) return;
    const body = JSON.stringify(built.delta);
    const t0 = now();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimer(() => reject(new Error('telemetry send timeout')), timeoutMs); });
    try {
      const res = await Promise.race([post(body, { keepalive: body.length < KEEPALIVE_LIMIT }), timeout]);
      if (res && res.json && res.json.lens) {
        ack.lens = res.json.lens;
        ack.mod = res.ok ? built.counter : -1; // a gap resync resends every mutable entry
      }
      if (res && res.ok) {
        stats.sent += 1;
        stats.lastBytes = body.length;
        stats.maxBytes = Math.max(stats.maxBytes, body.length);
        stats.totalBytes += body.length;
        stats.lastMs = now() - t0;
        stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
      } else {
        stats.failed += 1;
        stats.lastError = 'http ' + (res && res.status);
      }
    } catch (err) {
      stats.failed += 1;
      stats.lastError = String(err && err.message);
    } finally {
      clearTimer(timer);
    }
  }

  const sender = createCoalescedSender(sendOnce);

  function flush() { sender.trigger(); }

  function soft() {
    const t = now();
    if (t - lastSoftAt >= softGapMs) {
      lastSoftAt = t;
      sender.trigger();
    } else if (!softTimer) {
      softTimer = setTimer(() => {
        softTimer = null;
        lastSoftAt = now();
        sender.trigger();
      }, softGapMs);
    }
  }

  function beacon(send) {
    const built = build();
    if (!built) return false;
    const body = JSON.stringify(built.delta);
    if (body.length >= KEEPALIVE_LIMIT) return false;
    try { return !!send(body); } catch { return false; }
  }

  // Resolves once nothing is in flight (or after maxMs): lets QUIT wait for the final save.
  function drain(maxMs = 3000) {
    sender.trigger();
    const t0 = now();
    return new Promise((resolve) => {
      const check = () => {
        if (!sender.inFlight || now() - t0 >= maxMs) resolve();
        else setTimer(check, 20);
      };
      setTimer(check, 0);
    });
  }

  return { flush, soft, beacon, drain, stats, get inFlight() { return sender.inFlight; } };
}

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

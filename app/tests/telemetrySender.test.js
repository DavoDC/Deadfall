// TELEMETRY V2 transport: coalescing sender (docs/References/Telemetry.md).
// Caught during end-to-end browser verification: naive fire-and-forget
// POSTs of "the current state" can land out of order (fetch does not
// guarantee completion order), so a stale mid-run snapshot can overwrite
// a newer one - specifically, a real death's final state got clobbered by
// a slightly-earlier periodic tick that happened to resolve later. This
// sender guarantees at most one send in flight and always re-reads fresh
// state on the coalesced re-send, which is what fixes the race.

import { describe, it, expect, vi } from 'vitest';
import { createCoalescedSender } from '../src/game/telemetrySender.js';

// A controllable "in-flight request" - resolve() lets the test decide
// exactly when a send completes, so ordering can be asserted deterministically.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Flushes the microtask queue via a macrotask boundary - more reliable
// than chaining a guessed number of Promise.resolve() hops through the
// sender's internal .then().catch().finally() chain.
function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('telemetrySender: createCoalescedSender', () => {
  it('sends on trigger', async () => {
    const sendFn = vi.fn(() => Promise.resolve());
    const sender = createCoalescedSender(sendFn);
    sender.trigger();
    await flush();
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it('never has two sends in flight at once - a trigger while one is pending queues instead of firing', async () => {
    const d1 = deferred();
    const sendFn = vi.fn(() => d1.promise);
    const sender = createCoalescedSender(sendFn);

    sender.trigger();
    await flush();
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sender.inFlight).toBe(true);

    // triggered again while the first is still in flight - must NOT call
    // sendFn a second time yet
    sender.trigger();
    sender.trigger();
    await flush();
    expect(sendFn).toHaveBeenCalledTimes(1);

    d1.resolve();
    await flush();
    // exactly one coalesced re-send for the queued triggers, not one per trigger
    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(sender.inFlight).toBe(false);
  });

  it('the coalesced re-send reads fresh state, not the state at trigger time (fixes the out-of-order clobber)', async () => {
    let currentState = 'mid-run';
    const d1 = deferred();
    let secondCallSawState = null;
    const sendFn = vi.fn(() => {
      if (sendFn.mock.calls.length === 1) return d1.promise;
      secondCallSawState = currentState;
      return Promise.resolve();
    });
    const sender = createCoalescedSender(sendFn);

    sender.trigger(); // starts the first (slow) send
    await flush();

    // a second event fires while the first is still in flight (e.g. a
    // periodic tick raced against a death) - the run then actually ends
    currentState = 'died-final';
    sender.trigger();

    d1.resolve(); // the slow first send finally completes
    await flush();

    expect(secondCallSawState).toBe('died-final');
  });

  it('a send that rejects does not wedge the sender - later triggers still go through', async () => {
    const sendFn = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('network down')))
      .mockImplementationOnce(() => Promise.resolve());
    const sender = createCoalescedSender(sendFn);

    sender.trigger();
    await flush();
    expect(sender.inFlight).toBe(false);

    sender.trigger();
    await flush();
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it('a sendFn returning a non-promise value (e.g. null, "nothing to send") does not throw', async () => {
    const sendFn = vi.fn(() => null);
    const sender = createCoalescedSender(sendFn);
    expect(() => sender.trigger()).not.toThrow();
    await flush();
    expect(sender.inFlight).toBe(false);
  });
});

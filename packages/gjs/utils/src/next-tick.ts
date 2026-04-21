// Microtask scheduling utility for GJS
// Shared by @gjsify/stream, @gjsify/web-streams, and other packages
// Matches Node.js process.nextTick semantics with cross-platform fallbacks

declare const queueMicrotask: ((cb: () => void) => void) | undefined;

// Burst-yield scheduler. GTK input events (move, click, scroll) are dispatched
// from GLib's main context at PRIORITY_DEFAULT (0). Historically every nextTick
// became its own GLib.timeout_add(PRIORITY_DEFAULT, 0) source — ready
// immediately. When user code (webtorrent DHT bootstrap, streamx pipe bursts)
// scheduled hundreds of nextTicks in a tight loop, GLib dispatched the whole
// batch before cycling back to collect GTK input events, freezing the window.
//
// Instead, we maintain a FIFO queue owned by this module:
//   • nextTick(cb) pushes onto _queue
//   • A single GLib.timeout_add(PRIORITY_DEFAULT, 0) drains up to CHUNK_SIZE
//     callbacks per iteration
//   • If more remain, the drainer re-arms with delay=1ms — forcing at least
//     one main-loop iteration before continuing, so GTK events that arrived
//     during the chunk get dispatched
//   • When _queue empties, the drainer goes idle (zero ambient cost)
//
// Guarantees:
//   • FIFO: single shared queue + single drainer preserves call order
//   • Throughput: short bursts under CHUNK_SIZE drain with zero added latency
//   • Responsiveness: longer bursts cost at most 1ms per CHUNK_SIZE callbacks
//     of added latency, in exchange for GTK input dispatch
//   • GC safety: one timeout source lives while _queue is non-empty; no
//     per-call BoxedInstance retention
const CHUNK_SIZE = 64;
const YIELD_DELAY_MS = 1;
const _queue: Array<() => void> = [];
let _drainerArmed = false;

function drainOnce(GLib: any): void {
  // Process up to CHUNK_SIZE callbacks. Errors don't abort the queue —
  // Node's process.nextTick guarantees later ticks still run even if an
  // earlier one throws (the throw is delivered asynchronously via
  // 'uncaughtException'). We keep the same contract by catching per-cb.
  const end = Math.min(CHUNK_SIZE, _queue.length);
  for (let i = 0; i < end; i++) {
    const cb = _queue.shift()!;
    try { cb(); }
    catch (err) {
      // Surface as an emitted error rather than swallow. In GJS there is no
      // 'uncaughtException'; fall back to logging on stderr via GLib.
      try { GLib.log_default_handler('gjsify-nextTick', GLib.LogLevelFlags.LEVEL_WARNING, String((err as any)?.stack || err), null); }
      catch { /* best-effort */ }
    }
  }
  if (_queue.length > 0) {
    // More work remains — re-arm with a 1 ms yield so GTK events dispatch.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, YIELD_DELAY_MS, () => {
      drainOnce(GLib);
      return false;
    });
  } else {
    _drainerArmed = false;
  }
}

// On GJS, nextTick goes through the GLib main loop instead of the JS
// microtask queue, so I/O events are interleaved between stream/pipe steps.
//
// PRIORITY_DEFAULT (0) is required: GJS 1.86 maintains an internal
// Promise/microtask-drain source at priority 0 that returns SOURCE_CONTINUE,
// permanently blocking any source at priority > 0 (including PRIORITY_HIGH_IDLE
// = 100) from ever dispatching. Using PRIORITY_DEFAULT ensures nextTick
// callbacks fire within the same GLib dispatch band as I/O events.
//
// We use GLib.timeout_add rather than GLib.idle_add: timeout_add returns a
// numeric source ID (no BoxedInstance, no GC race). GLib.idle_add has the same
// GC-race hazard as the old GLib.Source BoxedInstance approach fixed in
// @gjsify/node-globals timers.
function tryGLibTimeout(cb: () => void): boolean {
  const GLib = (globalThis as any).imports?.gi?.GLib;
  if (!GLib?.timeout_add) return false;
  _queue.push(cb);
  if (!_drainerArmed) {
    _drainerArmed = true;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
      drainOnce(GLib);
      return false;
    });
  }
  return true;
}

/** @internal Test helper: reset burst state. */
export function __resetBurstStateForTests(): void {
  _queue.length = 0;
  _drainerArmed = false;
}

/**
 * Schedule a function on the next turn of the event loop.
 * On GJS: uses GLib.timeout_add(PRIORITY_DEFAULT, delay=0).
 * On Node.js: uses process.nextTick → queueMicrotask → Promise.resolve().then().
 */
export const nextTick = (fn: (...args: unknown[]) => void, ...args: unknown[]): void => {
  const cb = args.length > 0 ? () => fn(...args) : fn as () => void;
  if (tryGLibTimeout(cb)) return;
  if (typeof globalThis.process?.nextTick === 'function') {
    globalThis.process.nextTick(fn, ...args);
    return;
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(cb);
    return;
  }
  Promise.resolve().then(cb);
};

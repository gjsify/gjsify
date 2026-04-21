// Microtask scheduling utility for GJS
// Shared by @gjsify/stream, @gjsify/web-streams, and other packages
// Matches Node.js process.nextTick semantics with cross-platform fallbacks

declare const queueMicrotask: ((cb: () => void) => void) | undefined;

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
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
    cb();
    return false;
  });
  return true;
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

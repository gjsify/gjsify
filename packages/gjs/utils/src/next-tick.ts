// Microtask scheduling utility for GJS
// Shared by @gjsify/stream, @gjsify/web-streams, and other packages
// Matches Node.js process.nextTick semantics with cross-platform fallbacks

declare const queueMicrotask: ((cb: () => void) => void) | undefined;

// On GJS, nextTick MUST go through the GLib main loop instead of the JS
// microtask queue. queueMicrotask/Promise chains drain synchronously within a
// single GLib dispatch, starving GTK input-event sources and freezing the
// window during heavy I/O (e.g. WebTorrent downloads). Scheduling via
// GLib.idle_add at PRIORITY_HIGH_IDLE (100) lets GTK event sources at
// PRIORITY_DEFAULT (0) run between every stream/pipe step.
function tryGLibIdle(cb: () => void): boolean {
  const GLib = (globalThis as any).imports?.gi?.GLib;
  if (!GLib?.idle_add) return false;
  GLib.idle_add(GLib.PRIORITY_HIGH_IDLE ?? 100, () => { cb(); return false; });
  return true;
}

/**
 * Schedule a function on the next turn of the event loop.
 * On GJS: uses GLib.idle_add(PRIORITY_HIGH_IDLE) so GTK events are interleaved.
 * On Node.js: uses process.nextTick → queueMicrotask → Promise.resolve().then().
 */
export const nextTick = (fn: (...args: unknown[]) => void, ...args: unknown[]): void => {
  const cb = args.length > 0 ? () => fn(...args) : fn as () => void;
  if (tryGLibIdle(cb)) return;
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

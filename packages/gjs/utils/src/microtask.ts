// Cross-platform microtask scheduler
// Always uses Promise.resolve().then() — true microtask semantics.
// Unlike nextTick (which routes through GLib.idle_add on GJS to let GTK events
// interleave), queueMicrotask deliberately fires before any GLib event source.
// Use this when you need "after the current synchronous task, before I/O" ordering.

/**
 * Schedule a function as a microtask.
 * Identical semantics on GJS and Node.js: fires after the current synchronous
 * task, before any GLib idle / Node.js timer / I/O callbacks.
 */
export const queueMicrotask = (fn: () => void): void => {
  Promise.resolve().then(fn);
};

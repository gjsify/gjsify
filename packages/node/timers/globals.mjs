/**
 * Cross-runtime re-export of the native timer globals for use in Node.js
 * AND browser builds.
 *
 * `setTimeout`/`setInterval`/`setImmediate`/`queueMicrotask` and their
 * `clear*` counterparts exist on both Node 18+ and every modern browser.
 * The browser does NOT have native `setImmediate` — we polyfill it via
 * `Promise.resolve().then(...)` (a turn boundary, the closest browser
 * equivalent to Node's "I/O phase callback"; the MessageChannel-based
 * shim is heavier and only buys ~µs of priority over Promise — not worth
 * the complexity for a polyfill no real browser code targets directly).
 *
 * IMPORTANT: this file MUST NOT reference `node:timers` (or any other
 * `node:` specifier) — the audit-runtimes `--strict` probe rejects re-exports
 * from `node:*` for a slot declared cross-runtime, and `node:timers`
 * fails to resolve in a browser bundle.
 *
 * GJS bundles do NOT consult this file; the GJS-target alias layer routes
 * `@gjsify/timers` to the polyfill at `lib/esm/index.js` (which provides
 * the GLib-source-safe Timeout class — see CLAUDE.md "GLib MainLoop").
 */

// Standard timers — bind to globalThis so callers can detach them and the
// `this` context still resolves to the runtime's timer host. Node's
// `setTimeout` is callable without rebinding, but `setTimeout.bind(undefined)`
// matches the lib.dom `(handler, timeout?, ...args) => number` signature.
export const setTimeout = globalThis.setTimeout.bind(globalThis);
export const clearTimeout = globalThis.clearTimeout.bind(globalThis);
export const setInterval = globalThis.setInterval.bind(globalThis);
export const clearInterval = globalThis.clearInterval.bind(globalThis);

// queueMicrotask is native on both Node 12+ and every browser.
export const queueMicrotask = globalThis.queueMicrotask.bind(globalThis);

// setImmediate / clearImmediate — Node-only natively. In the browser we
// polyfill via Promise.resolve().then so the callback fires on the very next
// microtask turn. We hand out a Symbol token so `clearImmediate` can
// no-op (a real cancellation isn't possible once `.then` has scheduled);
// every npm consumer treats clearImmediate as best-effort already.
const _hasNativeImmediate = typeof globalThis.setImmediate === 'function';

export const setImmediate = _hasNativeImmediate
    ? globalThis.setImmediate.bind(globalThis)
    : ((cb, ...args) => {
          const handle = { __cancelled: false };
          Promise.resolve().then(() => {
              if (!handle.__cancelled) cb(...args);
          });
          return handle;
      });

export const clearImmediate = _hasNativeImmediate
    ? globalThis.clearImmediate.bind(globalThis)
    : ((handle) => {
          if (handle && typeof handle === 'object') handle.__cancelled = true;
      });

// Default-export shape — every named timer exported as a property so
// `import timers from '@gjsify/timers'; timers.setTimeout(...)` resolves.
export default {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
};

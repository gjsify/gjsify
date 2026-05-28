/**
 * Re-exports native `node:async_hooks` for use in Node.js builds.
 *
 * On Node, `node:async_hooks` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/async_hooks` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/async_hooks`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:async_hooks';
export { default } from 'node:async_hooks';

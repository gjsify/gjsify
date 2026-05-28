/**
 * Re-exports native `node:timers` for use in Node.js builds.
 *
 * On Node, `node:timers` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/timers` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/timers`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:timers';
export { default } from 'node:timers';

/**
 * Re-exports native `node:events` for use in Node.js builds.
 *
 * On Node, `node:events` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/events` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/events`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:events';
export { default } from 'node:events';

/**
 * Re-exports native `node:cluster` for use in Node.js builds.
 *
 * On Node, `node:cluster` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/cluster` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/cluster`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:cluster';
export { default } from 'node:cluster';

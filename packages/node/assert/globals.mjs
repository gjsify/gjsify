/**
 * Re-exports native `node:assert` for use in Node.js builds.
 *
 * On Node, `node:assert` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/assert` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/assert`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:assert';
export { default } from 'node:assert';

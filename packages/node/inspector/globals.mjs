/**
 * Re-exports native `node:inspector` for use in Node.js builds.
 *
 * On Node, `node:inspector` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/inspector` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/inspector`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:inspector';
export { default } from 'node:inspector';

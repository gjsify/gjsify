/**
 * Re-exports native `node:stream` for use in Node.js builds.
 *
 * On Node, `node:stream` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/stream` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/stream`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:stream';
export { default } from 'node:stream';

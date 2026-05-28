/**
 * Re-exports native `node:util` for use in Node.js builds.
 *
 * On Node, `node:util` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/util` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/util`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:util';
export { default } from 'node:util';

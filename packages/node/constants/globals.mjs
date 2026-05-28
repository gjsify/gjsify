/**
 * Re-exports native `node:constants` for use in Node.js builds.
 *
 * On Node, `node:constants` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/constants` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/constants`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:constants';
export { default } from 'node:constants';

/**
 * Re-exports native `node:vm` for use in Node.js builds.
 *
 * On Node, `node:vm` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/vm` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/vm`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:vm';
export { default } from 'node:vm';

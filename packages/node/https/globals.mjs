/**
 * Re-exports native `node:https` for use in Node.js builds.
 *
 * On Node, `node:https` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/https` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/https`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:https';
export { default } from 'node:https';
